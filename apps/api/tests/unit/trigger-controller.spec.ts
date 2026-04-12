import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TriggerController } from '../../src/api/trigger.controller';

vi.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

describe('TriggerController', () => {
  const mockRunRepository = {
    create: vi.fn().mockResolvedValue(undefined),
  };
  const mockHarnessRepository = {
    findByName: vi.fn(),
  };
  const mockWorkflowClient = {
    start: vi.fn().mockResolvedValue(undefined),
  };

  let controller: TriggerController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new TriggerController(
      mockRunRepository as never,
      mockHarnessRepository as never,
      mockWorkflowClient as never,
    );
  });

  it('trigger with "default" resolves harness by name', async () => {
    mockHarnessRepository.findByName.mockResolvedValue({
      harnessId: 'h-uuid',
      name: 'default',
    });

    const result = await controller.trigger('default', { rawText: 'fix it' });

    expect(mockHarnessRepository.findByName).toHaveBeenCalledWith('default');
    expect(mockRunRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        harnessId: 'h-uuid',
        status: 'RUNNING',
        currentPhase: 'TRIGGER',
      }),
    );
    expect(mockWorkflowClient.start).toHaveBeenCalledWith('finchWorkflow', expect.objectContaining({
      taskQueue: 'finch',
    }));
    expect(result.data.status).toBe('RUNNING');
  });

  it('trigger throws NotFoundException when default harness not found', async () => {
    mockHarnessRepository.findByName.mockResolvedValue(null);

    await expect(
      controller.trigger('default', { rawText: 'fix it' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('trigger with UUID uses it directly', async () => {
    const result = await controller.trigger('some-uuid', { rawText: 'do something' });

    expect(mockHarnessRepository.findByName).not.toHaveBeenCalled();
    expect(mockRunRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ harnessId: 'some-uuid' }),
    );
    expect(result.data.runId).toBe('test-uuid-1234');
  });

  it('trigger uses provided runId when present', async () => {
    const result = await controller.trigger('h1', {
      rawText: 'task',
      runId: 'custom-run-id',
    });

    expect(result.data.runId).toBe('custom-run-id');
    expect(result.data.temporalWorkflowId).toBe('finch-custom-run-id');
  });

  it('trigger starts Temporal workflow with correct args', async () => {
    mockHarnessRepository.findByName.mockResolvedValue({
      harnessId: 'h-uuid',
      name: 'default',
    });

    await controller.trigger('default', { rawText: 'fix payments' });

    expect(mockWorkflowClient.start).toHaveBeenCalledWith('finchWorkflow', {
      workflowId: 'finch-test-uuid-1234',
      taskQueue: 'finch',
      args: [expect.objectContaining({
        rawText: 'fix payments',
        harnessId: 'h-uuid',
        runId: 'test-uuid-1234',
        source: expect.objectContaining({ type: 'webhook' }),
      })],
    });
  });
});
