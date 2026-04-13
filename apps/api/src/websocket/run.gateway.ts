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
import { createHmac, timingSafeEqual } from 'crypto';

@WebSocketGateway({
  namespace: '/runs',
  cors: { origin: process.env.FRONTEND_URL || false },
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
      this.logger.warn(`Client ${client.id} disconnected — JWT_SECRET not configured`);
      client.disconnect();
      return;
    }

    if (!token) {
      this.logger.warn(`Client ${client.id} disconnected — no token`);
      client.disconnect();
      return;
    }

    try {
      const payload = this.verifyJwt(token, jwtSecret);

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

  /**
   * Verify JWT signature using HMAC-SHA256.
   * Throws if the token is malformed or the signature does not match.
   */
  private verifyJwt(token: string, secret: string): { userId?: string; exp?: number } {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid JWT format');

    const [header, payloadB64, signatureB64] = parts;

    // Verify HMAC-SHA256 signature
    const signingInput = `${header}.${payloadB64}`;
    const expectedSig = createHmac('sha256', secret)
      .update(signingInput)
      .digest('base64url');

    // Timing-safe comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signatureB64);
    const expectedBuffer = Buffer.from(expectedSig);

    if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
      throw new Error('Invalid JWT signature');
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as {
      userId?: string;
      exp?: number;
    };

    return payload;
  }

  @SubscribeMessage('join_harness')
  handleJoinHarness(client: Socket, harnessId: string): { joined: boolean } | { error: string } {
    if (!harnessId || typeof harnessId !== 'string') {
      return { error: 'Invalid harnessId' };
    }

    // Require authentication before joining a harness room
    if (!client.data.userId) {
      client.emit('error', { message: 'Authentication required to join harness' });
      client.disconnect();
      return { error: 'Unauthorized' };
    }

    client.join(`harness:${harnessId}`);
    this.logger.debug(`Client ${client.id} joined harness:${harnessId}`);
    return { joined: true };
  }

  emitToHarness(harnessId: string, event: string, data: unknown): void {
    this.server.to(`harness:${harnessId}`).emit(event, data);
  }
}
