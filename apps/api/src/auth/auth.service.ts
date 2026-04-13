import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRedis } from '../persistence/redis.decorator';
import type Redis from 'ioredis';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../persistence/prisma.service';

const REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60; // 7 days in seconds

interface TokenPayload {
  userId: string;
  email: string;
}

interface RefreshPayload {
  userId: string;
  tokenId: string;
  type: 'refresh';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async validateUser(email: string, password: string): Promise<{ userId: string; email: string }> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return { userId: user.userId, email: user.email };
  }

  generateAccessToken(payload: TokenPayload): string {
    return this.jwtService.sign(
      { userId: payload.userId, email: payload.email },
      { expiresIn: '15m' },
    );
  }

  async generateRefreshToken(userId: string): Promise<string> {
    const tokenId = uuidv4();
    const token = this.jwtService.sign(
      { userId, tokenId, type: 'refresh' } as RefreshPayload,
      { expiresIn: '7d' },
    );

    await this.redis.set(
      `refresh:${userId}:${tokenId}`,
      '1',
      'EX',
      REFRESH_TOKEN_TTL,
    );

    this.logger.debug(`Generated refresh token for user ${userId}`);
    return token;
  }

  async rotateRefreshToken(oldToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    let payload: RefreshPayload;
    try {
      payload = this.jwtService.verify<RefreshPayload>(oldToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Invalid token type');
    }

    // Check that the old token exists in Redis (not already revoked)
    const key = `refresh:${payload.userId}:${payload.tokenId}`;
    const exists = await this.redis.exists(key);
    if (!exists) {
      throw new UnauthorizedException('Refresh token revoked or expired');
    }

    // Delete the old token
    await this.redis.del(key);

    // Look up user to get email for the new access token
    const user = await this.prisma.user.findUnique({ where: { userId: payload.userId } });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Generate new tokens
    const accessToken = this.generateAccessToken({ userId: user.userId, email: user.email });
    const refreshToken = await this.generateRefreshToken(user.userId);

    return { accessToken, refreshToken };
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    // Validate userId is a UUID to prevent Redis KEYS pattern injection
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(userId)) {
      this.logger.warn(`Rejected revokeAllRefreshTokens with invalid userId: ${userId}`);
      return;
    }
    const pattern = `refresh:${userId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    this.logger.debug(`Revoked all refresh tokens for user ${userId}`);
  }
}
