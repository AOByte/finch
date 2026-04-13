import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../persistence/prisma.service';
import { CredentialEncryptionService } from '../connectors/credential-encryption.service';
import { OAuthProviderRegistry } from './oauth-provider-registry';
import type { OAuthProviderConfig } from './oauth-provider-registry';

/**
 * OAuthService handles token exchange/storage/refresh/revocation.
 * It does NOT create adapters or touch MCPRegistryService — that responsibility
 * belongs to ConnectorSettingsService.loadAndRegisterServer().
 *
 * This keeps OAuthModule as a leaf module (imports PersistenceModule only),
 * breaking the circular dependency: MCPModule → OAuthModule → MCPModule.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialEncryptionService,
    private readonly providerRegistry: OAuthProviderRegistry,
    private readonly config: ConfigService,
  ) {}

  /**
   * Generate an OAuth authorization URL and store state + PKCE verifier.
   */
  async generateAuthUrl(providerId: string, harnessId: string): Promise<{ url: string; state: string }> {
    const provider = this.providerRegistry.getProvider(providerId);
    if (!provider) {
      throw new Error(`Unknown OAuth provider: ${providerId}`);
    }

    const clientId = this.config.get<string>(provider.clientIdEnvVar);
    if (!clientId) {
      throw new Error(`Missing env var ${provider.clientIdEnvVar} for provider ${providerId}`);
    }

    const state = randomBytes(32).toString('hex');
    let codeVerifier: string | null = null;
    let codeChallenge: string | undefined;

    if (provider.supportsPKCE) {
      codeVerifier = randomBytes(32).toString('base64url');
      codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    }

    // Store state for validation on callback
    await this.prisma.oAuthState.create({
      data: {
        state,
        harnessId,
        providerId,
        codeVerifier: codeVerifier ? this.encryption.encrypt(codeVerifier) : null,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      },
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.getCallbackUrl(),
      response_type: 'code',
      scope: provider.scopes.join(' '),
      state,
    });

    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    const url = `${provider.authorizationUrl}?${params.toString()}`;
    return { url, state };
  }

  /**
   * Handle OAuth callback: validate state, exchange code for tokens, persist.
   * Returns mcpServerId. Does NOT create adapters or register in MCPRegistryService.
   */
  async handleCallback(state: string, code: string): Promise<string> {
    // Look up and validate state
    const oauthState = await this.prisma.oAuthState.findUnique({ where: { state } });
    if (!oauthState) {
      throw new Error('Invalid OAuth state — possible CSRF attack');
    }

    if (new Date() > oauthState.expiresAt) {
      await this.prisma.oAuthState.delete({ where: { id: oauthState.id } });
      throw new Error('OAuth state expired (>10 minutes)');
    }

    const provider = this.providerRegistry.getProvider(oauthState.providerId);
    if (!provider) {
      throw new Error(`Unknown provider: ${oauthState.providerId}`);
    }

    // Exchange code for tokens
    const tokens = await this.exchangeCodeForTokens(provider, code, oauthState.codeVerifier);

    // Encrypt and store tokens in mcp_servers row
    const configEncrypted = this.encryption.encrypt(JSON.stringify({
      transport: provider.tokenPassingStrategy === 'env' ? 'stdio' : 'sse',
    }));

    const row = await this.prisma.mcpServer.create({
      data: {
        harnessId: oauthState.harnessId,
        serverType: oauthState.providerId,
        displayName: provider.displayName,
        configEncrypted,
        oauthProviderId: oauthState.providerId,
        accessTokenEncrypted: this.encryption.encrypt(tokens.accessToken),
        refreshTokenEncrypted: tokens.refreshToken
          ? this.encryption.encrypt(tokens.refreshToken)
          : null,
        tokenExpiresAt: tokens.expiresIn
          ? new Date(Date.now() + tokens.expiresIn * 1000)
          : null,
      },
    });

    // Delete used state (single-use)
    await this.prisma.oAuthState.delete({ where: { id: oauthState.id } });

    this.logger.log(`OAuth callback completed for ${oauthState.providerId}, mcpServerId=${row.mcpServerId}`);
    return row.mcpServerId;
  }

  /**
   * Refresh OAuth tokens for an MCP server.
   * Returns the new plaintext access token, or null if refresh fails.
   */
  async refreshTokens(mcpServerId: string): Promise<string | null> {
    const row = await this.prisma.mcpServer.findUnique({ where: { mcpServerId } });
    if (!row || !row.refreshTokenEncrypted || !row.oauthProviderId) {
      return null;
    }

    const provider = this.providerRegistry.getProvider(row.oauthProviderId);
    if (!provider) return null;

    const refreshToken = this.encryption.decrypt(row.refreshTokenEncrypted);
    const clientId = this.config.get<string>(provider.clientIdEnvVar);
    const clientSecret = this.config.get<string>(provider.clientSecretEnvVar);

    if (!clientId || !clientSecret) {
      this.logger.error(`Missing OAuth credentials for provider ${row.oauthProviderId}`);
      return null;
    }

    try {
      const response = await fetch(provider.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Token refresh failed for ${mcpServerId}: HTTP ${response.status}`);
        await this.prisma.mcpServer.update({
          where: { mcpServerId },
          data: { healthStatus: 'reauth_required' },
        });
        return null;
      }

      const data = await response.json() as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };

      // Update stored tokens
      await this.prisma.mcpServer.update({
        where: { mcpServerId },
        data: {
          accessTokenEncrypted: this.encryption.encrypt(data.access_token),
          refreshTokenEncrypted: data.refresh_token
            ? this.encryption.encrypt(data.refresh_token)
            : undefined,
          tokenExpiresAt: data.expires_in
            ? new Date(Date.now() + data.expires_in * 1000)
            : undefined,
          healthStatus: 'healthy',
        },
      });

      this.logger.log(`Refreshed tokens for ${mcpServerId}`);
      return data.access_token;
    } catch (err) {
      this.logger.error(`Token refresh error for ${mcpServerId}: ${(err as Error).message}`);
      await this.prisma.mcpServer.update({
        where: { mcpServerId },
        data: { healthStatus: 'reauth_required' },
      });
      return null;
    }
  }

  /**
   * Revoke OAuth tokens for an MCP server (called on deletion).
   */
  async revokeTokens(mcpServerId: string): Promise<void> {
    const row = await this.prisma.mcpServer.findUnique({ where: { mcpServerId } });
    if (!row || !row.oauthProviderId || !row.accessTokenEncrypted) return;

    const provider = this.providerRegistry.getProvider(row.oauthProviderId);
    if (!provider?.revocationUrl) return;

    try {
      const token = this.encryption.decrypt(row.accessTokenEncrypted);
      await fetch(provider.revocationUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
      this.logger.log(`Revoked tokens for ${mcpServerId}`);
    } catch (err) {
      this.logger.warn(`Token revocation failed for ${mcpServerId}: ${(err as Error).message}`);
    }
  }

  /**
   * Clean up expired OAuth states (>10 min old).
   */
  async cleanupExpiredStates(): Promise<number> {
    const result = await this.prisma.oAuthState.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired OAuth state(s)`);
    }
    return result.count;
  }

  private async exchangeCodeForTokens(
    provider: OAuthProviderConfig,
    code: string,
    encryptedCodeVerifier: string | null,
  ): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number }> {
    const clientId = this.config.get<string>(provider.clientIdEnvVar);
    const clientSecret = this.config.get<string>(provider.clientSecretEnvVar);

    if (!clientId || !clientSecret) {
      throw new Error(`Missing OAuth credentials for provider ${provider.providerId}`);
    }

    const params: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: this.getCallbackUrl(),
    };

    if (encryptedCodeVerifier) {
      params.code_verifier = this.encryption.decrypt(encryptedCodeVerifier);
    }

    const response = await fetch(provider.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed: HTTP ${response.status} — ${text}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
    };
  }

  private getCallbackUrl(): string {
    const baseUrl = this.config.get<string>('BASE_URL', 'http://localhost:3001');
    return `${baseUrl}/api/connectors/oauth/callback`;
  }
}
