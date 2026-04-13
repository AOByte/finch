import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { RunGateway } from '../../src/websocket/run.gateway';
import { Server, Socket } from 'socket.io';

/** Build a valid HS256-signed JWT for testing */
function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

vi.mock('redis', () => ({
  createClient: vi.fn().mockReturnValue({
    connect: vi.fn().mockResolvedValue(undefined),
    duplicate: vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
    }),
  }),
}));

vi.mock('@socket.io/redis-adapter', () => ({
  createAdapter: vi.fn().mockReturnValue('mock-adapter'),
}));

function makeGateway(envOverrides: Record<string, string | undefined> = {}) {
  const config = new ConfigService({
    REDIS_URL: 'redis://localhost:6379',
    ...envOverrides,
  });
  const gw = new RunGateway(config);
  // Mock server
  gw.server = {
    adapter: vi.fn(),
    to: vi.fn().mockReturnValue({ emit: vi.fn() }),
  } as unknown as Server;
  return gw;
}

function makeSocket(overrides: Partial<Socket> = {}): Socket {
  return {
    id: 'socket-1',
    handshake: { auth: {} },
    data: {},
    disconnect: vi.fn(),
    join: vi.fn(),
    ...overrides,
  } as unknown as Socket;
}

describe('RunGateway', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('afterInit', () => {
    it('sets up Redis adapter', async () => {
      const gw = makeGateway({ FRONTEND_URL: 'http://localhost:3000' });
      const mockServer = { adapter: vi.fn(), engine: { opts: { cors: {} } } } as unknown as Server;
      await gw.afterInit(mockServer);
      expect(mockServer.adapter).toHaveBeenCalled();
    });

    it('sets CORS origin from FRONTEND_URL config', async () => {
      const gw = makeGateway({ FRONTEND_URL: 'https://app.example.com' });
      const mockServer = { adapter: vi.fn(), engine: { opts: { cors: {} } } } as unknown as Server;
      await gw.afterInit(mockServer);
      expect((mockServer as any).engine.opts.cors.origin).toBe('https://app.example.com');
    });

    it('rejects cross-origin when FRONTEND_URL not configured', async () => {
      const gw = makeGateway({ FRONTEND_URL: undefined });
      const mockServer = { adapter: vi.fn(), engine: { opts: { cors: {} } } } as unknown as Server;
      await gw.afterInit(mockServer);
      expect((mockServer as any).engine.opts.cors.origin).toBe(false);
    });

    it('handles Redis adapter setup failure gracefully', async () => {
      const { createClient } = await import('redis');
      vi.mocked(createClient).mockReturnValueOnce({
        connect: vi.fn().mockRejectedValue(new Error('Connection refused')),
        duplicate: vi.fn().mockReturnValue({
          connect: vi.fn().mockRejectedValue(new Error('Connection refused')),
        }),
      } as never);

      const gw = makeGateway({ FRONTEND_URL: 'http://localhost:3000' });
      const mockServer = { adapter: vi.fn(), engine: { opts: { cors: {} } } } as unknown as Server;
      // Should not throw
      await gw.afterInit(mockServer);
      expect(mockServer.adapter).not.toHaveBeenCalled();
    });
  });

  describe('handleConnection', () => {
    it('disconnects when JWT_SECRET is not configured', async () => {
      const gw = makeGateway({ JWT_SECRET: undefined });
      const socket = makeSocket();
      await gw.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('disconnects client without token when JWT_SECRET is set', async () => {
      const gw = makeGateway({ JWT_SECRET: 'secret123' });
      const socket = makeSocket();
      await gw.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('disconnects client with invalid JWT format', async () => {
      const gw = makeGateway({ JWT_SECRET: 'secret123' });
      const socket = makeSocket({
        handshake: { auth: { token: 'not-a-jwt' } } as never,
      });
      await gw.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('disconnects client with expired JWT', async () => {
      const gw = makeGateway({ JWT_SECRET: 'secret123' });
      const token = signJwt({ userId: 'u1', exp: Math.floor(Date.now() / 1000) - 3600 }, 'secret123');
      const socket = makeSocket({
        handshake: { auth: { token } } as never,
      });
      await gw.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('disconnects client with forged JWT signature', async () => {
      const gw = makeGateway({ JWT_SECRET: 'secret123' });
      const token = signJwt({ userId: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 }, 'wrong-secret');
      const socket = makeSocket({
        handshake: { auth: { token } } as never,
      });
      await gw.handleConnection(socket);
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('authenticates client with valid signed JWT', async () => {
      const gw = makeGateway({ JWT_SECRET: 'secret123' });
      const token = signJwt({ userId: 'u1', exp: Math.floor(Date.now() / 1000) + 3600 }, 'secret123');
      const socket = makeSocket({
        handshake: { auth: { token } } as never,
      });
      await gw.handleConnection(socket);
      expect(socket.disconnect).not.toHaveBeenCalled();
      expect(socket.data.userId).toBe('u1');
    });

    it('authenticates client with non-expiring signed JWT', async () => {
      const gw = makeGateway({ JWT_SECRET: 'secret123' });
      const token = signJwt({ userId: 'u1' }, 'secret123');
      const socket = makeSocket({
        handshake: { auth: { token } } as never,
      });
      await gw.handleConnection(socket);
      expect(socket.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('handleJoinHarness', () => {
    it('joins authenticated client to harness room', () => {
      const gw = makeGateway();
      const socket = makeSocket();
      socket.data.userId = 'u1';
      const result = gw.handleJoinHarness(socket, 'harness-1');
      expect(socket.join).toHaveBeenCalledWith('harness:harness-1');
      expect(result).toEqual({ joined: true });
    });

    it('rejects unauthenticated client', () => {
      const gw = makeGateway();
      const socket = makeSocket();
      socket.emit = vi.fn();
      const result = gw.handleJoinHarness(socket, 'harness-1');
      expect(result).toEqual({ error: 'Unauthorized' });
      expect(socket.disconnect).toHaveBeenCalled();
    });

    it('rejects empty harnessId', () => {
      const gw = makeGateway();
      const socket = makeSocket();
      const result = gw.handleJoinHarness(socket, '');
      expect(result).toEqual({ error: 'Invalid harnessId' });
      expect(socket.join).not.toHaveBeenCalled();
    });

    it('rejects non-string harnessId', () => {
      const gw = makeGateway();
      const socket = makeSocket();
      const result = gw.handleJoinHarness(socket, null as never);
      expect(result).toEqual({ error: 'Invalid harnessId' });
    });
  });

  describe('emitToHarness', () => {
    it('emits event to harness room', () => {
      const gw = makeGateway();
      const mockEmit = vi.fn();
      gw.server = { to: vi.fn().mockReturnValue({ emit: mockEmit }) } as unknown as Server;

      gw.emitToHarness('h1', 'run.event', { type: 'phase_started' });

      expect(gw.server.to).toHaveBeenCalledWith('harness:h1');
      expect(mockEmit).toHaveBeenCalledWith('run.event', { type: 'phase_started' });
    });
  });
});
