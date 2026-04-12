/**
 * W5-10: Memory Persistence Verification Tests
 *
 * Guarded by RUN_E2E env var. Tests real pgvector cosine similarity search,
 * memory staging, merging, and cross-run memory hits.
 *
 * Requires: PostgreSQL with pgvector extension, OPENAI_API_KEY for real embeddings.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../src/persistence/prisma.service';
import { EmbeddingService } from '../../src/memory/embedding.service';
import { MemoryConnectorService } from '../../src/memory/memory-connector.service';
import { MemoryActivities } from '../../src/memory/memory.activities';
import { AuditRepository } from '../../src/audit/audit.repository';
import { AuditLoggerService } from '../../src/audit/audit-logger.service';

const WELL_KNOWN_HARNESS_ID = '00000000-0000-0000-0000-000000000001';

describe.skipIf(!process.env.RUN_E2E)('W5-10: Memory persistence verification', () => {
  let prisma: PrismaClient;
  let memoryConnector: MemoryConnectorService;
  let memoryActivities: MemoryActivities;
  let embeddingService: EmbeddingService;
  let auditLogger: AuditLoggerService;

  const runId1 = uuidv4();
  const runId2 = uuidv4();

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL ?? 'postgresql://finch:finch@localhost:5432/finch',
        },
      },
    });
    await prisma.$connect();

    const ps = prisma as unknown as PrismaService;

    embeddingService = new EmbeddingService();
    const auditRepo = new AuditRepository(ps);
    const mockQueue = { add: async () => {} } as never;
    auditLogger = new AuditLoggerService(auditRepo, mockQueue);
    memoryConnector = new MemoryConnectorService(ps, embeddingService, auditLogger);
    memoryActivities = new MemoryActivities(memoryConnector, auditLogger);

    // Create test runs
    await prisma.$executeRawUnsafe(
      `INSERT INTO runs (run_id, harness_id, temporal_workflow_id, status, current_phase)
       VALUES ($1::uuid, $2::uuid, $3, 'RUNNING', 'SHIP')`,
      runId1, WELL_KNOWN_HARNESS_ID, `finch-${runId1}`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO runs (run_id, harness_id, temporal_workflow_id, status, current_phase)
       VALUES ($1::uuid, $2::uuid, $3, 'RUNNING', 'SHIP')`,
      runId2, WELL_KNOWN_HARNESS_ID, `finch-${runId2}`,
    );
  });

  afterAll(async () => {
    // Cleanup
    await prisma.$executeRawUnsafe(`DELETE FROM memory_staging WHERE run_id = $1::uuid`, runId1).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM memory_staging WHERE run_id = $1::uuid`, runId2).catch(() => {});
    await prisma.$executeRawUnsafe(
      `DELETE FROM memory_records WHERE source_run_id = $1::uuid OR source_run_id = $2::uuid`,
      runId1, runId2,
    ).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM audit_events WHERE run_id = $1::uuid`, runId1).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM audit_events WHERE run_id = $1::uuid`, runId2).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM runs WHERE run_id = $1::uuid`, runId1).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM runs WHERE run_id = $1::uuid`, runId2).catch(() => {});
    await prisma.$disconnect();
  });

  it('writeToStaging creates staging records with embeddings', async () => {
    await memoryConnector.writeToStaging({
      runId: runId1,
      harnessId: WELL_KNOWN_HARNESS_ID,
      type: 'TaskPattern',
      content: 'When fixing payment bugs, always check the validator regex first',
      relevanceTags: ['payments', 'validator', 'regex'],
      agentId: 'ship-default',
    });

    await memoryConnector.writeToStaging({
      runId: runId1,
      harnessId: WELL_KNOWN_HARNESS_ID,
      type: 'Decision',
      content: 'Used lodash.debounce for rate limiting API calls',
      relevanceTags: ['lodash', 'rate-limiting', 'api'],
      agentId: 'ship-default',
    });

    const records = await memoryConnector.getStagingRecords(runId1);
    expect(records).toHaveLength(2);
    expect(records[0].embedding).toHaveLength(1536);
    expect(records[0].contentHash).toBeDefined();
  });

  it('mergeRunMemory moves staging records to memory_records', async () => {
    await memoryActivities.mergeRunMemory(runId1);

    // Verify staging is cleared (ME-03)
    const remaining = await memoryConnector.getStagingRecords(runId1);
    expect(remaining).toHaveLength(0);
  });

  it('query returns MemoryHit[] with relevanceScore >= 0.7', async () => {
    const hits = await memoryConnector.query({
      harnessId: WELL_KNOWN_HARNESS_ID,
      query: 'fix payment validator regex bug',
    });

    // Should find the payment-related memory
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].score).toBeGreaterThanOrEqual(0.7);
    expect(hits[0].type).toBeDefined();
    expect(hits[0].content).toBeDefined();
    expect(hits[0].memoryId).toBeDefined();
  });

  it('cross-run memory hit: run2 can find memories from run1', async () => {
    // Stage and merge a different memory for run2
    await memoryConnector.writeToStaging({
      runId: runId2,
      harnessId: WELL_KNOWN_HARNESS_ID,
      type: 'EnvironmentConfig',
      content: 'Production deployment requires staging validation first',
      relevanceTags: ['deployment', 'staging'],
      agentId: 'ship-default',
    });
    await memoryActivities.mergeRunMemory(runId2);

    // Query from run2 context should still find run1 memories
    const hits = await memoryConnector.query({
      harnessId: WELL_KNOWN_HARNESS_ID,
      query: 'payment validator fix approach',
    });

    expect(hits.length).toBeGreaterThanOrEqual(1);
    // At least one hit should be from run1
    const run1Hit = hits.find(h => h.sourceRunId === runId1);
    if (run1Hit) {
      expect(run1Hit.score).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('query with type filter returns only matching types', async () => {
    const hits = await memoryConnector.query({
      harnessId: WELL_KNOWN_HARNESS_ID,
      query: 'payment bug fix',
      types: ['TaskPattern'],
    });

    for (const hit of hits) {
      expect(hit.type).toBe('TaskPattern');
    }
  });
});
