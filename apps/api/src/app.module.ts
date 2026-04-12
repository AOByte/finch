import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
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
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      },
    }),
    LoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL', 'info'),
          transport:
            process.env.NODE_ENV !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true } }
              : undefined,
          customProps: () => ({ service: 'finch-api' }),
        },
      }),
    }),
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
