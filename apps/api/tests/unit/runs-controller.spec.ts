import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { RunsController } from '../../src/api/runs.controller';
import { RunRepository } from '../../src/persistence/run.repository';

describe('RunsController', () => {
  let controller: RunsController;
  let runRepo: { findById: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    runRepo = { findById: vi.fn() };
    controller = new RunsController(runRepo as unknown as RunRepository);
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
});
