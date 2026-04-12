import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GateRepository } from '../../src/persistence/gate.repository';
import { PrismaService } from '../../src/persistence/prisma.service';

describe('GateRepository', () => {
  let repo: GateRepository;
  let prisma: {
    gateEvent: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      gateEvent: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
    };
    repo = new GateRepository(prisma as unknown as PrismaService);
  });

  it('create calls prisma.gateEvent.create', async () => {
    const data = {
      runId: 'r1',
      harnessId: 'h1',
      phase: 'PLAN',
      agentId: 'agent1',
      pipelinePosition: 0,
      gapDescription: 'gap',
      question: 'q',
      source: {},
      snapshot: {},
      temporalWorkflowId: 'tw1',
    };
    const expected = { gateId: 'g1', ...data };
    prisma.gateEvent.create.mockResolvedValue(expected);
    const result = await repo.create(data);
    expect(prisma.gateEvent.create).toHaveBeenCalledWith({ data });
    expect(result).toBe(expected);
  });

  it('findById returns gate or null', async () => {
    prisma.gateEvent.findUnique.mockResolvedValue(null);
    const result = await repo.findById('nonexistent');
    expect(result).toBeNull();
  });

  it('findByRunId returns gates ordered by firedAt', async () => {
    prisma.gateEvent.findMany.mockResolvedValue([]);
    const result = await repo.findByRunId('r1');
    expect(result).toEqual([]);
    expect(prisma.gateEvent.findMany).toHaveBeenCalledWith({
      where: { runId: 'r1' },
      orderBy: { firedAt: 'asc' },
    });
  });

  it('findOpenGateByThread returns matching gate', async () => {
    const gate = {
      gateId: 'g1',
      source: { channelId: 'C123', threadTs: 'T456' },
      resolvedAt: null,
    };
    prisma.gateEvent.findMany.mockResolvedValue([gate]);
    const result = await repo.findOpenGateByThread({
      channelId: 'C123',
      threadTs: 'T456',
    });
    expect(result).toBe(gate);
  });

  it('findOpenGateByThread returns null when no match', async () => {
    const gate = {
      gateId: 'g1',
      source: { channelId: 'C123', threadTs: 'T999' },
      resolvedAt: null,
    };
    prisma.gateEvent.findMany.mockResolvedValue([gate]);
    const result = await repo.findOpenGateByThread({
      channelId: 'C123',
      threadTs: 'T456',
    });
    expect(result).toBeNull();
  });

  it('findOpenGateByThread returns null when no gates', async () => {
    prisma.gateEvent.findMany.mockResolvedValue([]);
    const result = await repo.findOpenGateByThread({
      channelId: 'C123',
      threadTs: 'T456',
    });
    expect(result).toBeNull();
  });

  it('saveResolution updates resolution and resolvedAt', async () => {
    const expected = { gateId: 'g1', resolution: { answer: 'yes' } };
    prisma.gateEvent.update.mockResolvedValue(expected);
    const result = await repo.saveResolution('g1', { answer: 'yes' });
    expect(prisma.gateEvent.update).toHaveBeenCalledWith({
      where: { gateId: 'g1' },
      data: {
        resolution: { answer: 'yes' },
        resolvedAt: expect.any(Date),
      },
    });
    expect(result).toBe(expected);
  });

  it('markResolved sets resolvedAt', async () => {
    const expected = { gateId: 'g1' };
    prisma.gateEvent.update.mockResolvedValue(expected);
    const result = await repo.markResolved('g1');
    expect(prisma.gateEvent.update).toHaveBeenCalledWith({
      where: { gateId: 'g1' },
      data: { resolvedAt: expect.any(Date) },
    });
    expect(result).toBe(expected);
  });
});
