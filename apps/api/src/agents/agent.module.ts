import { Module } from '@nestjs/common';
import { LLMModule } from '../llm/llm.module';
import { ConnectorModule } from '../connectors/connector.module';
import { MemoryModule } from '../memory/memory.module';
import { AuditModule } from '../audit/audit.module';
import { PersistenceModule } from '../persistence/persistence.module';

@Module({
  imports: [LLMModule, ConnectorModule, MemoryModule, AuditModule, PersistenceModule],
  providers: [],
  exports: [],
})
export class AgentModule {}
