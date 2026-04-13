import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RunsController } from '../../src/api/runs.controller';
import { RunRepository } from '../../src/persistence/run.repository';
import { RunManagerService } from '../../src/orchestrator/run-manager.service';
import { AuditRepository } from '../../src/audit/audit.repository';
import { GateRepository } from '../../src/persistence/gate.repository';
import { HarnessRepository } from '../../src/persistence/harness.repository';

describe('RunsController', () => {
  let controller: RunsController;
  let runRepo: {
    findById: ReturnType<typeof vi.fn>;
    findByHarnessId: ReturnType<typeof vi.fn>;
  };
  let runManager: { stopRun: ReturnType<typeof vi.fn> };
  let auditRepo: { findByRunId: ReturnType<typeof vi.fn> };
  let gateRepo: { findByRunId: ReturnType<typeof vi.fn> };
  let harnessRepo: { findByName: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    runRepo = { findById: vi.fn(), findByHarnessId: vi.fn() };
    runManager = { stopRun: vi.fn() };
    auditRepo = { findByRunId: vi.fn() };
    gateRepo = { findByRunId: vi.fn() };
    harnessRepo = { findByName: vi.fn() };
    controller = new RunsController(
      runRepo as unknown as RunRepository,
      runManager as unknown as RunManagerService,
      auditRepo as unknown as AuditRepository,
      gateRepo as unknown as GateRepository,
      harnessRepo as unknown as HarnessRepository,
    );
  });

  it('getRunById returns the run when found', async () => {
    const run = { runId: 'r1', status: 'RUNNING' };
    runRepo.findById.mockResolvedValue(run);
    const result = await controller.getRunById('r1');
    expect(result).toEqual({ data: run });
    expect(runRepo.findById).toHaveBeenCalledWith('r1');
  });

  it('getRunById throws NotFoundException when not found', async () => {
    runRepo.findById.mockResolvedValue(null);
    await expect(controller.getRunById('nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('listRuns returns { data, meta } envelope', async () => {
    const runs = [{ runId: 'r1', status: 'RUNNING' }];
    runRepo.findByHarnessId.mockResolvedValue(runs);
    const result = await controller.listRuns('00000000-0000-0000-0000-000000000001');
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('meta');
    expect(result.meta).toHaveProperty('total');
    expect(result.meta).toHaveProperty('hasMore');
  });

  it('listRuns returns empty when no harnessId', async () => {
    const result = await controller.listRuns();
    expect(result).toEqual({ data: [], meta: { total: 0, hasMore: false } });
  });

  it('getRunAudit returns { data } envelope', async () => {
    runRepo.findById.mockResolvedValue({ runId: 'r1' });
    auditRepo.findByRunId.mockResolvedValue([{ eventId: 'e1' }]);
    const result = await controller.getRunAudit('r1');
    expect(result).toHaveProperty('data');
    expect(result.data).toHaveLength(1);
  });

  it('getRunAudit throws NotFoundException when run not found', async () => {
    runRepo.findById.mockResolvedValue(null);
    await expect(controller.getRunAudit('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('getRunGates returns { data } envelope', async () => {
    runRepo.findById.mockResolvedValue({ runId: 'r1' });
    gateRepo.findByRunId.mockResolvedValue([{ gateId: 'g1' }]);
    const result = await controller.getRunGates('r1');
    expect(result).toHaveProperty('data');
  });

  it('getRunGates throws NotFoundException when run not found', async () => {
    runRepo.findById.mockResolvedValue(null);
    await expect(controller.getRunGates('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('listRuns filters by status when provided', async () => {
    const runs = [
      { runId: 'r1', status: 'RUNNING' },
      { runId: 'r2', status: 'COMPLETED' },
    ];
    runRepo.findByHarnessId.mockResolvedValue(runs);
    const result = await controller.listRuns('00000000-0000-0000-0000-000000000001', 'RUNNING');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].status).toBe('RUNNING');
  });

  it('listRuns uses limit and offset params', async () => {
    runRepo.findByHarnessId.mockResolvedValue([]);
    await controller.listRuns('00000000-0000-0000-0000-000000000001', undefined, '5', '10');
    expect(runRepo.findByHarnessId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', { skip: 10, take: 5 });
  });

  it('listRuns resolves harness name to UUID', async () => {
    harnessRepo.findByName.mockResolvedValue({ harnessId: '00000000-0000-0000-0000-000000000001', name: 'default' });
    runRepo.findByHarnessId.mockResolvedValue([]);
    const result = await controller.listRuns('default');
    expect(harnessRepo.findByName).toHaveBeenCalledWith('default');
    expect(runRepo.findByHarnessId).toHaveBeenCalledWith('00000000-0000-0000-0000-000000000001', { skip: 0, take: 20 });
    expect(result).toHaveProperty('data');
  });

  it('listRuns returns empty when harness name not found', async () => {
    harnessRepo.findByName.mockResolvedValue(null);
    const result = await controller.listRuns('nonexistent');
    expect(result).toEqual({ data: [], meta: { total: 0, hasMore: false } });
  });

  it('stopRun returns { data } envelope', async () => {
    runManager.stopRun.mockResolvedValue(undefined);
    const result = await controller.stopRun('r1');
    expect(result).toEqual({ data: { runId: 'r1', status: 'STOPPED' } });
    expect(runManager.stopRun).toHaveBeenCalledWith('r1');
  });
});
