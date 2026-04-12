import { Module } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { AuditModule } from '../audit/audit.module';
import { EmbeddingService } from './embedding.service';
import { MemoryConnectorService } from './memory-connector.service';
import { MemoryActivities } from './memory.activities';

@Module({
  imports: [PersistenceModule, AuditModule],
  providers: [EmbeddingService, MemoryConnectorService, MemoryActivities],
  exports: [EmbeddingService, MemoryConnectorService, MemoryActivities],
})
export class MemoryModule {}
