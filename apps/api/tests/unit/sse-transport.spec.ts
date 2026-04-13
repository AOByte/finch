import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SSETransport } from '../../src/mcp/transports/sse-transport';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('SSETransport', () => {
  let transport: SSETransport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new SSETransport('https://mcp.example.com/rpc', {
      Authorization: 'Bearer test-token',
    });
  });

  it('isConnected returns false before initialize', () => {
    expect(transport.isConnected()).toBe(false);
  });

  it('initialize sends handshake and sets connected', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } }),
    });

    await transport.initialize();
    expect(transport.isConnected()).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://mcp.example.com/rpc',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('sendRequest sends JSON-RPC and returns result', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        result: { tools: [{ name: 'read_file', description: 'Read a file' }] },
      }),
    });

    const result = await transport.sendRequest('tools/list');
    expect(result).toEqual({ tools: [{ name: 'read_file', description: 'Read a file' }] });
  });

  it('sendRequest throws on JSON-RPC error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        jsonrpc: '2.0',
        id: 1,
        error: { code: -32600, message: 'Invalid Request' },
      }),
    });

    await expect(transport.sendRequest('bad/method')).rejects.toThrow('JSON-RPC error -32600');
  });

  it('sendRequest throws with status on 401', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    await expect(transport.sendRequest('tools/list')).rejects.toThrow('HTTP 401');
  });

  it('sendRequest throws with status on 403', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    });

    const err = await transport.sendRequest('tools/list').catch(e => e);
    expect(err.message).toContain('HTTP 403');
    expect((err as Record<string, unknown>).status).toBe(403);
  });

  it('sendRequest throws on non-auth HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await expect(transport.sendRequest('tools/list')).rejects.toThrow('HTTP 500');
  });

  it('close sets connected to false', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: {} }),
    });
    await transport.initialize();
    expect(transport.isConnected()).toBe(true);

    await transport.close();
    expect(transport.isConnected()).toBe(false);
  });

  it('updateCredentials updates Authorization header', async () => {
    transport.updateCredentials('new-token');

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: {} }),
    });

    await transport.sendRequest('tools/list');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers.Authorization).toBe('Bearer new-token');
  });
});
