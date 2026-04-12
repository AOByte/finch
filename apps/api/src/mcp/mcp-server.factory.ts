import { Injectable, Logger } from '@nestjs/common';
import { CredentialEncryptionService } from '../connectors/credential-encryption.service';
import { JiraConnectorService } from '../connectors/jira-connector.service';
import { GitHubAcquireConnectorService } from '../connectors/github-acquire-connector.service';
import { GitHubExecuteConnectorService } from '../connectors/github-execute-connector.service';
import { GitHubShipConnectorService } from '../connectors/github-ship-connector.service';
import { SlackConnectorService } from '../connectors/slack-connector.service';
import { JiraMCPServer } from './servers/jira-mcp-server';
import { GitHubMCPServer } from './servers/github-mcp-server';
import { SlackMCPServer } from './servers/slack-mcp-server';
import type { MCPServer } from '@finch/types';

export interface MCPServerRow {
  mcpServerId: string;
  harnessId: string;
  serverType: string;
  displayName: string;
  configEncrypted: string;
  isActive: boolean;
  healthStatus: string;
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
  ) {}

  createFromRow(row: MCPServerRow): MCPServer | null {
    try {
      const _config = JSON.parse(this.encryption.decrypt(row.configEncrypted)) as Record<string, unknown>;

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
          this.logger.warn(`Unknown MCP server type: ${row.serverType}`);
          return null;
      }
    } catch (err) {
      this.logger.error(`Failed to create MCP server from row ${row.mcpServerId}: ${(err as Error).message}`);
      return null;
    }
  }

  getSupportedTypes(): string[] {
    return ['jira', 'github', 'slack'];
  }
}
