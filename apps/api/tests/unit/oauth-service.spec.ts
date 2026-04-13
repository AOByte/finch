import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuthService } from '../../src/oauth/oauth.service';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeMocks() {
  const mockPrisma = {
    oAuthState: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    mcpServer: {
      create: vi.fn().mockResolvedValue({ mcpServerId: 'mcp-1' }),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  };

  const mockEncryption = {
    encrypt: vi.fn().mockImplementation((val: string) => `enc:${val}`),
    decrypt: vi.fn().mockImplementation((val: string) => val.replace('enc:', '')),
  };

  const mockProviderRegistry = {
    getProvider: vi.fn().mockReturnValue({
      providerId: 'figma',
      displayName: 'Figma',
      authorizationUrl: 'https://www.figma.com/oauth',
      tokenUrl: 'https://api.figma.com/v1/oauth/token',
      revocationUrl: null,
      scopes: ['files:read'],
      clientIdEnvVar: 'FIGMA_CLIENT_ID',
      clientSecretEnvVar: 'FIGMA_CLIENT_SECRET',
      supportsPKCE: true,
      tokenPassingStrategy: 'env',
      tokenEnvVar: 'FIGMA_ACCESS_TOKEN',
    }),
    listProviders: vi.fn().mockReturnValue([]),
    hasProvider: vi.fn().mockReturnValue(true),
  };

  const mockConfig = {
    get: vi.fn().mockImplementation((key: string, defaultVal?: string) => {
      const map: Record<string, string> = {
        FIGMA_CLIENT_ID: 'client-id-123',
        FIGMA_CLIENT_SECRET: 'client-secret-456',
        BASE_URL: 'http://localhost:3001',
      };
      return map[key] ?? defaultVal;
    }),
  };

  return { mockPrisma, mockEncryption, mockProviderRegistry, mockConfig };
}

function makeService(mocks: ReturnType<typeof makeMocks>) {
  return new OAuthService(
    mocks.mockPrisma as never,
    mocks.mockEncryption as never,
    mocks.mockProviderRegistry as never,
    mocks.mockConfig as never,
  );
}

describe('OAuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateAuthUrl', () => {
    it('generates URL with state and PKCE for supported provider', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      const result = await service.generateAuthUrl('figma', 'harness-1');
      expect(result.url).toContain('https://www.figma.com/oauth');
      expect(result.url).toContain('client_id=client-id-123');
      expect(result.url).toContain('code_challenge');
      expect(result.url).toContain('code_challenge_method=S256');
      expect(result.state).toBeTruthy();
      expect(mocks.mockPrisma.oAuthState.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            harnessId: 'harness-1',
            providerId: 'figma',
          }),
        }),
      );
    });

    it('generates URL without PKCE for non-PKCE provider', async () => {
      const mocks = makeMocks();
      mocks.mockProviderRegistry.getProvider.mockReturnValue({
        providerId: 'github',
        displayName: 'GitHub',
        authorizationUrl: 'https://github.com/login/oauth/authorize',
        tokenUrl: 'https://github.com/login/oauth/access_token',
        scopes: ['repo'],
        clientIdEnvVar: 'GITHUB_CLIENT_ID',
        clientSecretEnvVar: 'GITHUB_CLIENT_SECRET',
        supportsPKCE: false,
        tokenPassingStrategy: 'header',
      });
      mocks.mockConfig.get.mockImplementation((key: string) => {
        if (key === 'GITHUB_CLIENT_ID') return 'gh-client';
        if (key === 'BASE_URL') return 'http://localhost:3001';
        return undefined;
      });
      const service = makeService(mocks);
      const result = await service.generateAuthUrl('github', 'h1');
      expect(result.url).not.toContain('code_challenge');
      expect(result.url).toContain('client_id=gh-client');
    });

    it('throws for unknown provider', async () => {
      const mocks = makeMocks();
      mocks.mockProviderRegistry.getProvider.mockReturnValue(undefined);
      const service = makeService(mocks);
      await expect(service.generateAuthUrl('unknown', 'h1')).rejects.toThrow('Unknown OAuth provider');
    });

    it('throws when client ID env var is missing', async () => {
      const mocks = makeMocks();
      mocks.mockConfig.get.mockReturnValue(undefined);
      const service = makeService(mocks);
      await expect(service.generateAuthUrl('figma', 'h1')).rejects.toThrow('Missing env var');
    });
  });

  describe('handleCallback', () => {
    it('exchanges code for tokens and returns mcpServerId', async () => {
      const mocks = makeMocks();
      mocks.mockPrisma.oAuthState.findUnique.mockResolvedValue({
        id: 'state-id', state: 'test-state', harnessId: 'h1', providerId: 'figma',
        codeVerifier: 'enc:verifier123', expiresAt: new Date(Date.now() + 600_000),
      });
      mocks.mockPrisma.mcpServer.create.mockResolvedValue({ mcpServerId: 'mcp-new' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'at-123', refresh_token: 'rt-456', expires_in: 3600 }),
      });
      const service = makeService(mocks);
      const mcpServerId = await service.handleCallback('test-state', 'auth-code');
      expect(mcpServerId).toBe('mcp-new');
      expect(mocks.mockPrisma.mcpServer.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ harnessId: 'h1', serverType: 'figma' }) }),
      );
      expect(mocks.mockPrisma.oAuthState.delete).toHaveBeenCalledWith({ where: { id: 'state-id' } });
    });

    it('throws for invalid state', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await expect(service.handleCallback('bad-state', 'code')).rejects.toThrow('Invalid OAuth state');
    });

    it('throws for expired state', async () => {
      const mocks = makeMocks();
      mocks.mockPrisma.oAuthState.findUnique.mockResolvedValue({
        id: 'state-id', state: 'old-state', harnessId: 'h1', providerId: 'figma',
        codeVerifier: null, expiresAt: new Date(Date.now() - 60_000),
      });
      const service = makeService(mocks);
      await expect(service.handleCallback('old-state', 'code')).rejects.toThrow('expired');
    });
  });

  describe('refreshTokens', () => {
    it('refreshes tokens and returns new access token', async () => {
      const mocks = makeMocks();
      mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
        mcpServerId: 'mcp-1', oauthProviderId: 'figma',
        refreshTokenEncrypted: 'enc:rt-old', accessTokenEncrypted: 'enc:at-old',
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 7200 }),
      });
      const service = makeService(mocks);
      const newToken = await service.refreshTokens('mcp-1');
      expect(newToken).toBe('at-new');
      expect(mocks.mockPrisma.mcpServer.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { mcpServerId: 'mcp-1' }, data: expect.objectContaining({ healthStatus: 'healthy' }) }),
      );
    });

    it('returns null when server not found', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      expect(await service.refreshTokens('nonexistent')).toBeNull();
    });

    it('returns null when no refresh token', async () => {
      const mocks = makeMocks();
      mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
        mcpServerId: 'mcp-1', oauthProviderId: 'figma', refreshTokenEncrypted: null,
      });
      const service = makeService(mocks);
      expect(await service.refreshTokens('mcp-1')).toBeNull();
    });

    it('marks reauth_required on HTTP failure', async () => {
      const mocks = makeMocks();
      mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
        mcpServerId: 'mcp-1', oauthProviderId: 'figma', refreshTokenEncrypted: 'enc:rt',
      });
      mockFetch.mockResolvedValue({ ok: false, status: 400 });
      const service = makeService(mocks);
      expect(await service.refreshTokens('mcp-1')).toBeNull();
      expect(mocks.mockPrisma.mcpServer.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ healthStatus: 'reauth_required' }) }),
      );
    });

    it('marks reauth_required on network error', async () => {
      const mocks = makeMocks();
      mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
        mcpServerId: 'mcp-1', oauthProviderId: 'figma', refreshTokenEncrypted: 'enc:rt',
      });
      mockFetch.mockRejectedValue(new Error('Network error'));
      const service = makeService(mocks);
      expect(await service.refreshTokens('mcp-1')).toBeNull();
    });
  });

  describe('revokeTokens', () => {
    it('revokes tokens when revocation URL exists', async () => {
      const mocks = makeMocks();
      mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
        mcpServerId: 'mcp-1', oauthProviderId: 'figma', accessTokenEncrypted: 'enc:at-123',
      });
      mocks.mockProviderRegistry.getProvider.mockReturnValue({
        providerId: 'figma', revocationUrl: 'https://api.figma.com/v1/oauth/revoke',
      });
      mockFetch.mockResolvedValue({ ok: true });
      const service = makeService(mocks);
      await service.revokeTokens('mcp-1');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.figma.com/v1/oauth/revoke',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('skips when no revocation URL', async () => {
      const mocks = makeMocks();
      mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
        mcpServerId: 'mcp-1', oauthProviderId: 'figma', accessTokenEncrypted: 'enc:at',
      });
      mocks.mockProviderRegistry.getProvider.mockReturnValue({ providerId: 'figma', revocationUrl: null });
      const service = makeService(mocks);
      await service.revokeTokens('mcp-1');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips when server not found', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      await service.revokeTokens('nonexistent');
    });

    it('handles revocation failure gracefully', async () => {
      const mocks = makeMocks();
      mocks.mockPrisma.mcpServer.findUnique.mockResolvedValue({
        mcpServerId: 'mcp-1', oauthProviderId: 'figma', accessTokenEncrypted: 'enc:at',
      });
      mocks.mockProviderRegistry.getProvider.mockReturnValue({
        providerId: 'figma', revocationUrl: 'https://api.figma.com/v1/oauth/revoke',
      });
      mockFetch.mockRejectedValue(new Error('Network error'));
      const service = makeService(mocks);
      await service.revokeTokens('mcp-1');
    });
  });

  describe('cleanupExpiredStates', () => {
    it('deletes expired states', async () => {
      const mocks = makeMocks();
      mocks.mockPrisma.oAuthState.deleteMany.mockResolvedValue({ count: 3 });
      const service = makeService(mocks);
      expect(await service.cleanupExpiredStates()).toBe(3);
    });

    it('returns 0 when nothing to clean', async () => {
      const mocks = makeMocks();
      const service = makeService(mocks);
      expect(await service.cleanupExpiredStates()).toBe(0);
    });
  });
});
