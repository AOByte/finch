import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WorkflowClient, Connection } from '@temporalio/client';
import { AgentModule } from '../agents/agent.module';
import { ConnectorModule } from '../connectors/connector.module';
import { MemoryModule } from '../memory/memory.module';
import { AuditModule } from '../audit/audit.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { LLMModule } from '../llm/llm.module';
import { MCPModule } from '../mcp/mcp.module';
import { GateControllerService } from './gate-controller.service';
import { AgentDispatcherService } from './agent-dispatcher.service';
import { RuleEnforcementService } from './rule-enforcement.service';
import { GateTimeoutProcessor } from './gate-timeout.processor';
import { RunManagerService } from './run-manager.service';

@Module({
  imports: [
    forwardRef(() => AgentModule),
    ConnectorModule,
    MemoryModule,
    AuditModule,
    PersistenceModule,
    LLMModule,
    MCPModule,
    BullModule.registerQueue({ name: 'gate-timeout' }),
  ],
  providers: [
    GateControllerService,
    AgentDispatcherService,
    RuleEnforcementService,
    GateTimeoutProcessor,
    {
      provide: WorkflowClient,
      useFactory: async () => {
        const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
        const connection = await Connection.connect({ address });
        return new WorkflowClient({ connection });
      },
    },
    RunManagerService,
  ],
  exports: [GateControllerService, AgentDispatcherService, RuleEnforcementService, GateTimeoutProcessor, RunManagerService, WorkflowClient],
})
export class OrchestratorModule {}
