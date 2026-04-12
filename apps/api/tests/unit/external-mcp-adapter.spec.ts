import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExternalMCPAdapter } from '../../src/mcp/external-mcp-adapter';
import type { MCPTransport } from '../../src/mcp/transports/mcp-transport.interface';

function makeMockTransport(): MCPTransport {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    sendRequest: vi.fn().mockResolvedValue({ tools: [] }),
    close: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    updateCredentials: vi.fn(),
  };
}

describe('ExternalMCPAdapter', () => {
  let transport: MCPTransport;
  let adapter: ExternalMCPAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = makeMockTransport();
    adapter = new ExternalMCPAdapter(
      transport,
      { serverId: 'figma', displayName: 'Figma' },
      new Map(),
      undefined,
      'mcp-1',
    );
  });

  it('has correct serverId and displayName', () => {
    expect(adapter.serverId).toBe('figma');
    expect(adapter.displayName).toBe('Figma');
  });

  it('isReady returns false before connect', () => {
    expect(adapter.isReady()).toBe(false);
  });

  it('connect initializes transport and refreshes tools', async () => {
    (transport.sendRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      tools: [{ name: 'get_file', description: 'Get a Figma file' }],
    });

    await adapter.connect();

    expect(transport.initialize).toHaveBeenCalled();
    expect(transport.sendRequest).toHaveBeenCalledWith('tools/list');
    expect(adapter.isReady()).toBe(true);
  });

  it('listTools returns prefixed tools with default read permission', async () => {
    (transport.sendRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      tools: [
        { name: 'get_file', description: 'Get file', inputSchema: { type: 'object' } },
        { name: 'list_projects', description: 'List projects' },
      ],
    });

    await adapter.connect();
    const tools = adapter.listTools();

    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('figma.get_file');
    expect(tools[0].permission).toBe('read');
    expect(tools[1].name).toBe('figma.list_projects');
    expect(tools[1].permission).toBe('read');
  });

  it('permission overrides are applied', async () => {
    const overrides = new Map([['update_file', 'write' as const]]);
    const adapterWithOverrides = new ExternalMCPAdapter(
      transport,
      { serverId: 'figma', displayName: 'Figma' },
      overrides,
    );

    (transport.sendRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
      tools: [
        { name: 'get_file', description: 'Read' },
        { name: 'update_file', description: 'Write' },
      ],
    });

    await adapterWithOverrides.connect();
    const tools = adapterWithOverrides.listTools();

    expect(tools[0].permission).toBe('read');
    expect(tools[1].permission).toBe('write');
  });

  it('executeTool strips prefix and calls transport', async () => {
    (transport.sendRequest as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ tools: [] }) // tools/list
      .mockResolvedValueOnce({ content: 'file data' }); // tools/call

    await adapter.connect();
    const result = await adapter.executeTool('figma.get_file', { fileId: '123' });

    expect(transport.sendRequest).toHaveBeenCalledWith('tools/call', {
      name: 'get_file',
      arguments: { fileId: '123' },
    });
    expect(result).toEqual({ content: 'file data' });
  });

  it('executeTool retries on 401 with token refresh', async () => {
    const tokenRefresher = vi.fn().mockResolvedValue('new-token');
    const adapterWithRefresh = new ExternalMCPAdapter(
      transport,
      { serverId: 'figma', displayName: 'Figma' },
      new Map(),
      tokenRefresher,
      'mcp-1',
    );

    const authError = new Error('HTTP 401: Unauthorized');
    (authError as unknown as Record<string, unknown>).status = 401;

    (transport.sendRequest as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ tools: [] }) // tools/list
      .mockRejectedValueOnce(authError) // first tools/call fails
      .mockResolvedValueOnce({ content: 'success' }); // retry succeeds

    await adapterWithRefresh.connect();
    const result = await adapterWithRefresh.executeTool('figma.get_file', {});

    expect(tokenRefresher).toHaveBeenCalledWith('mcp-1');
    expect(transport.updateCredentials).toHaveBeenCalledWith('new-token');
    expect(result).toEqual({ content: 'success' });
  });

  it('executeTool throws when token refresh returns null', async () => {
    const tokenRefresher = vi.fn().mockResolvedValue(null);
    const adapterWithRefresh = new ExternalMCPAdapter(
      transport,
      { serverId: 'figma', displayName: 'Figma' },
      new Map(),
      tokenRefresher,
      'mcp-1',
    );

    const authError = new Error('HTTP 401: Unauthorized');
    (authError as unknown as Record<string, unknown>).status = 401;

    (transport.sendRequest as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ tools: [] })
      .mockRejectedValueOnce(authError);

    await adapterWithRefresh.connect();
    await expect(adapterWithRefresh.executeTool('figma.get_file', {})).rejects.toThrow('401');
  });

  it('executeTool throws non-auth errors without retry', async () => {
    (transport.sendRequest as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ tools: [] })
      .mockRejectedValueOnce(new Error('Network error'));

    await adapter.connect();
    await expect(adapter.executeTool('figma.get_file', {})).rejects.toThrow('Network error');
  });

  it('healthCheck returns ok when connected', async () => {
    (transport.sendRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ tools: [] });
    await adapter.connect();
    const health = await adapter.healthCheck();
    expect(health).toEqual({ ok: true });
  });

  it('healthCheck returns not connected before connect', async () => {
    const health = await adapter.healthCheck();
    expect(health).toEqual({ ok: false, error: 'Not connected' });
  });

  it('disconnect closes transport', async () => {
    (transport.sendRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ tools: [] });
    await adapter.connect();
    await adapter.disconnect();
    expect(transport.close).toHaveBeenCalled();
    expect(adapter.isReady()).toBe(false);
  });

  it('getTransport returns the transport', () => {
    expect(adapter.getTransport()).toBe(transport);
  });

  it('refreshTools handles empty tools array', async () => {
    (transport.sendRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ tools: undefined });
    await adapter.connect();
    expect(adapter.listTools()).toEqual([]);
  });
});
