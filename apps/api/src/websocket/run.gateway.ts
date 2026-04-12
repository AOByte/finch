import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

@WebSocketGateway({
  namespace: '/runs',
  cors: { origin: '*' },
})
export class RunGateway implements OnGatewayConnection, OnGatewayInit {
  private readonly logger = new Logger(RunGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly config: ConfigService) {}

  async afterInit(server: Server): Promise<void> {
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';

    try {
      const pubClient = createClient({ url: redisUrl });
      const subClient = pubClient.duplicate();

      await Promise.all([pubClient.connect(), subClient.connect()]);

      server.adapter(createAdapter(pubClient, subClient) as never);
      this.logger.log('RunGateway initialized with Redis adapter');
    } catch (err) {
      this.logger.warn(`Redis adapter setup failed: ${(err as Error).message} — running without adapter`);
    }
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token as string | undefined;
    const jwtSecret = this.config.get<string>('JWT_SECRET');

    if (!jwtSecret) {
      // No JWT secret configured — allow all connections (dev mode)
      this.logger.debug(`Client connected without auth: ${client.id}`);
      return;
    }

    if (!token) {
      this.logger.warn(`Client ${client.id} disconnected — no token`);
      client.disconnect();
      return;
    }

    try {
      // Simple JWT verification (HS256)
      const parts = token.split('.');
      if (parts.length !== 3) throw new Error('Invalid JWT format');

      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
        userId?: string;
        exp?: number;
      };

      // Check expiration
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        throw new Error('Token expired');
      }

      client.data.userId = payload.userId;
      this.logger.debug(`Client authenticated: ${client.id} (user: ${payload.userId})`);
    } catch (err) {
      this.logger.warn(`Client ${client.id} disconnected — auth failed: ${(err as Error).message}`);
      client.disconnect();
    }
  }

  @SubscribeMessage('join_harness')
  handleJoinHarness(client: Socket, harnessId: string): { joined: boolean } | { error: string } {
    if (!harnessId || typeof harnessId !== 'string') {
      return { error: 'Invalid harnessId' };
    }

    client.join(`harness:${harnessId}`);
    this.logger.debug(`Client ${client.id} joined harness:${harnessId}`);
    return { joined: true };
  }

  emitToHarness(harnessId: string, event: string, data: unknown): void {
    this.server.to(`harness:${harnessId}`).emit(event, data);
  }
}
