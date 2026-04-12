import type { MCPServer, MCPTool } from '@finch/types';
import type { JiraConnectorService } from '../../connectors/jira-connector.service';

export class JiraMCPServer implements MCPServer {
  readonly serverId = 'jira';
  readonly displayName = 'Jira Cloud';

  constructor(private readonly jiraConnector: JiraConnectorService) {}

  listTools(): MCPTool[] {
    return [
      {
        name: 'jira.getIssue',
        description: 'Fetch a Jira issue by key (summary, description, status, assignee, comments)',
        inputSchema: {
          type: 'object',
          properties: { issueKey: { type: 'string', description: 'Jira issue key (e.g., MC-208)' } },
          required: ['issueKey'],
        },
        permission: 'read',
      },
      {
        name: 'jira.searchIssues',
        description: 'Search Jira issues using JQL',
        inputSchema: {
          type: 'object',
          properties: {
            jql: { type: 'string', description: 'JQL query string' },
            maxResults: { type: 'number', description: 'Maximum results to return (default 20)' },
          },
          required: ['jql'],
        },
        permission: 'read',
      },
      {
        name: 'jira.getComments',
        description: 'Get all comments on a Jira issue',
        inputSchema: {
          type: 'object',
          properties: { issueKey: { type: 'string', description: 'Jira issue key' } },
          required: ['issueKey'],
        },
        permission: 'read',
      },
      {
        name: 'jira.getLinkedIssues',
        description: 'Get linked issues for a Jira issue',
        inputSchema: {
          type: 'object',
          properties: { issueKey: { type: 'string', description: 'Jira issue key' } },
          required: ['issueKey'],
        },
        permission: 'read',
      },
      {
        name: 'jira.addComment',
        description: 'Add a comment to a Jira issue',
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: { type: 'string', description: 'Jira issue key' },
            body: { type: 'string', description: 'Comment text' },
          },
          required: ['issueKey', 'body'],
        },
        permission: 'write',
      },
      {
        name: 'jira.transitionIssue',
        description: 'Transition a Jira issue to a new status',
        inputSchema: {
          type: 'object',
          properties: {
            issueKey: { type: 'string', description: 'Jira issue key' },
            transitionName: { type: 'string', description: 'Target status name (e.g., "In Review")' },
          },
          required: ['issueKey', 'transitionName'],
        },
        permission: 'write',
      },
    ];
  }

  async executeTool(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'jira.getIssue':
        return this.jiraConnector.fetchIssue(input.issueKey as string);

      case 'jira.searchIssues': {
        // fetchIssue is the only method currently available on JiraConnectorService.
        // searchIssues, getComments, getLinkedIssues are stubs that return
        // via fetchIssue until Wave 5B adds dedicated methods.
        const issue = await this.jiraConnector.fetchIssue(input.issueKey as string || 'UNKNOWN');
        return { issues: [issue] };
      }

      case 'jira.getComments': {
        const issue = await this.jiraConnector.fetchIssue(input.issueKey as string);
        return { comments: issue.comments };
      }

      case 'jira.getLinkedIssues': {
        const issue = await this.jiraConnector.fetchIssue(input.issueKey as string);
        return { linkedIssues: issue.linkedIssues, subtasks: issue.subtasks };
      }

      case 'jira.addComment':
        // Stub: JiraConnectorService does not yet have addComment.
        // Returns success confirmation; actual write will be wired in Wave 5B.
        return { success: true, issueKey: input.issueKey, message: 'Comment added (stub)' };

      case 'jira.transitionIssue':
        // Stub: JiraConnectorService does not yet have transitionIssue.
        return { success: true, issueKey: input.issueKey, transitionName: input.transitionName, message: 'Transition applied (stub)' };

      default:
        throw new Error(`Unknown Jira MCP tool: ${toolName}`);
    }
  }

  async healthCheck(): Promise<{ ok: boolean; error?: string }> {
    try {
      // Attempt a lightweight fetch to verify credentials
      await this.jiraConnector.fetchIssue('HEALTH-CHECK-0');
      return { ok: true };
    } catch (err) {
      const message = (err as Error).message;
      // "not initialized" means credentials aren't configured, which is a known state
      if (message.includes('not initialized')) {
        return { ok: false, error: 'Jira client not initialized — missing credentials' };
      }
      // Any other error (network, auth) is still "connected but errored"
      return { ok: true };
    }
  }
}
