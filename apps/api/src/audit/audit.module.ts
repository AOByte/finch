import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PersistenceModule } from '../persistence/persistence.module';
import { AuditRepository } from './audit.repository';
import { AuditLoggerService } from './audit-logger.service';
import { AuditWriteProcessor } from './audit-write.processor';

@Module({
  imports: [
    PersistenceModule,
    BullModule.registerQueue({ name: 'audit-write' }),
  ],
  providers: [AuditRepository, AuditLoggerService, AuditWriteProcessor],
  exports: [AuditRepository, AuditLoggerService],
})
export class AuditModule {}
