import { Module } from '@nestjs/common';
import { AgentModule } from '../agents/agent.module';
import { ConnectorModule } from '../connectors/connector.module';
import { MemoryModule } from '../memory/memory.module';
import { AuditModule } from '../audit/audit.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { LLMModule } from '../llm/llm.module';

@Module({
  imports: [AgentModule, ConnectorModule, MemoryModule, AuditModule, PersistenceModule, LLMModule],
  providers: [],
  exports: [],
})
export class OrchestratorModule {}
