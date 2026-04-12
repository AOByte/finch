import { Module } from '@nestjs/common';
import { LLMModule } from '../llm/llm.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [LLMModule, PersistenceModule, AuditModule],
  providers: [],
  exports: [],
})
export class MemoryModule {}
