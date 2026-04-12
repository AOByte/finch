import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HarnessRepository } from '../../src/persistence/harness.repository';
import { PrismaService } from '../../src/persistence/prisma.service';

describe('HarnessRepository', () => {
  let repo: HarnessRepository;
  let prisma: {
    harness: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    prisma = {
      harness: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        update: vi.fn(),
      },
    };
    repo = new HarnessRepository(prisma as unknown as PrismaService);
  });

  it('create calls prisma.harness.create', async () => {
    const data = { name: 'test-harness' };
    const expected = { harnessId: 'h1', ...data };
    prisma.harness.create.mockResolvedValue(expected);
    const result = await repo.create(data);
    expect(prisma.harness.create).toHaveBeenCalledWith({ data });
    expect(result).toBe(expected);
  });

  it('findById returns harness or null', async () => {
    prisma.harness.findUnique.mockResolvedValue(null);
    const result = await repo.findById('nonexistent');
    expect(result).toBeNull();
    expect(prisma.harness.findUnique).toHaveBeenCalledWith({
      where: { harnessId: 'nonexistent' },
    });
  });

  it('findByName returns harness or null', async () => {
    const expected = { harnessId: 'h1', name: 'default' };
    prisma.harness.findFirst.mockResolvedValue(expected);
    const result = await repo.findByName('default');
    expect(result).toBe(expected);
    expect(prisma.harness.findFirst).toHaveBeenCalledWith({
      where: { name: 'default' },
    });
  });

  it('findAll returns all harnesses', async () => {
    const expected = [{ harnessId: 'h1' }, { harnessId: 'h2' }];
    prisma.harness.findMany.mockResolvedValue(expected);
    const result = await repo.findAll();
    expect(result).toBe(expected);
    expect(prisma.harness.findMany).toHaveBeenCalled();
  });

  it('update calls prisma.harness.update', async () => {
    const expected = { harnessId: 'h1', name: 'updated' };
    prisma.harness.update.mockResolvedValue(expected);
    const result = await repo.update('h1', { name: 'updated' });
    expect(prisma.harness.update).toHaveBeenCalledWith({
      where: { harnessId: 'h1' },
      data: { name: 'updated' },
    });
    expect(result).toBe(expected);
  });
});
