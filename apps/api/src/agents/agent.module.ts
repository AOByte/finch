import { Module, forwardRef } from '@nestjs/common';
import { PersistenceModule } from '../persistence/persistence.module';
import { AgentConfigService } from './agent-config.service';
import { LockedPreambleGuard } from './locked-preamble.guard';
import { TriggerAgentService } from './trigger-agent.service';
import { AcquireAgentService } from './acquire-agent.service';
import { PlanAgentService } from './plan-agent.service';
import { ExecuteAgentService } from './execute-agent.service';
import { ShipAgentService } from './ship-agent.service';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';

@Module({
  imports: [PersistenceModule, forwardRef(() => OrchestratorModule)],
  providers: [
    AgentConfigService,
    LockedPreambleGuard,
    TriggerAgentService,
    AcquireAgentService,
    PlanAgentService,
    ExecuteAgentService,
    ShipAgentService,
  ],
  exports: [
    AgentConfigService,
    LockedPreambleGuard,
    TriggerAgentService,
    AcquireAgentService,
    PlanAgentService,
    ExecuteAgentService,
    ShipAgentService,
  ],
})
export class AgentModule {}
