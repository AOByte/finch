import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { RunGateway } from './run.gateway';

@Module({
  imports: [AuditModule, ConfigModule],
  providers: [RunGateway],
  exports: [RunGateway],
})
export class WebSocketModule {}
