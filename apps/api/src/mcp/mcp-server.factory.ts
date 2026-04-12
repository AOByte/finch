import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { CredentialEncryptionService } from '../connectors/credential-encryption.service';
import { JiraConnectorService } from '../connectors/jira-connector.service';
import { GitHubAcquireConnectorService } from '../connectors/github-acquire-connector.service';
import { GitHubExecuteConnectorService } from '../connectors/github-execute-connector.service';
import { GitHubShipConnectorService } from '../connectors/github-ship-connector.service';
import { SlackConnectorService } from '../connectors/slack-connector.service';
import { JiraMCPServer } from './servers/jira-mcp-server';
import { GitHubMCPServer } from './servers/github-mcp-server';
import { SlackMCPServer } from './servers/slack-mcp-server';
import { ExternalMCPAdapter } from './external-mcp-adapter';
import { StdioTransport } from './transports/stdio-transport';
import { SSETransport } from './transports/sse-transport';
import type { MCPServer, MCPToolPermission } from '@finch/types';

export interface MCPServerRow {
  mcpServerId: string;
  harnessId: string;
  serverType: string;
  displayName: string;
  configEncrypted: string;
  isActive: boolean;
  healthStatus: string;
  // External MCP transport fields (nullable)
  transport?: string | null;
  command?: string | null;
  commandArgs?: string[];
  endpointUrl?: string | null;
  envEncrypted?: string | null;
  permissionOverrides?: Record<string, string> | null;
  // OAuth fields (nullable)
  oauthProviderId?: string | null;
  accessTokenEncrypted?: string | null;
  refreshTokenEncrypted?: string | null;
  tokenExpiresAt?: Date | null;
}

@Injectable()
export class MCPServerFactory {
  private readonly logger = new Logger(MCPServerFactory.name);

  constructor(
    private readonly encryption: CredentialEncryptionService,
    private readonly jiraConnector: JiraConnectorService,
    private readonly githubAcquire: GitHubAcquireConnectorService,
    private readonly githubExecute: GitHubExecuteConnectorService,
    private readonly githubShip: GitHubShipConnectorService,
    private readonly slackConnector: SlackConnectorService,
    @Optional() @Inject('OAUTH_TOKEN_REFRESHER')
    private readonly tokenRefresher?: (mcpServerId: string) => Promise<string | null>,
  ) {}

  createFromRow(row: MCPServerRow): MCPServer | null {
    try {
      const config = JSON.parse(this.encryption.decrypt(row.configEncrypted)) as Record<string, unknown>;

      // Tier 1: Internal (built-in) servers — existing fast path
      const internal = this.createInternalServer(row);
      if (internal) return internal;

      // Tier 2: External servers — create ExternalMCPAdapter
      return this.createExternalServer(row, config);
    } catch (err) {
      this.logger.error(`Failed to create MCP server from row ${row.mcpServerId}: ${(err as Error).message}`);
      return null;
    }
  }

  private createInternalServer(row: MCPServerRow): MCPServer | null {
    switch (row.serverType) {
      case 'jira':
        return new JiraMCPServer(this.jiraConnector);
      case 'github':
        return new GitHubMCPServer(
          this.githubAcquire,
          this.githubExecute,
          this.githubShip,
        );
      case 'slack':
        return new SlackMCPServer(this.slackConnector);
      default:
        return null;
    }
  }

  private createExternalServer(row: MCPServerRow, config: Record<string, unknown>): MCPServer | null {
    // Determine transport from row fields or config
    const transportType = row.transport ?? (config.transport as string | undefined);
    if (!transportType) {
      this.logger.warn(`Unknown MCP server type "${row.serverType}" with no transport config`);
      return null;
    }

    const transport = this.buildTransport(row, config, transportType);
    if (!transport) return null;

    const permissionOverrides = new Map<string, MCPToolPermission>();
    const overrides = row.permissionOverrides ?? (config.permissionOverrides as Record<string, string> | undefined);
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (value === 'read' || value === 'write') {
          permissionOverrides.set(key, value);
        }
      }
    }

    // Inject tokenRefresher callback if OAuth-based
    const refresher = row.oauthProviderId && this.tokenRefresher
      ? this.tokenRefresher
      : undefined;

    return new ExternalMCPAdapter(
      transport,
      { serverId: row.serverType, displayName: row.displayName },
      permissionOverrides,
      refresher,
      row.mcpServerId,
    );
  }

  private buildTransport(
    row: MCPServerRow,
    config: Record<string, unknown>,
    transportType: string,
  ) {
    if (transportType === 'stdio') {
      const command = row.command ?? (config.command as string);
      const args = row.commandArgs ?? (config.args as string[]) ?? [];
      const env = this.buildEnv(row, config);
      if (!command) {
        this.logger.warn(`Stdio transport for ${row.mcpServerId} missing command`);
        return null;
      }
      return new StdioTransport({ command, args, env });
    }

    if (transportType === 'sse') {
      const url = row.endpointUrl ?? (config.url as string);
      if (!url) {
        this.logger.warn(`SSE transport for ${row.mcpServerId} missing url`);
        return null;
      }
      const headers: Record<string, string> = (config.headers as Record<string, string>) ?? {};

      // If OAuth-based, inject Bearer token
      if (row.accessTokenEncrypted) {
        try {
          const token = this.encryption.decrypt(row.accessTokenEncrypted);
          headers['Authorization'] = `Bearer ${token}`;
        } catch {
          this.logger.warn(`Failed to decrypt access token for ${row.mcpServerId}`);
        }
      }
      return new SSETransport(url, headers);
    }

    this.logger.warn(`Unknown transport type "${transportType}" for ${row.mcpServerId}`);
    return null;
  }

  /**
   * Build env vars for stdio child process.
   * SECURITY: Plaintext token exists only in child process memory at spawn time.
   * envEncrypted in DB is for at-rest storage only.
   */
  private buildEnv(row: MCPServerRow, config: Record<string, unknown>): Record<string, string> {
    let env: Record<string, string> = {};

    // Decrypt envEncrypted → plaintext env vars
    if (row.envEncrypted) {
      try {
        env = JSON.parse(this.encryption.decrypt(row.envEncrypted)) as Record<string, string>;
      } catch {
        this.logger.warn(`Failed to decrypt env for ${row.mcpServerId}`);
      }
    } else if (config.env) {
      env = config.env as Record<string, string>;
    }

    // If OAuth-based, inject access token as the configured env var
    if (row.accessTokenEncrypted && row.oauthProviderId) {
      try {
        const token = this.encryption.decrypt(row.accessTokenEncrypted);
        const tokenKey = (config.tokenEnvVar as string) ?? `${row.oauthProviderId.toUpperCase()}_ACCESS_TOKEN`;
        env[tokenKey] = token;
      } catch {
        this.logger.warn(`Failed to decrypt access token for ${row.mcpServerId}`);
      }
    }

    return env;
  }

  getSupportedTypes(): string[] {
    return ['jira', 'github', 'slack'];
  }
}
