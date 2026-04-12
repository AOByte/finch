import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { WorkflowModule } from './workflow/workflow.module';
import { AgentModule } from './agents/agent.module';
import { ConnectorModule } from './connectors/connector.module';
import { LLMModule } from './llm/llm.module';
import { MemoryModule } from './memory/memory.module';
import { AuditModule } from './audit/audit.module';
import { PersistenceModule } from './persistence/persistence.module';
import { WebSocketModule } from './websocket/websocket.module';
import { AuthModule } from './auth/auth.module';
import { ApiModule } from './api/api.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
    ApiModule,
  ],
})
export class AppModule {}
