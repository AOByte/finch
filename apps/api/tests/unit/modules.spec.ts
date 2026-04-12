import { describe, it, expect, vi } from 'vitest';
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
import { PrismaService } from '../../src/persistence/prisma.service';
import { WorkflowClient } from '@temporalio/client';
import { TemporalWorkerService } from '../../src/workflow/temporal-worker.service';

const mockPrisma = {
  $connect: vi.fn(),
  $disconnect: vi.fn(),
};

describe('Module stubs', () => {
  it('PersistenceModule should compile and export PrismaService', async () => {
    const mod = await Test.createTestingModule({ imports: [PersistenceModule] })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();
    expect(mod).toBeDefined();
    expect(mod.get(PrismaService)).toBeDefined();
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

  it('OrchestratorModule should compile and export providers', async () => {
    const mod = await Test.createTestingModule({ imports: [OrchestratorModule] })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .compile();
    expect(mod).toBeDefined();
    const { GateControllerService } = await import('../../src/orchestrator/gate-controller.service');
    const { AgentDispatcherService } = await import('../../src/orchestrator/agent-dispatcher.service');
    const { RuleEnforcementService } = await import('../../src/orchestrator/rule-enforcement.service');
    expect(mod.get(GateControllerService)).toBeDefined();
    expect(mod.get(AgentDispatcherService)).toBeDefined();
    expect(mod.get(RuleEnforcementService)).toBeDefined();
  });

  it('WorkflowModule should compile and export WorkflowClient', async () => {
    const mod = await Test.createTestingModule({ imports: [WorkflowModule] })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(TemporalWorkerService)
      .useValue({})
      .overrideProvider(WorkflowClient)
      .useValue({})
      .compile();
    expect(mod).toBeDefined();
    expect(mod.get(WorkflowClient)).toBeDefined();
  });

  it('ApiModule should compile and register controllers', async () => {
    const mod = await Test.createTestingModule({ imports: [ApiModule] })
      .overrideProvider(PrismaService)
      .useValue(mockPrisma)
      .overrideProvider(TemporalWorkerService)
      .useValue({})
      .overrideProvider(WorkflowClient)
      .useValue({})
      .compile();
    expect(mod).toBeDefined();
    const { HealthController } = await import('../../src/api/health.controller');
    const { RunsController } = await import('../../src/api/runs.controller');
    expect(mod.get(HealthController)).toBeDefined();
    expect(mod.get(RunsController)).toBeDefined();
  });
});
