import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';

beforeAll(() => {
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
});

const { mockConnect, MockWorkflowClient } = vi.hoisted(() => {
  const mockConnect = vi.fn().mockResolvedValue({ fake: 'connection' });
  const MockWorkflowClient = vi.fn().mockImplementation(function (this: Record<string, unknown>, opts: Record<string, unknown>) {
    this.connection = opts.connection;
    return this;
  });
  return { mockConnect, MockWorkflowClient };
});

vi.mock('@temporalio/client', () => ({
  Connection: { connect: mockConnect },
  WorkflowClient: MockWorkflowClient,
}));

vi.mock('@temporalio/worker', () => ({
  Worker: { create: vi.fn().mockResolvedValue({ run: vi.fn().mockReturnValue({ catch: vi.fn() }) }) },
  NativeConnection: { connect: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../src/workflow/stub-activities', () => ({
  createStubActivities: vi.fn(() => ({})),
}));

import { Test } from '@nestjs/testing';
import { WorkflowModule } from '../../src/workflow/workflow.module';
import { PrismaService } from '../../src/persistence/prisma.service';
import { WorkflowClient } from '@temporalio/client';

describe('WorkflowModule', () => {
  afterEach(() => {
    delete process.env.TEMPORAL_ADDRESS;
    vi.clearAllMocks();
  });

  it('useFactory creates WorkflowClient with default address', async () => {
    delete process.env.TEMPORAL_ADDRESS;

    const mod = await Test.createTestingModule({
      imports: [WorkflowModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();

    const client = mod.get(WorkflowClient);
    expect(client).toBeDefined();
    expect(mockConnect).toHaveBeenCalledWith({ address: 'localhost:7233' });
    expect(MockWorkflowClient).toHaveBeenCalledWith({ connection: { fake: 'connection' } });
  });

  it('useFactory uses TEMPORAL_ADDRESS env var', async () => {
    process.env.TEMPORAL_ADDRESS = 'remote:4444';

    const mod = await Test.createTestingModule({
      imports: [WorkflowModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $connect: vi.fn(), $disconnect: vi.fn() })
      .compile();

    const client = mod.get(WorkflowClient);
    expect(client).toBeDefined();
    expect(mockConnect).toHaveBeenCalledWith({ address: 'remote:4444' });
  });
});
