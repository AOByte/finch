import { Module } from '@nestjs/common';
import { AgentModule } from '../agents/agent.module';
import { ConnectorModule } from '../connectors/connector.module';
import { MemoryModule } from '../memory/memory.module';
import { AuditModule } from '../audit/audit.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { LLMModule } from '../llm/llm.module';
import { GateControllerService } from './gate-controller.service';
import { AgentDispatcherService } from './agent-dispatcher.service';
import { RuleEnforcementService } from './rule-enforcement.service';

@Module({
  imports: [AgentModule, ConnectorModule, MemoryModule, AuditModule, PersistenceModule, LLMModule],
  providers: [GateControllerService, AgentDispatcherService, RuleEnforcementService],
  exports: [GateControllerService, AgentDispatcherService, RuleEnforcementService],
})
export class OrchestratorModule {}
