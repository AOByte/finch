import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RunRepository } from '../../src/persistence/run.repository';
import { PrismaService } from '../../src/persistence/prisma.service';

describe('RunRepository', () => {
  let repo: RunRepository;
  let prisma: {
    run: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      run: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
    };
    repo = new RunRepository(prisma as unknown as PrismaService);
  });

  it('create calls prisma.run.create', async () => {
    const data = {
      runId: 'r1',
      harnessId: 'h1',
      temporalWorkflowId: 'tw1',
      status: 'RUNNING',
      currentPhase: 'TRIGGER',
    };
    const expected = { ...data, startedAt: new Date() };
    prisma.run.create.mockResolvedValue(expected);
    const result = await repo.create(data);
    expect(prisma.run.create).toHaveBeenCalledWith({ data });
    expect(result).toBe(expected);
  });

  it('findById returns run or null', async () => {
    prisma.run.findUnique.mockResolvedValue(null);
    const result = await repo.findById('nonexistent');
    expect(result).toBeNull();
    expect(prisma.run.findUnique).toHaveBeenCalledWith({ where: { runId: 'nonexistent' } });
  });

  it('findByHarnessId returns paginated runs', async () => {
    prisma.run.findMany.mockResolvedValue([]);
    const result = await repo.findByHarnessId('h1', { skip: 0, take: 10 });
    expect(result).toEqual([]);
    expect(prisma.run.findMany).toHaveBeenCalledWith({
      where: { harnessId: 'h1' },
      orderBy: { startedAt: 'desc' },
      skip: 0,
      take: 10,
    });
  });

  it('findByHarnessId works without options', async () => {
    prisma.run.findMany.mockResolvedValue([]);
    await repo.findByHarnessId('h1');
    expect(prisma.run.findMany).toHaveBeenCalledWith({
      where: { harnessId: 'h1' },
      orderBy: { startedAt: 'desc' },
      skip: undefined,
      take: undefined,
    });
  });

  it('updateStatus updates status field', async () => {
    const expected = { runId: 'r1', status: 'COMPLETED' };
    prisma.run.update.mockResolvedValue(expected);
    const result = await repo.updateStatus('r1', 'COMPLETED');
    expect(prisma.run.update).toHaveBeenCalledWith({
      where: { runId: 'r1' },
      data: { status: 'COMPLETED' },
    });
    expect(result).toBe(expected);
  });

  it('updatePhase updates currentPhase field', async () => {
    const expected = { runId: 'r1', currentPhase: 'PLAN' };
    prisma.run.update.mockResolvedValue(expected);
    const result = await repo.updatePhase('r1', 'PLAN');
    expect(prisma.run.update).toHaveBeenCalledWith({
      where: { runId: 'r1' },
      data: { currentPhase: 'PLAN' },
    });
    expect(result).toBe(expected);
  });

  it('updatePipelinePosition writes phase, position, and artifact', async () => {
    const artifact = { key: 'value' };
    const expected = { runId: 'r1', pipelinePosition: 2, pipelineArtifact: artifact };
    prisma.run.update.mockResolvedValue(expected);
    const result = await repo.updatePipelinePosition('r1', 'EXECUTE', 2, artifact);
    expect(prisma.run.update).toHaveBeenCalledWith({
      where: { runId: 'r1' },
      data: {
        currentPhase: 'EXECUTE',
        pipelinePosition: 2,
        pipelineArtifact: artifact,
      },
    });
    expect(result).toBe(expected);
  });

  it('getPipelineState returns state when present', async () => {
    prisma.run.findUnique.mockResolvedValue({
      pipelinePosition: 3,
      pipelineArtifact: { foo: 'bar' },
    });
    const result = await repo.getPipelineState('r1', 'PLAN');
    expect(result).toEqual({ pipelinePosition: 3, pipelineArtifact: { foo: 'bar' } });
  });

  it('getPipelineState returns null when run not found', async () => {
    prisma.run.findUnique.mockResolvedValue(null);
    const result = await repo.getPipelineState('r1', 'PLAN');
    expect(result).toBeNull();
  });

  it('getPipelineState returns null when position is null', async () => {
    prisma.run.findUnique.mockResolvedValue({
      pipelinePosition: null,
      pipelineArtifact: null,
    });
    const result = await repo.getPipelineState('r1', 'PLAN');
    expect(result).toBeNull();
  });

  it('getPipelineState returns null when artifact is null', async () => {
    prisma.run.findUnique.mockResolvedValue({
      pipelinePosition: 1,
      pipelineArtifact: null,
    });
    const result = await repo.getPipelineState('r1', 'PLAN');
    expect(result).toBeNull();
  });

  it('getPersistedPipelineArtifact returns artifact when position matches', async () => {
    prisma.run.findUnique.mockResolvedValue({
      pipelinePosition: 5,
      pipelineArtifact: { result: 'ok' },
    });
    const result = await repo.getPersistedPipelineArtifact('r1', 'EXECUTE', 5);
    expect(result).toEqual({ result: 'ok' });
  });

  it('getPersistedPipelineArtifact returns null when position does not match', async () => {
    prisma.run.findUnique.mockResolvedValue({
      pipelinePosition: 5,
      pipelineArtifact: { result: 'ok' },
    });
    const result = await repo.getPersistedPipelineArtifact('r1', 'EXECUTE', 3);
    expect(result).toBeNull();
  });

  it('getPersistedPipelineArtifact returns null when run not found', async () => {
    prisma.run.findUnique.mockResolvedValue(null);
    const result = await repo.getPersistedPipelineArtifact('r1', 'EXECUTE', 5);
    expect(result).toBeNull();
  });

  it('getPersistedPipelineArtifact returns null when position is null', async () => {
    prisma.run.findUnique.mockResolvedValue({
      pipelinePosition: null,
      pipelineArtifact: null,
    });
    const result = await repo.getPersistedPipelineArtifact('r1', 'EXECUTE', 5);
    expect(result).toBeNull();
  });

  it('getPersistedPipelineArtifact returns null when artifact is null', async () => {
    prisma.run.findUnique.mockResolvedValue({
      pipelinePosition: 5,
      pipelineArtifact: null,
    });
    const result = await repo.getPersistedPipelineArtifact('r1', 'EXECUTE', 5);
    expect(result).toBeNull();
  });

  it('markCompleted sets status and completedAt', async () => {
    const expected = { runId: 'r1', status: 'COMPLETED' };
    prisma.run.update.mockResolvedValue(expected);
    const result = await repo.markCompleted('r1');
    expect(prisma.run.update).toHaveBeenCalledWith({
      where: { runId: 'r1' },
      data: {
        status: 'COMPLETED',
        completedAt: expect.any(Date),
      },
    });
    expect(result).toBe(expected);
  });
});
