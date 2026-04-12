import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RunManagerService } from '../../src/orchestrator/run-manager.service';
import { RunRepository } from '../../src/persistence/run.repository';
import { AuditLoggerService } from '../../src/audit/audit-logger.service';
import { WorkflowClient } from '@temporalio/client';

describe('RunManagerService', () => {
  let service: RunManagerService;
  let runRepo: {
    findById: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
  };
  let workflowClient: { getHandle: ReturnType<typeof vi.fn> };
  let auditLogger: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    runRepo = {
      findById: vi.fn(),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };
    workflowClient = {
      getHandle: vi.fn().mockReturnValue({
        signal: vi.fn().mockResolvedValue(undefined),
      }),
    };
    auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
    service = new RunManagerService(
      runRepo as unknown as RunRepository,
      workflowClient as unknown as WorkflowClient,
      auditLogger as unknown as AuditLoggerService,
    );
  });

  it('stopRun signals Temporal workflow and marks run as STOPPED', async () => {
    runRepo.findById.mockResolvedValue({
      runId: 'r1',
      harnessId: 'h1',
      status: 'RUNNING',
      currentPhase: 'ACQUIRE',
      temporalWorkflowId: 'finch-r1',
    });

    await service.stopRun('r1');

    expect(workflowClient.getHandle).toHaveBeenCalledWith('finch-r1');
    expect(runRepo.updateStatus).toHaveBeenCalledWith('r1', 'STOPPED');
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'run_stopped' }),
    );
  });

  it('stopRun throws NotFoundException when run not found', async () => {
    runRepo.findById.mockResolvedValue(null);
    await expect(service.stopRun('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('stopRun skips already completed runs', async () => {
    runRepo.findById.mockResolvedValue({
      runId: 'r1',
      status: 'COMPLETED',
      temporalWorkflowId: 'finch-r1',
    });
    await service.stopRun('r1');
    expect(workflowClient.getHandle).not.toHaveBeenCalled();
    expect(runRepo.updateStatus).not.toHaveBeenCalled();
  });
});
