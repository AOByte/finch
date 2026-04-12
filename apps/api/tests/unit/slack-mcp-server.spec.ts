import { describe, it, expect, vi } from 'vitest';
import { SlackMCPServer } from '../../src/mcp/servers/slack-mcp-server';

function makeMockSlackConnector() {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    isInitialized: vi.fn().mockReturnValue(true),
  };
}

describe('SlackMCPServer', () => {
  it('has correct serverId and displayName', () => {
    const server = new SlackMCPServer(makeMockSlackConnector() as never);
    expect(server.serverId).toBe('slack');
    expect(server.displayName).toBe('Slack');
  });

  it('listTools returns 2 tools (1 read, 1 write)', () => {
    const server = new SlackMCPServer(makeMockSlackConnector() as never);
    const tools = server.listTools();
    expect(tools).toHaveLength(2);
    expect(tools.filter(t => t.permission === 'read')).toHaveLength(1);
    expect(tools.filter(t => t.permission === 'write')).toHaveLength(1);
  });

  it('listTools returns tools with correct names', () => {
    const server = new SlackMCPServer(makeMockSlackConnector() as never);
    const names = server.listTools().map(t => t.name);
    expect(names).toContain('slack.getChannelHistory');
    expect(names).toContain('slack.postMessage');
  });

  it('executeTool slack.getChannelHistory returns stub', async () => {
    const server = new SlackMCPServer(makeMockSlackConnector() as never);
    const result = await server.executeTool('slack.getChannelHistory', { channel: 'C123', limit: 10 });
    expect(result).toHaveProperty('messages');
    expect(result).toHaveProperty('channel', 'C123');
  });

  it('executeTool slack.postMessage calls sendMessage', async () => {
    const connector = makeMockSlackConnector();
    const server = new SlackMCPServer(connector as never);
    const result = await server.executeTool('slack.postMessage', {
      channel: 'C123', text: 'hello', threadTs: 'ts1',
    });
    expect(result).toEqual({ success: true, channel: 'C123' });
    expect(connector.sendMessage).toHaveBeenCalledWith({
      channelId: 'C123',
      threadTs: 'ts1',
      message: 'hello',
    });
  });

  it('executeTool slack.postMessage defaults threadTs to empty string', async () => {
    const connector = makeMockSlackConnector();
    const server = new SlackMCPServer(connector as never);
    await server.executeTool('slack.postMessage', { channel: 'C123', text: 'hi' });
    expect(connector.sendMessage).toHaveBeenCalledWith({
      channelId: 'C123',
      threadTs: '',
      message: 'hi',
    });
  });

  it('executeTool throws for unknown tool', async () => {
    const server = new SlackMCPServer(makeMockSlackConnector() as never);
    await expect(server.executeTool('slack.unknown', {})).rejects.toThrow('Unknown Slack MCP tool');
  });

  it('healthCheck returns ok:true when initialized', async () => {
    const server = new SlackMCPServer(makeMockSlackConnector() as never);
    const result = await server.healthCheck();
    expect(result).toEqual({ ok: true });
  });

  it('healthCheck returns ok:false when not initialized', async () => {
    const connector = makeMockSlackConnector();
    connector.isInitialized.mockReturnValue(false);
    const server = new SlackMCPServer(connector as never);
    const result = await server.healthCheck();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('not initialized');
  });
});
