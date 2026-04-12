import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PersistenceModule } from '../persistence/persistence.module';
import { AuditRepository } from './audit.repository';
import { AuditLoggerService, REDIS_PUBLISHER } from './audit-logger.service';
import { AuditWriteProcessor } from './audit-write.processor';
import { createClient } from 'redis';

@Module({
  imports: [
    PersistenceModule,
    ConfigModule,
    BullModule.registerQueue({ name: 'audit-write' }),
  ],
  providers: [
    AuditRepository,
    AuditLoggerService,
    AuditWriteProcessor,
    {
      provide: REDIS_PUBLISHER,
      useFactory: async (config: ConfigService) => {
        const url = config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
        try {
          const client = createClient({ url });
          await client.connect();
          return client;
        } catch {
          return undefined;
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [AuditRepository, AuditLoggerService],
})
export class AuditModule {}
