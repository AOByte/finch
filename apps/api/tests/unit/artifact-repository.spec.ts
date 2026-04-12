import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArtifactRepository } from '../../src/persistence/artifact.repository';
import { PrismaService } from '../../src/persistence/prisma.service';

describe('ArtifactRepository', () => {
  let repo: ArtifactRepository;
  let prisma: {
    phaseArtifact: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      phaseArtifact: {
        create: vi.fn(),
        findFirst: vi.fn(),
      },
    };
    repo = new ArtifactRepository(prisma as unknown as PrismaService);
  });

  it('save calls prisma.phaseArtifact.create', async () => {
    const data = {
      runId: 'r1',
      phase: 'TRIGGER',
      artifactType: 'task_descriptor',
      content: { key: 'value' },
      version: 1,
    };
    const expected = { artifactId: 'a1', ...data };
    prisma.phaseArtifact.create.mockResolvedValue(expected);
    const result = await repo.save(data);
    expect(prisma.phaseArtifact.create).toHaveBeenCalledWith({ data });
    expect(result).toBe(expected);
  });

  it('findByRunIdAndPhase returns latest artifact', async () => {
    const expected = { artifactId: 'a1', version: 2 };
    prisma.phaseArtifact.findFirst.mockResolvedValue(expected);
    const result = await repo.findByRunIdAndPhase('r1', 'PLAN');
    expect(prisma.phaseArtifact.findFirst).toHaveBeenCalledWith({
      where: { runId: 'r1', phase: 'PLAN' },
      orderBy: { version: 'desc' },
    });
    expect(result).toBe(expected);
  });

  it('findByRunIdAndPhase returns null when not found', async () => {
    prisma.phaseArtifact.findFirst.mockResolvedValue(null);
    const result = await repo.findByRunIdAndPhase('r1', 'PLAN');
    expect(result).toBeNull();
  });
});
