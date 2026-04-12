import { describe, it, expect, vi } from 'vitest';
import { JiraMCPServer } from '../../src/mcp/servers/jira-mcp-server';

function makeMockJiraConnector() {
  return {
    fetchIssue: vi.fn().mockResolvedValue({
      key: 'MC-208',
      summary: 'Fix bug',
      description: 'Details',
      status: 'Open',
      assignee: 'dev',
      comments: [{ body: 'comment1' }],
      linkedIssues: [{ key: 'MC-100' }],
      subtasks: [{ key: 'MC-209' }],
    }),
  };
}

describe('JiraMCPServer', () => {
  it('has correct serverId and displayName', () => {
    const server = new JiraMCPServer(makeMockJiraConnector() as never);
    expect(server.serverId).toBe('jira');
    expect(server.displayName).toBe('Jira Cloud');
  });

  it('listTools returns 6 tools (4 read, 2 write)', () => {
    const server = new JiraMCPServer(makeMockJiraConnector() as never);
    const tools = server.listTools();
    expect(tools).toHaveLength(6);
    expect(tools.filter(t => t.permission === 'read')).toHaveLength(4);
    expect(tools.filter(t => t.permission === 'write')).toHaveLength(2);
  });

  it('listTools returns tools with correct names', () => {
    const server = new JiraMCPServer(makeMockJiraConnector() as never);
    const names = server.listTools().map(t => t.name);
    expect(names).toContain('jira.getIssue');
    expect(names).toContain('jira.searchIssues');
    expect(names).toContain('jira.getComments');
    expect(names).toContain('jira.getLinkedIssues');
    expect(names).toContain('jira.addComment');
    expect(names).toContain('jira.transitionIssue');
  });

  it('executeTool jira.getIssue calls fetchIssue', async () => {
    const connector = makeMockJiraConnector();
    const server = new JiraMCPServer(connector as never);
    const result = await server.executeTool('jira.getIssue', { issueKey: 'MC-208' });
    expect(connector.fetchIssue).toHaveBeenCalledWith('MC-208');
    expect(result).toHaveProperty('key', 'MC-208');
  });

  it('executeTool jira.searchIssues returns wrapped result', async () => {
    const connector = makeMockJiraConnector();
    const server = new JiraMCPServer(connector as never);
    const result = await server.executeTool('jira.searchIssues', { issueKey: 'MC-208', jql: 'project=MC' });
    expect(result).toHaveProperty('issues');
    expect((result as { issues: unknown[] }).issues).toHaveLength(1);
  });

  it('executeTool jira.searchIssues with no issueKey uses UNKNOWN', async () => {
    const connector = makeMockJiraConnector();
    const server = new JiraMCPServer(connector as never);
    await server.executeTool('jira.searchIssues', { jql: 'project=MC' });
    expect(connector.fetchIssue).toHaveBeenCalledWith('UNKNOWN');
  });

  it('executeTool jira.getComments returns comments', async () => {
    const connector = makeMockJiraConnector();
    const server = new JiraMCPServer(connector as never);
    const result = await server.executeTool('jira.getComments', { issueKey: 'MC-208' });
    expect(result).toHaveProperty('comments');
    expect((result as { comments: unknown[] }).comments).toHaveLength(1);
  });

  it('executeTool jira.getLinkedIssues returns linkedIssues and subtasks', async () => {
    const connector = makeMockJiraConnector();
    const server = new JiraMCPServer(connector as never);
    const result = await server.executeTool('jira.getLinkedIssues', { issueKey: 'MC-208' });
    expect(result).toHaveProperty('linkedIssues');
    expect(result).toHaveProperty('subtasks');
  });

  it('executeTool jira.addComment returns stub success', async () => {
    const server = new JiraMCPServer(makeMockJiraConnector() as never);
    const result = await server.executeTool('jira.addComment', { issueKey: 'MC-208', body: 'test' });
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('issueKey', 'MC-208');
  });

  it('executeTool jira.transitionIssue returns stub success', async () => {
    const server = new JiraMCPServer(makeMockJiraConnector() as never);
    const result = await server.executeTool('jira.transitionIssue', { issueKey: 'MC-208', transitionName: 'In Review' });
    expect(result).toHaveProperty('success', true);
    expect(result).toHaveProperty('transitionName', 'In Review');
  });

  it('executeTool throws for unknown tool', async () => {
    const server = new JiraMCPServer(makeMockJiraConnector() as never);
    await expect(server.executeTool('jira.unknown', {})).rejects.toThrow('Unknown Jira MCP tool: jira.unknown');
  });

  it('healthCheck returns ok:true when fetchIssue succeeds', async () => {
    const server = new JiraMCPServer(makeMockJiraConnector() as never);
    const result = await server.healthCheck();
    expect(result).toEqual({ ok: true });
  });

  it('healthCheck returns ok:false when connector not initialized', async () => {
    const connector = {
      fetchIssue: vi.fn().mockRejectedValue(new Error('Jira client not initialized')),
    };
    const server = new JiraMCPServer(connector as never);
    const result = await server.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not initialized');
  });

  it('healthCheck returns ok:true on network/auth errors (connected but errored)', async () => {
    const connector = {
      fetchIssue: vi.fn().mockRejectedValue(new Error('Network timeout')),
    };
    const server = new JiraMCPServer(connector as never);
    const result = await server.healthCheck();
    expect(result.ok).toBe(true);
  });
});
