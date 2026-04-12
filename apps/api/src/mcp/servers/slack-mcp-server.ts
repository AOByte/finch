import type { MCPServer, MCPTool } from '@finch/types';
import type { SlackConnectorService } from '../../connectors/slack-connector.service';

export class SlackMCPServer implements MCPServer {
  readonly serverId = 'slack';
  readonly displayName = 'Slack';

  constructor(private readonly slackConnector: SlackConnectorService) {}

  listTools(): MCPTool[] {
    return [
      {
        name: 'slack.getChannelHistory',
        description: 'Read recent messages from a Slack channel',
        inputSchema: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Slack channel ID' },
            limit: { type: 'number', description: 'Maximum messages to return (default 20)' },
          },
          required: ['channel'],
        },
        permission: 'read',
      },
      {
        name: 'slack.postMessage',
        description: 'Post a message to a Slack channel or thread',
        inputSchema: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Slack channel ID' },
            text: { type: 'string', description: 'Message text' },
            threadTs: { type: 'string', description: 'Thread timestamp for replies (optional)' },
          },
          required: ['channel', 'text'],
        },
        permission: 'write',
      },
    ];
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'slack.getChannelHistory':
        // Stub: SlackConnectorService does not have getChannelHistory yet.
        return { messages: [], channel: input.channel, message: 'Channel history not yet implemented' };

      case 'slack.postMessage':
        await this.slackConnector.sendMessage({
          channelId: input.channel as string,
          threadTs: (input.threadTs as string) ?? '',
          message: input.text as string,
        });
        return { success: true, channel: input.channel };

      default:
        throw new Error(`Unknown Slack MCP tool: ${toolName}`);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    if (this.slackConnector.isInitialized()) {
      return { ok: true };
    }
    return { ok: false, error: 'Slack connector not initialized — missing credentials' };
  }
}
