import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { HarnessAuthGuard } from './guards/harness-auth.guard';
import { LockedPreambleGuard } from './guards/locked-preamble.guard';
import { PersistenceModule } from '../persistence/persistence.module';
import { REDIS_CLIENT } from '../persistence/redis.decorator';
import IORedis from 'ioredis';

@Module({
  imports: [
    PersistenceModule,
    PassportModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET', 'finch-dev-secret'),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    HarnessAuthGuard,
    LockedPreambleGuard,
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService) => {
        return new IORedis({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          lazyConnect: true,
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [AuthService, JwtAuthGuard, HarnessAuthGuard, LockedPreambleGuard, JwtModule],
})
export class AuthModule {}
