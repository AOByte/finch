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
    const users = await this.prisma.$queryRawUnsafe<
      Array<{ user_id: string; email: string; password_hash: string }>
    >(
      `SELECT user_id, email, password_hash FROM users WHERE email = $1`,
      email,
    );

    if (users.length === 0) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const user = users[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return { userId: user.user_id, email: user.email };
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
    const users = await this.prisma.$queryRawUnsafe<
      Array<{ user_id: string; email: string }>
    >(
      `SELECT user_id, email FROM users WHERE user_id = $1::uuid`,
      payload.userId,
    );

    if (users.length === 0) {
      throw new UnauthorizedException('User not found');
    }

    const user = users[0];

    // Generate new tokens
    const accessToken = this.generateAccessToken({ userId: user.user_id, email: user.email });
    const refreshToken = await this.generateRefreshToken(user.user_id);

    return { accessToken, refreshToken };
  }

  async revokeAllRefreshTokens(userId: string): Promise<void> {
    const pattern = `refresh:${userId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    this.logger.debug(`Revoked all refresh tokens for user ${userId}`);
  }
}
