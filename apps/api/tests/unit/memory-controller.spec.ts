import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MemoryController } from '../../src/api/memory.controller';
import { PrismaService } from '../../src/persistence/prisma.service';
import { MemoryConnectorService } from '../../src/memory/memory-connector.service';

describe('MemoryController', () => {
  let controller: MemoryController;
  let prisma: {
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let memoryConnector: {
    query: ReturnType<typeof vi.fn>;
    writeToStaging: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    prisma = { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn() };
    memoryConnector = {
      query: vi.fn().mockResolvedValue([]),
      writeToStaging: vi.fn().mockResolvedValue(undefined),
    };
    controller = new MemoryController(
      prisma as unknown as PrismaService,
      memoryConnector as unknown as MemoryConnectorService,
    );
  });

  it('list returns { data, meta } envelope', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const result = await controller.list('h1');
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('meta');
  });

  it('list with q param uses semantic search', async () => {
    memoryConnector.query.mockResolvedValue([{ memoryId: 'm1', score: 0.9 }]);
    const result = await controller.list('h1', 'search query');
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('meta');
    expect(memoryConnector.query).toHaveBeenCalledWith(
      expect.objectContaining({ harnessId: 'h1', query: 'search query' }),
    );
  });

  it('list throws BadRequestException when no harnessId', async () => {
    await expect(controller.list()).rejects.toThrow(BadRequestException);
  });

  it('create returns { data } envelope', async () => {
    const result = await controller.create({
      harnessId: 'h1',
      type: 'TaskPattern',
      content: 'test content',
    });
    expect(result).toHaveProperty('data');
    expect(result.data).toHaveProperty('status', 'staged');
  });

  it('update returns { data } envelope', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ memory_id: 'm1' }]);
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    const result = await controller.update('m1', { content: 'updated' });
    expect(result).toHaveProperty('data');
    expect(result.data).toHaveProperty('updated', true);
  });

  it('update throws NotFoundException when not found', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    await expect(controller.update('nonexistent', {})).rejects.toThrow(NotFoundException);
  });

  it('remove returns { data } envelope', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ memory_id: 'm1' }]);
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    const result = await controller.remove('m1');
    expect(result).toHaveProperty('data');
    expect(result.data).toHaveProperty('deleted', true);
  });

  it('remove throws NotFoundException when not found', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    await expect(controller.remove('nonexistent')).rejects.toThrow(NotFoundException);
  });

  it('create throws BadRequestException when fields missing', async () => {
    await expect(controller.create({ harnessId: '', type: '' as any, content: '' })).rejects.toThrow(BadRequestException);
  });

  it('list with type filter passes type to query', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const result = await controller.list('h1', undefined, 'TaskPattern');
    expect(result.data).toEqual([]);
  });

  it('list with cursor uses cursor-based pagination', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const result = await controller.list('h1', undefined, undefined, undefined, 'cursor-id');
    expect(result.data).toEqual([]);
  });

  it('list with cursor and type filter', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const result = await controller.list('h1', undefined, 'TaskPattern', undefined, 'cursor-id');
    expect(result.data).toEqual([]);
  });

  it('list with q and type uses semantic search with types', async () => {
    memoryConnector.query.mockResolvedValue([]);
    const result = await controller.list('h1', 'search', 'TaskPattern');
    expect(memoryConnector.query).toHaveBeenCalledWith(
      expect.objectContaining({ types: ['TaskPattern'] }),
    );
  });

  it('list with q and custom limit', async () => {
    memoryConnector.query.mockResolvedValue([]);
    await controller.list('h1', 'search', undefined, '5');
    expect(memoryConnector.query).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 }),
    );
  });

  it('update with relevanceTags', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ memory_id: 'm1' }]);
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    const result = await controller.update('m1', { relevanceTags: ['tag1'] });
    expect(result.data).toHaveProperty('updated', true);
  });

  it('update with both content and relevanceTags', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{ memory_id: 'm1' }]);
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    const result = await controller.update('m1', { content: 'new', relevanceTags: ['tag1'] });
    expect(result.data).toHaveProperty('updated', true);
  });

  it('list paginated returns mapped data with nextCursor', async () => {
    const records = Array.from({ length: 20 }, (_, i) => ({
      memory_id: `m${i}`,
      harness_id: 'h1',
      type: 'TaskPattern',
      content: `content-${i}`,
      relevance_tags: [],
      source_run_id: null,
      content_hash: 'hash',
      created_at: new Date(),
      updated_at: new Date(),
    }));
    prisma.$queryRawUnsafe.mockResolvedValue(records);
    const result = await controller.list('h1');
    expect(result.data).toHaveLength(20);
    expect(result.meta.hasMore).toBe(true);
    expect(result.meta.nextCursor).toBe('m19');
  });
});
