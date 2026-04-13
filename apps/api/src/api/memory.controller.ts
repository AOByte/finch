import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Query,
  Param,
  Body,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';
import { MemoryConnectorService } from '../memory/memory-connector.service';
import type { MemoryType } from '@finch/types';

@Controller('api/memory')
export class MemoryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memoryConnector: MemoryConnectorService,
  ) {}

  @Get()
  async list(
    @Query('harnessId') harnessId?: string,
    @Query('q') q?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    if (!harnessId) {
      throw new BadRequestException('harnessId query parameter is required');
    }

    // If a semantic query is provided, use the embedding-based search
    if (q) {
      const types = type ? [type as MemoryType] : undefined;
      const hits = await this.memoryConnector.query({
        harnessId,
        query: q,
        limit: limit ? parseInt(limit, 10) : 10,
        types,
      });
      return {
        data: hits,
        meta: { total: hits.length, hasMore: false },
      };
    }

    // Otherwise, do a regular paginated list
    const take = limit ? parseInt(limit, 10) : 20;
    const where: Record<string, unknown> = { harnessId };
    if (type) {
      where['type'] = type;
    }

    // Build parameterized query — LIMIT is passed as a parameter, not interpolated
    const params: unknown[] = [harnessId];
    let paramIdx = 2;
    let sql: string;

    if (cursor) {
      const cursorParamIdx = paramIdx++;
      const typeParamIdx = type ? paramIdx++ : 0;
      const limitParamIdx = paramIdx++;
      sql = `SELECT memory_id, harness_id, type::text, content, relevance_tags,
                source_run_id, content_hash, created_at, updated_at
         FROM memory_records
         WHERE harness_id = $1::uuid
           ${type ? `AND type = $${typeParamIdx}::memory_type` : ''}
           AND memory_id > $${cursorParamIdx}::uuid
         ORDER BY memory_id
         LIMIT $${limitParamIdx}`;
      params.push(cursor);
      if (type) params.push(type);
      params.push(take);
    } else {
      const typeParamIdx = type ? paramIdx++ : 0;
      const limitParamIdx = paramIdx++;
      sql = `SELECT memory_id, harness_id, type::text, content, relevance_tags,
                source_run_id, content_hash, created_at, updated_at
         FROM memory_records
         WHERE harness_id = $1::uuid
           ${type ? `AND type = $${typeParamIdx}::memory_type` : ''}
         ORDER BY memory_id
         LIMIT $${limitParamIdx}`;
      if (type) params.push(type);
      params.push(take);
    }

    const records = await this.prisma.$queryRawUnsafe<Array<{
      memory_id: string;
      harness_id: string;
      type: string;
      content: string;
      relevance_tags: string[];
      source_run_id: string | null;
      content_hash: string;
      created_at: Date;
      updated_at: Date;
    }>>(sql, ...params);

    const data = records.map((r) => ({
      memoryId: r.memory_id,
      harnessId: r.harness_id,
      type: r.type,
      content: r.content,
      relevanceTags: r.relevance_tags,
      sourceRunId: r.source_run_id,
      contentHash: r.content_hash,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    const nextCursor = data.length === take ? data[data.length - 1].memoryId : undefined;

    return {
      data,
      meta: {
        total: data.length,
        hasMore: data.length === take,
        nextCursor,
      },
    };
  }

  @Post()
  async create(
    @Body() body: {
      harnessId: string;
      type: MemoryType;
      content: string;
      relevanceTags?: string[];
      runId?: string;
      agentId?: string;
    },
  ) {
    if (!body.harnessId || !body.type || !body.content) {
      throw new BadRequestException('harnessId, type, and content are required');
    }

    await this.memoryConnector.writeToStaging({
      runId: body.runId ?? '00000000-0000-0000-0000-000000000000',
      harnessId: body.harnessId,
      type: body.type,
      content: body.content,
      relevanceTags: body.relevanceTags ?? [],
      agentId: body.agentId ?? 'api',
    });

    return { data: { status: 'staged', type: body.type } };
  }

  @Patch(':memoryId')
  async update(
    @Param('memoryId') memoryId: string,
    @Body() body: { content?: string; relevanceTags?: string[] },
  ) {
    // Check existence
    const existing = await this.prisma.$queryRawUnsafe<Array<{ memory_id: string }>>(
      `SELECT memory_id FROM memory_records WHERE memory_id = $1::uuid`,
      memoryId,
    );
    if (existing.length === 0) {
      throw new NotFoundException(`Memory record ${memoryId} not found`);
    }

    const updates: string[] = [];
    const params: unknown[] = [memoryId];
    let paramIdx = 2;

    if (body.content !== undefined) {
      updates.push(`content = $${paramIdx}`);
      params.push(body.content);
      paramIdx++;
    }
    if (body.relevanceTags !== undefined) {
      updates.push(`relevance_tags = $${paramIdx}::text[]`);
      params.push(body.relevanceTags);
      paramIdx++;
    }
    updates.push('updated_at = NOW()');

    await this.prisma.$executeRawUnsafe(
      `UPDATE memory_records SET ${updates.join(', ')} WHERE memory_id = $1::uuid`,
      ...params,
    );

    return { data: { memoryId, updated: true } };
  }

  @Delete(':memoryId')
  async remove(@Param('memoryId') memoryId: string) {
    const existing = await this.prisma.$queryRawUnsafe<Array<{ memory_id: string }>>(
      `SELECT memory_id FROM memory_records WHERE memory_id = $1::uuid`,
      memoryId,
    );
    if (existing.length === 0) {
      throw new NotFoundException(`Memory record ${memoryId} not found`);
    }

    await this.prisma.$executeRawUnsafe(
      `DELETE FROM memory_records WHERE memory_id = $1::uuid`,
      memoryId,
    );

    return { data: { memoryId, deleted: true } };
  }
}
