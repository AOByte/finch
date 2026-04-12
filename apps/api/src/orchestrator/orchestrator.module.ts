import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AgentModule } from '../agents/agent.module';
import { ConnectorModule } from '../connectors/connector.module';
import { MemoryModule } from '../memory/memory.module';
import { AuditModule } from '../audit/audit.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { LLMModule } from '../llm/llm.module';
import { GateControllerService } from './gate-controller.service';
import { AgentDispatcherService } from './agent-dispatcher.service';
import { RuleEnforcementService } from './rule-enforcement.service';
import { GateTimeoutProcessor } from './gate-timeout.processor';

@Module({
  imports: [
    forwardRef(() => AgentModule),
    ConnectorModule,
    MemoryModule,
    AuditModule,
    PersistenceModule,
    LLMModule,
    BullModule.registerQueue({ name: 'gate-timeout' }),
  ],
  providers: [GateControllerService, AgentDispatcherService, RuleEnforcementService, GateTimeoutProcessor],
  exports: [GateControllerService, AgentDispatcherService, RuleEnforcementService, GateTimeoutProcessor],
})
export class OrchestratorModule {}
