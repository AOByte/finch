import { describe, it, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { PersistenceModule } from '../../src/persistence/persistence.module';
import { LLMModule } from '../../src/llm/llm.module';
import { AuthModule } from '../../src/auth/auth.module';
import { AuditModule } from '../../src/audit/audit.module';
import { ConnectorModule } from '../../src/connectors/connector.module';
import { MemoryModule } from '../../src/memory/memory.module';
import { AgentModule } from '../../src/agents/agent.module';
import { WebSocketModule } from '../../src/websocket/websocket.module';
import { OrchestratorModule } from '../../src/orchestrator/orchestrator.module';
import { WorkflowModule } from '../../src/workflow/workflow.module';
import { ApiModule } from '../../src/api/api.module';

describe('Module stubs', () => {
  it('PersistenceModule should compile', async () => {
    const mod = await Test.createTestingModule({ imports: [PersistenceModule] }).compile();
    expect(mod).toBeDefined();
  });

  it('LLMModule should compile', async () => {
    const mod = await Test.createTestingModule({ imports: [LLMModule] }).compile();
    expect(mod).toBeDefined();
  });

  it('AuthModule should compile', async () => {
    const mod = await Test.createTestingModule({ imports: [AuthModule] }).compile();
    expect(mod).toBeDefined();
  });

  it('AuditModule should compile', async () => {
    const mod = await Test.createTestingModule({ imports: [AuditModule] }).compile();
    expect(mod).toBeDefined();
  });

  it('ConnectorModule should compile', async () => {
    const mod = await Test.createTestingModule({ imports: [ConnectorModule] }).compile();
    expect(mod).toBeDefined();
  });

  it('MemoryModule should compile', async () => {
    const mod = await Test.createTestingModule({ imports: [MemoryModule] }).compile();
    expect(mod).toBeDefined();
  });

  it('AgentModule should compile', async () => {
    const mod = await Test.createTestingModule({ imports: [AgentModule] }).compile();
    expect(mod).toBeDefined();
  });

  it('WebSocketModule should compile', async () => {
    const mod = await Test.createTestingModule({ imports: [WebSocketModule] }).compile();
    expect(mod).toBeDefined();
  });

  it('OrchestratorModule should compile', async () => {
    const mod = await Test.createTestingModule({ imports: [OrchestratorModule] }).compile();
    expect(mod).toBeDefined();
  });

  it('WorkflowModule should compile', async () => {
    const mod = await Test.createTestingModule({ imports: [WorkflowModule] }).compile();
    expect(mod).toBeDefined();
  });

  it('ApiModule should compile and register HealthController', async () => {
    const mod = await Test.createTestingModule({ imports: [ApiModule] }).compile();
    expect(mod).toBeDefined();
    const { HealthController } = await import('../../src/api/health.controller');
    const controller = mod.get(HealthController);
    expect(controller).toBeDefined();
  });
});
