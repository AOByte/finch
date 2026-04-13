import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StdioTransport } from '../../src/mcp/transports/stdio-transport';
import type { ChildProcess } from 'child_process';

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

import { spawn } from 'child_process';
const mockSpawn = vi.mocked(spawn);

function makeMockProcess() {
  const listeners: Record<string, Function[]> = {};
  let stdoutDataCb: ((data: Buffer) => void) | null = null;

  const stdin = {
    write: vi.fn().mockImplementation((msg: string) => {
      // Auto-respond to JSON-RPC requests via stdout
      setTimeout(() => {
        if (stdoutDataCb) {
          try {
            const parsed = JSON.parse(msg.trim());
            const response = JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} });
            stdoutDataCb(Buffer.from(response + '\n'));
          } catch { /* ignore non-JSON */ }
        }
      }, 5);
      return true;
    }),
    writable: true,
    on: vi.fn(),
  };
  const stdout = {
    on: vi.fn((event: string, cb: Function) => {
      if (event === 'data') stdoutDataCb = cb as (data: Buffer) => void;
      return stdout;
    }),
  };
  const stderr = {
    on: vi.fn().mockReturnThis(),
  };

  return {
    stdin: stdin as never,
    stdout: stdout as never,
    stderr: stderr as never,
    pid: 12345,
    killed: false,
    on: vi.fn((event: string, cb: Function) => {
      (listeners[event] = listeners[event] || []).push(cb);
      return {} as ChildProcess;
    }),
    kill: vi.fn().mockReturnValue(true),
    _listeners: listeners,
  } as unknown as ChildProcess & { _listeners: Record<string, Function[]> };
}

describe('StdioTransport', () => {
  let transport: StdioTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new StdioTransport({ command: 'node', args: ['server.js'], env: { TOKEN: 'abc' } });
  });

  it('constructs with config', () => {
    const config = transport.getConfig();
    expect(config.command).toBe('node');
    expect(config.args).toEqual(['server.js']);
    expect(config.env?.TOKEN).toBe('abc');
  });

  it('isConnected returns false before initialize', () => {
    expect(transport.isConnected()).toBe(false);
  });

  it('initialize spawns child process', async () => {
    const mockProc = makeMockProcess();
    mockSpawn.mockReturnValue(mockProc);

    await transport.initialize();
    expect(mockSpawn).toHaveBeenCalledWith('node', ['server.js'], expect.objectContaining({
      env: expect.objectContaining({ TOKEN: 'abc' }),
    }));
    expect(transport.isConnected()).toBe(true);
  });

  it('close kills the process', async () => {
    const mockProc = makeMockProcess();
    mockSpawn.mockReturnValue(mockProc);

    await transport.initialize();

    // When kill() is called, fire 'close' event so close() promise resolves
    (mockProc.kill as ReturnType<typeof vi.fn>).mockImplementation(() => {
      setTimeout(() => {
        const closeCbs = (mockProc as unknown as { _listeners: Record<string, Function[]> })._listeners['close'] || [];
        closeCbs.forEach(cb => cb(0));
      }, 5);
      return true;
    });

    await transport.close();
    expect(mockProc.kill).toHaveBeenCalled();
    expect(transport.isConnected()).toBe(false);
  });

  it('updateCredentials updates env token key', () => {
    // extractTokenEnv looks for keys matching TOKEN/KEY/SECRET
    // Our config has { TOKEN: 'abc' } so it should update that key
    transport.updateCredentials('new-token');
    const config = transport.getConfig();
    expect(config.env?.TOKEN).toBe('new-token');
  });

  it('getProcess returns null before initialize', () => {
    expect(transport.getProcess()).toBeNull();
  });
});
