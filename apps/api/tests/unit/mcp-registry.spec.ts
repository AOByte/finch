import { describe, it, expect, vi } from 'vitest';
import { MCPRegistryService } from '../../src/mcp/mcp-registry.service';
import type { MCPServer, MCPTool } from '@finch/types';

function makeMockServer(
  serverId: string,
  tools: MCPTool[],
  overrides?: Partial<MCPServer>,
): MCPServer {
  return {
    serverId,
    displayName: `${serverId} display`,
    listTools: () => tools,
    executeTool: vi.fn().mockResolvedValue({ ok: true }),
    healthCheck: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

const readTool: MCPTool = {
  name: 'jira.getIssue',
  description: 'Get issue',
  inputSchema: { type: 'object', properties: {}, required: [] },
  permission: 'read',
};

const writeTool: MCPTool = {
  name: 'jira.addComment',
  description: 'Add comment',
  inputSchema: { type: 'object', properties: {}, required: [] },
  permission: 'write',
};

describe('MCPRegistryService', () => {
  it('registerServer adds a server for a harness', () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [readTool]);
    registry.registerServer('h1', server);
    expect(registry.getServersForHarness('h1')).toEqual([server]);
  });

  it('registerServer replaces existing server with same serverId', () => {
    const registry = new MCPRegistryService();
    const server1 = makeMockServer('jira', [readTool]);
    const server2 = makeMockServer('jira', [readTool, writeTool]);
    registry.registerServer('h1', server1);
    registry.registerServer('h1', server2);
    expect(registry.getServersForHarness('h1')).toHaveLength(1);
    expect(registry.getServersForHarness('h1')[0]).toBe(server2);
  });

  it('registerServer adds multiple different servers for a harness', () => {
    const registry = new MCPRegistryService();
    const jira = makeMockServer('jira', [readTool]);
    const github = makeMockServer('github', []);
    registry.registerServer('h1', jira);
    registry.registerServer('h1', github);
    expect(registry.getServersForHarness('h1')).toHaveLength(2);
  });

  it('unregisterServer removes a server by serverId', () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [readTool]);
    registry.registerServer('h1', server);
    registry.unregisterServer('h1', 'jira');
    expect(registry.getServersForHarness('h1')).toHaveLength(0);
  });

  it('unregisterServer is a no-op for unknown harness', () => {
    const registry = new MCPRegistryService();
    registry.unregisterServer('nonexistent', 'jira');
    expect(registry.getServersForHarness('nonexistent')).toHaveLength(0);
  });

  it('getServersForHarness returns empty array for unknown harness', () => {
    const registry = new MCPRegistryService();
    expect(registry.getServersForHarness('unknown')).toEqual([]);
  });

  // --- Phase-filtered tool listing (FC-04) ---

  it('listToolsForHarness returns all tools in EXECUTE phase', () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [readTool, writeTool]);
    registry.registerServer('h1', server);
    const tools = registry.listToolsForHarness('h1', 'EXECUTE');
    expect(tools).toHaveLength(2);
  });

  it('listToolsForHarness returns all tools in SHIP phase', () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [readTool, writeTool]);
    registry.registerServer('h1', server);
    const tools = registry.listToolsForHarness('h1', 'SHIP');
    expect(tools).toHaveLength(2);
  });

  it('listToolsForHarness returns only read tools in TRIGGER phase', () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [readTool, writeTool]);
    registry.registerServer('h1', server);
    const tools = registry.listToolsForHarness('h1', 'TRIGGER');
    expect(tools).toHaveLength(1);
    expect(tools[0].permission).toBe('read');
  });

  it('listToolsForHarness returns only read tools in ACQUIRE phase', () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [readTool, writeTool]);
    registry.registerServer('h1', server);
    const tools = registry.listToolsForHarness('h1', 'ACQUIRE');
    expect(tools).toHaveLength(1);
    expect(tools[0].permission).toBe('read');
  });

  it('listToolsForHarness returns only read tools in PLAN phase', () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [readTool, writeTool]);
    registry.registerServer('h1', server);
    const tools = registry.listToolsForHarness('h1', 'PLAN');
    expect(tools).toHaveLength(1);
    expect(tools[0].permission).toBe('read');
  });

  it('listToolsForHarness returns empty for unknown harness', () => {
    const registry = new MCPRegistryService();
    expect(registry.listToolsForHarness('unknown', 'EXECUTE')).toEqual([]);
  });

  it('listToolsForHarness aggregates tools from multiple servers', () => {
    const registry = new MCPRegistryService();
    const jiraRead: MCPTool = { ...readTool, name: 'jira.getIssue' };
    const slackRead: MCPTool = { ...readTool, name: 'slack.getChannelHistory' };
    const slackWrite: MCPTool = { ...writeTool, name: 'slack.postMessage' };
    registry.registerServer('h1', makeMockServer('jira', [jiraRead]));
    registry.registerServer('h1', makeMockServer('slack', [slackRead, slackWrite]));

    const execTools = registry.listToolsForHarness('h1', 'EXECUTE');
    expect(execTools).toHaveLength(3);

    const planTools = registry.listToolsForHarness('h1', 'PLAN');
    expect(planTools).toHaveLength(2);
    expect(planTools.every(t => t.permission === 'read')).toBe(true);
  });

  // --- executeTool ---

  it('executeTool routes to the correct server and tool', async () => {
    const registry = new MCPRegistryService();
    const executeFn = vi.fn().mockResolvedValue({ key: 'MC-208' });
    const server = makeMockServer('jira', [readTool], { executeTool: executeFn });
    registry.registerServer('h1', server);

    const result = await registry.executeTool('h1', 'jira.getIssue', { issueKey: 'MC-208' }, 'ACQUIRE');
    expect(result).toEqual({ key: 'MC-208' });
    expect(executeFn).toHaveBeenCalledWith('jira.getIssue', { issueKey: 'MC-208' });
  });

  it('executeTool throws for unknown server prefix', async () => {
    const registry = new MCPRegistryService();
    await expect(
      registry.executeTool('h1', 'unknown.tool', {}, 'EXECUTE'),
    ).rejects.toThrow('No MCP server found for tool: unknown.tool');
  });

  it('executeTool throws for unknown tool on a known server', async () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [readTool]);
    registry.registerServer('h1', server);
    await expect(
      registry.executeTool('h1', 'jira.nonExistent', {}, 'EXECUTE'),
    ).rejects.toThrow('Unknown MCP tool: jira.nonExistent');
  });

  it('executeTool rejects write tool in PLAN phase (FC-04)', async () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [readTool, writeTool]);
    registry.registerServer('h1', server);
    await expect(
      registry.executeTool('h1', 'jira.addComment', { issueKey: 'X', body: 'test' }, 'PLAN'),
    ).rejects.toThrow('FC-04 violation: write tool "jira.addComment" not permitted in PLAN phase');
  });

  it('executeTool rejects write tool in TRIGGER phase (FC-04)', async () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [writeTool]);
    registry.registerServer('h1', server);
    await expect(
      registry.executeTool('h1', 'jira.addComment', {}, 'TRIGGER'),
    ).rejects.toThrow('FC-04 violation');
  });

  it('executeTool rejects write tool in ACQUIRE phase (FC-04)', async () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [writeTool]);
    registry.registerServer('h1', server);
    await expect(
      registry.executeTool('h1', 'jira.addComment', {}, 'ACQUIRE'),
    ).rejects.toThrow('FC-04 violation');
  });

  it('executeTool allows write tool in EXECUTE phase', async () => {
    const registry = new MCPRegistryService();
    const executeFn = vi.fn().mockResolvedValue({ success: true });
    const server = makeMockServer('jira', [writeTool], { executeTool: executeFn });
    registry.registerServer('h1', server);

    const result = await registry.executeTool('h1', 'jira.addComment', { body: 'hi' }, 'EXECUTE');
    expect(result).toEqual({ success: true });
  });

  it('executeTool allows write tool in SHIP phase', async () => {
    const registry = new MCPRegistryService();
    const executeFn = vi.fn().mockResolvedValue({ success: true });
    const server = makeMockServer('jira', [writeTool], { executeTool: executeFn });
    registry.registerServer('h1', server);

    const result = await registry.executeTool('h1', 'jira.addComment', {}, 'SHIP');
    expect(result).toEqual({ success: true });
  });

  it('executeTool allows read tool in any phase', async () => {
    const registry = new MCPRegistryService();
    const executeFn = vi.fn().mockResolvedValue({ data: 'issue' });
    const server = makeMockServer('jira', [readTool], { executeTool: executeFn });
    registry.registerServer('h1', server);

    for (const phase of ['TRIGGER', 'ACQUIRE', 'PLAN', 'EXECUTE', 'SHIP'] as const) {
      const result = await registry.executeTool('h1', 'jira.getIssue', {}, phase);
      expect(result).toEqual({ data: 'issue' });
    }
    expect(executeFn).toHaveBeenCalledTimes(5);
  });

  // --- getToolPermission ---

  it('getToolPermission returns read for a read tool', () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [readTool, writeTool]);
    registry.registerServer('h1', server);
    expect(registry.getToolPermission('h1', 'jira.getIssue')).toBe('read');
  });

  it('getToolPermission returns write for a write tool', () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [readTool, writeTool]);
    registry.registerServer('h1', server);
    expect(registry.getToolPermission('h1', 'jira.addComment')).toBe('write');
  });

  it('getToolPermission returns undefined for unknown server', () => {
    const registry = new MCPRegistryService();
    expect(registry.getToolPermission('h1', 'unknown.tool')).toBeUndefined();
  });

  it('getToolPermission returns undefined for unknown tool on known server', () => {
    const registry = new MCPRegistryService();
    const server = makeMockServer('jira', [readTool]);
    registry.registerServer('h1', server);
    expect(registry.getToolPermission('h1', 'jira.nonExistent')).toBeUndefined();
  });
});
