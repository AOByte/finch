import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

interface JwtPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

function extractFromCookie(req: Request): string | null {
  return req?.cookies?.access_token ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: extractFromCookie,
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'finch-dev-secret'),
    });
  }

  validate(payload: JwtPayload): { userId: string; email: string } {
    return { userId: payload.userId, email: payload.email };
  }
}
