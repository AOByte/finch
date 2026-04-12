import { Injectable } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';

export interface GateFrequencyByPhase {
  phase: string;
  count: number;
}

export interface GateFrequencyTrend {
  date: string;
  count: number;
}

export interface AvgGateResolutionTime {
  phase: string;
  avgMs: number;
}

export interface CompletionRate {
  total: number;
  completed: number;
  failed: number;
  stopped: number;
  rate: number;
}

export interface LlmCostByAgent {
  agentId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getGateFrequencyByPhase(harnessId: string): Promise<GateFrequencyByPhase[]> {
    const results = await this.prisma.$queryRawUnsafe<
      Array<{ phase: string; count: bigint }>
    >(
      `SELECT phase, COUNT(*) as count
       FROM gate_events
       WHERE harness_id = $1::uuid
       GROUP BY phase
       ORDER BY count DESC`,
      harnessId,
    );
    return results.map((r) => ({ phase: r.phase, count: Number(r.count) }));
  }

  async getGateFrequencyTrend(harnessId: string): Promise<GateFrequencyTrend[]> {
    const results = await this.prisma.$queryRawUnsafe<
      Array<{ date: Date; count: bigint }>
    >(
      `SELECT DATE(fired_at) as date, COUNT(*) as count
       FROM gate_events
       WHERE harness_id = $1::uuid
       GROUP BY DATE(fired_at)
       ORDER BY date DESC
       LIMIT 30`,
      harnessId,
    );
    return results.map((r) => ({
      date: new Date(r.date).toISOString().split('T')[0],
      count: Number(r.count),
    }));
  }

  async getAvgGateResolutionTime(harnessId: string): Promise<AvgGateResolutionTime[]> {
    const results = await this.prisma.$queryRawUnsafe<
      Array<{ phase: string; avg_ms: number }>
    >(
      `SELECT phase,
              AVG(EXTRACT(EPOCH FROM (resolved_at - fired_at)) * 1000) as avg_ms
       FROM gate_events
       WHERE harness_id = $1::uuid
         AND resolved_at IS NOT NULL
       GROUP BY phase
       ORDER BY avg_ms DESC`,
      harnessId,
    );
    return results.map((r) => ({ phase: r.phase, avgMs: Number(r.avg_ms) }));
  }

  async getCompletionRate(harnessId: string): Promise<CompletionRate> {
    const results = await this.prisma.$queryRawUnsafe<
      Array<{ status: string; count: bigint }>
    >(
      `SELECT status, COUNT(*) as count
       FROM runs
       WHERE harness_id = $1::uuid
       GROUP BY status`,
      harnessId,
    );

    let total = 0;
    let completed = 0;
    let failed = 0;
    let stopped = 0;

    for (const r of results) {
      const count = Number(r.count);
      total += count;
      if (r.status === 'COMPLETED') completed = count;
      if (r.status === 'FAILED') failed = count;
      if (r.status === 'STOPPED') stopped = count;
    }

    return {
      total,
      completed,
      failed,
      stopped,
      rate: total > 0 ? completed / total : 0,
    };
  }

  async getLlmCostByAgent(harnessId: string): Promise<LlmCostByAgent[]> {
    const results = await this.prisma.$queryRawUnsafe<
      Array<{
        agent_id: string;
        total_input_tokens: bigint;
        total_output_tokens: bigint;
        call_count: bigint;
      }>
    >(
      `SELECT
         (payload->>'agentId')::text as agent_id,
         SUM((payload->'usage'->>'inputTokens')::int) as total_input_tokens,
         SUM((payload->'usage'->>'outputTokens')::int) as total_output_tokens,
         COUNT(*) as call_count
       FROM audit_events
       WHERE harness_id = $1::uuid
         AND event_type = 'llm_call'
         AND payload->>'agentId' IS NOT NULL
       GROUP BY payload->>'agentId'
       ORDER BY total_input_tokens DESC`,
      harnessId,
    );
    return results.map((r) => ({
      agentId: r.agent_id,
      totalInputTokens: Number(r.total_input_tokens ?? 0),
      totalOutputTokens: Number(r.total_output_tokens ?? 0),
      callCount: Number(r.call_count),
    }));
  }
}
