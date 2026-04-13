import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessManager } from '../../src/mcp/transports/process-manager';
import type { StdioTransport } from '../../src/mcp/transports/stdio-transport';

function makeMockTransport(): Partial<StdioTransport> {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
    updateCredentials: vi.fn(),
  };
}

describe('ProcessManager', () => {
  let manager: ProcessManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    manager = new ProcessManager();
  });

  it('register stores a transport', () => {
    const transport = makeMockTransport();
    manager.register('srv-1', transport as StdioTransport);
    // No throw = success
  });

  it('stop closes transport', async () => {
    const transport = makeMockTransport();
    manager.register('srv-1', transport as StdioTransport);
    await manager.stop('srv-1');
    expect(transport.close).toHaveBeenCalled();
  });

  it('stop is no-op for unregistered server', async () => {
    await manager.stop('nonexistent'); // should not throw
  });

  it('unregister removes transport without closing', () => {
    const transport = makeMockTransport();
    manager.register('srv-1', transport as StdioTransport);
    manager.unregister('srv-1');
    // unregister only removes the entry, does NOT call close
    expect(manager.isManaged('srv-1')).toBe(false);
  });

  it('restartWithNewCredentials updates credentials and reconnects', async () => {
    const transport = makeMockTransport();
    manager.register('srv-1', transport as StdioTransport);
    await manager.restartWithNewCredentials('srv-1', 'new-token');
    expect(transport.close).toHaveBeenCalled();
    expect(transport.updateCredentials).toHaveBeenCalledWith('new-token');
    expect(transport.initialize).toHaveBeenCalled();
  });

  it('restartWithNewCredentials is no-op for unknown server', async () => {
    await manager.restartWithNewCredentials('nonexistent', 'tok');
    // should not throw
  });

  it('scheduleRestart uses exponential backoff', async () => {
    const transport = makeMockTransport();
    manager.register('srv-1', transport as StdioTransport);

    const onRestarted = vi.fn();
    manager.scheduleRestart('srv-1', onRestarted);

    // First restart: 1s
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.close).toHaveBeenCalledTimes(1);

    // Schedule another restart: should be 2s
    manager.scheduleRestart('srv-1', onRestarted);
    await vi.advanceTimersByTimeAsync(2000);
    expect(transport.close).toHaveBeenCalledTimes(2);
  });

  it('onModuleDestroy closes all transports', async () => {
    const t1 = makeMockTransport();
    const t2 = makeMockTransport();
    manager.register('srv-1', t1 as StdioTransport);
    manager.register('srv-2', t2 as StdioTransport);

    await manager.onModuleDestroy();
    expect(t1.close).toHaveBeenCalled();
    expect(t2.close).toHaveBeenCalled();
  });
});
