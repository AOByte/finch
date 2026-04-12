import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../persistence/prisma.service';
import { EmbeddingService } from './embedding.service';
import { AuditLoggerService } from '../audit/audit-logger.service';
import type { MemoryType, MemoryHit } from '@finch/types';

export interface MemoryStagingRecord {
  stagingId: string;
  runId: string;
  harnessId: string;
  type: string;
  content: string;
  embedding: number[];
  relevanceTags: string[];
  contentHash: string;
  createdAt: Date;
}

@Injectable()
export class MemoryConnectorService {
  private readonly logger = new Logger(MemoryConnectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly auditLogger: AuditLoggerService,
  ) {}

  async query(params: {
    harnessId: string;
    query: string;
    limit?: number;
    types?: MemoryType[];
    minRelevanceScore?: number;
  }): Promise<MemoryHit[]> {
    const queryEmbedding = await this.embedding.embed(params.query);
    const embeddingLiteral = `[${queryEmbedding.join(',')}]`;
    const minScore = params.minRelevanceScore ?? 0.7;
    const limit = params.limit ?? 10;

    // AR-05: Raw SQL permitted for pgvector cosine similarity
    const typesFilter = params.types && params.types.length > 0
      ? params.types
      : null;

    let results: Array<{
      memory_id: string;
      type: string;
      content: string;
      relevance_tags: string[];
      source_run_id: string | null;
      relevance_score: number;
    }>;

    if (typesFilter) {
      results = await this.prisma.$queryRawUnsafe(
        `SELECT memory_id, type::text, content, relevance_tags, source_run_id,
                1 - (embedding <=> $1::vector) AS relevance_score
         FROM memory_records
         WHERE harness_id = $2::uuid
           AND type = ANY($3::memory_type[])
           AND 1 - (embedding <=> $1::vector) >= $4
         ORDER BY embedding <=> $1::vector
         LIMIT $5`,
        embeddingLiteral,
        params.harnessId,
        typesFilter,
        minScore,
        limit,
      );
    } else {
      results = await this.prisma.$queryRawUnsafe(
        `SELECT memory_id, type::text, content, relevance_tags, source_run_id,
                1 - (embedding <=> $1::vector) AS relevance_score
         FROM memory_records
         WHERE harness_id = $2::uuid
           AND 1 - (embedding <=> $1::vector) >= $3
         ORDER BY embedding <=> $1::vector
         LIMIT $4`,
        embeddingLiteral,
        params.harnessId,
        minScore,
        limit,
      );
    }

    const hits: MemoryHit[] = results.map((r) => ({
      memoryId: r.memory_id,
      type: r.type as MemoryType,
      content: r.content,
      relevanceTags: r.relevance_tags,
      score: Number(r.relevance_score),
      sourceRunId: r.source_run_id ?? undefined,
    }));

    this.logger.debug(`Memory query returned ${hits.length} hits for harness=${params.harnessId}`);
    return hits;
  }

  async writeToStaging(params: {
    runId: string;
    harnessId: string;
    type: MemoryType;
    content: string;
    relevanceTags: string[];
    agentId: string;
  }): Promise<void> {
    const embeddingVector = await this.embedding.embed(params.content);
    const contentHash = createHash('sha256').update(params.content).digest('hex');
    const embeddingLiteral = `[${embeddingVector.join(',')}]`;

    // Raw SQL because Prisma cannot handle vector column
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO memory_staging
        (staging_id, run_id, harness_id, type, content, embedding, relevance_tags, content_hash, created_at)
       VALUES
        (gen_random_uuid(), $1::uuid, $2::uuid, $3::memory_type, $4, $5::vector, $6::text[], $7, NOW())`,
      params.runId,
      params.harnessId,
      params.type,
      params.content,
      embeddingLiteral,
      params.relevanceTags,
      contentHash,
    );

    // Emit memory_staged audit event
    await this.auditLogger.log({
      runId: params.runId,
      harnessId: params.harnessId,
      eventType: 'memory_staged',
      actor: { type: 'agent', agentId: params.agentId },
      payload: { type: params.type, contentHash, relevanceTags: params.relevanceTags },
    });

    this.logger.debug(`Memory staged for run=${params.runId}: type=${params.type}`);
  }

  async mergeRecord(record: MemoryStagingRecord): Promise<void> {
    // ME-02: ON CONFLICT (harness_id, content_hash) DO UPDATE — last write wins
    const embeddingLiteral = `[${record.embedding.join(',')}]`;

    await this.prisma.$executeRawUnsafe(
      `INSERT INTO memory_records
        (memory_id, harness_id, type, content, embedding, source_run_id,
         relevance_tags, content_hash, created_at, updated_at)
       VALUES
        (gen_random_uuid(), $1::uuid, $2::memory_type, $3, $4::vector,
         $5::uuid, $6::text[], $7, NOW(), NOW())
       ON CONFLICT (harness_id, content_hash)
       DO UPDATE SET
        content       = EXCLUDED.content,
        embedding     = EXCLUDED.embedding,
        updated_at    = NOW(),
        source_run_id = EXCLUDED.source_run_id`,
      record.harnessId,
      record.type,
      record.content,
      embeddingLiteral,
      record.runId,
      record.relevanceTags,
      record.contentHash,
    );
  }

  async getStagingRecords(runId: string): Promise<MemoryStagingRecord[]> {
    const rows = await this.prisma.$queryRawUnsafe<Array<{
      staging_id: string;
      run_id: string;
      harness_id: string;
      type: string;
      content: string;
      embedding: string;
      relevance_tags: string[];
      content_hash: string;
      created_at: Date;
    }>>(
      `SELECT staging_id, run_id, harness_id, type::text, content,
              embedding::text, relevance_tags, content_hash, created_at
       FROM memory_staging
       WHERE run_id = $1::uuid`,
      runId,
    );

    return rows.map((r) => ({
      stagingId: r.staging_id,
      runId: r.run_id,
      harnessId: r.harness_id,
      type: r.type,
      content: r.content,
      embedding: this.parseEmbeddingString(r.embedding),
      relevanceTags: r.relevance_tags,
      contentHash: r.content_hash,
      createdAt: r.created_at,
    }));
  }

  async clearStaging(runId: string): Promise<void> {
    // ME-03: Clear staging records after merge
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM memory_staging WHERE run_id = $1::uuid`,
      runId,
    );
  }

  private parseEmbeddingString(embeddingStr: string): number[] {
    // pgvector returns "[0.1,0.2,...]" as text
    const cleaned = embeddingStr.replace(/^\[/, '').replace(/\]$/, '');
    if (!cleaned) return [];
    return cleaned.split(',').map(Number);
  }
}
