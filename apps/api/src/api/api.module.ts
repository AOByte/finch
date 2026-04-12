import { Module } from '@nestjs/common';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AgentModule } from '../agents/agent.module';
import { ConnectorModule } from '../connectors/connector.module';
import { LLMModule } from '../llm/llm.module';
import { MemoryModule } from '../memory/memory.module';
import { AuditModule } from '../audit/audit.module';
import { PersistenceModule } from '../persistence/persistence.module';
import { WebSocketModule } from '../websocket/websocket.module';
import { AuthModule } from '../auth/auth.module';
import { HealthController } from './health.controller';
import { RunsController } from './runs.controller';
import { TriggerController } from './trigger.controller';
import { GateController } from './gate.controller';
import { MemoryController } from './memory.controller';
import { AgentsController } from './agents.controller';
import { ConnectorsController } from './connectors.controller';
import { SkillsController } from './skills.controller';
import { RulesController } from './rules.controller';
import { HarnessesController } from './harnesses.controller';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [
    OrchestratorModule,
    WorkflowModule,
    AgentModule,
    ConnectorModule,
    LLMModule,
    MemoryModule,
    AuditModule,
    PersistenceModule,
    WebSocketModule,
    AuthModule,
  ],
  controllers: [
    HealthController,
    RunsController,
    TriggerController,
    GateController,
    MemoryController,
    AgentsController,
    ConnectorsController,
    SkillsController,
    RulesController,
    HarnessesController,
    AnalyticsController,
  ],
  providers: [AnalyticsService],
})
export class ApiModule {}
