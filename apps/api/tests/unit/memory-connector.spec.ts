import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryConnectorService } from '../../src/memory/memory-connector.service';
import { PrismaService } from '../../src/persistence/prisma.service';
import { EmbeddingService } from '../../src/memory/embedding.service';
import { AuditLoggerService } from '../../src/audit/audit-logger.service';

describe('MemoryConnectorService', () => {
  let service: MemoryConnectorService;
  let prisma: {
    $queryRawUnsafe: ReturnType<typeof vi.fn>;
    $executeRawUnsafe: ReturnType<typeof vi.fn>;
  };
  let embedding: { embed: ReturnType<typeof vi.fn> };
  let auditLogger: { log: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn() };
    embedding = { embed: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)) };
    auditLogger = { log: vi.fn().mockResolvedValue(undefined) };
    service = new MemoryConnectorService(
      prisma as unknown as PrismaService,
      embedding as unknown as EmbeddingService,
      auditLogger as unknown as AuditLoggerService,
    );
  });

  it('query calls embedding.embed and returns MemoryHit[] with relevanceScore', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      {
        memory_id: 'm1',
        type: 'TaskPattern',
        content: 'test content',
        relevance_tags: ['tag1'],
        source_run_id: 'r1',
        relevance_score: 0.85,
      },
    ]);
    const result = await service.query({ harnessId: 'h1', query: 'search text' });
    expect(embedding.embed).toHaveBeenCalledWith('search text');
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('score', 0.85);
    expect(result[0]).toHaveProperty('memoryId', 'm1');
  });

  it('query with types filter uses type-filtered SQL path', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const result = await service.query({ harnessId: 'h1', query: 'search', types: ['TaskPattern' as any] });
    expect(result).toHaveLength(0);
    const sql = prisma.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('ANY');
  });

  it('query with empty types array uses non-filtered path', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const result = await service.query({ harnessId: 'h1', query: 'search', types: [] });
    expect(result).toHaveLength(0);
  });

  it('query with null source_run_id returns undefined sourceRunId', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{
      memory_id: 'm1', type: 'TaskPattern', content: 'test',
      relevance_tags: [], source_run_id: null, relevance_score: 0.8,
    }]);
    const result = await service.query({ harnessId: 'h1', query: 'test' });
    expect(result[0].sourceRunId).toBeUndefined();
  });

  it('parseEmbeddingString handles empty string', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([{
      staging_id: 's1', run_id: 'r1', harness_id: 'h1',
      type: 'TaskPattern', content: 'test', embedding: '[]',
      relevance_tags: [], content_hash: 'h', created_at: new Date(),
    }]);
    const result = await service.getStagingRecords('r1');
    expect(result[0].embedding).toEqual([]);
  });

  it('writeToStaging generates embedding and emits memory_staged audit event', async () => {
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    await service.writeToStaging({
      runId: 'r1',
      harnessId: 'h1',
      type: 'TaskPattern',
      content: 'test content',
      relevanceTags: ['tag1'],
      agentId: 'acquire-default',
    });
    expect(embedding.embed).toHaveBeenCalledWith('test content');
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'memory_staged' }),
    );
  });

  it('mergeRecord performs upsert via raw SQL', async () => {
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    await service.mergeRecord({
      stagingId: 's1',
      runId: 'r1',
      harnessId: 'h1',
      type: 'TaskPattern',
      content: 'test',
      embedding: [0.1, 0.2],
      relevanceTags: ['tag1'],
      contentHash: 'hash1',
      createdAt: new Date(),
    });
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    const sql = prisma.$executeRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('ON CONFLICT');
  });

  it('getStagingRecords returns parsed records', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      {
        staging_id: 's1',
        run_id: 'r1',
        harness_id: 'h1',
        type: 'TaskPattern',
        content: 'test',
        embedding: '[0.1,0.2]',
        relevance_tags: ['tag1'],
        content_hash: 'hash1',
        created_at: new Date(),
      },
    ]);
    const result = await service.getStagingRecords('r1');
    expect(result).toHaveLength(1);
    expect(result[0].embedding).toEqual([0.1, 0.2]);
  });

  it('clearStaging deletes staging records for a run', async () => {
    prisma.$executeRawUnsafe.mockResolvedValue(1);
    await service.clearStaging('r1');
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
    const sql = prisma.$executeRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain('DELETE FROM memory_staging');
  });
});
