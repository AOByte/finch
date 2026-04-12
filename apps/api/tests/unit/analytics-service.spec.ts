import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsService } from '../../src/api/analytics.service';
import { PrismaService } from '../../src/persistence/prisma.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let prisma: { $queryRawUnsafe: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    prisma = { $queryRawUnsafe: vi.fn() };
    service = new AnalyticsService(prisma as unknown as PrismaService);
  });

  it('getGateFrequencyByPhase returns phase/count pairs', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { phase: 'ACQUIRE', count: 5n },
      { phase: 'PLAN', count: 3n },
    ]);
    const result = await service.getGateFrequencyByPhase('h1');
    expect(result).toEqual([
      { phase: 'ACQUIRE', count: 5 },
      { phase: 'PLAN', count: 3 },
    ]);
  });

  it('getGateFrequencyTrend returns date/count pairs', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { date: new Date('2026-04-01'), count: 3n },
    ]);
    const result = await service.getGateFrequencyTrend('h1');
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveProperty('date');
    expect(result[0]).toHaveProperty('count', 3);
  });

  it('getAvgGateResolutionTime returns phase/avgMs pairs', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { phase: 'PLAN', avg_ms: 1200.5 },
    ]);
    const result = await service.getAvgGateResolutionTime('h1');
    expect(result).toEqual([{ phase: 'PLAN', avgMs: 1200.5 }]);
  });

  it('getCompletionRate returns rate object', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { status: 'COMPLETED', count: 8n },
      { status: 'FAILED', count: 1n },
      { status: 'RUNNING', count: 1n },
    ]);
    const result = await service.getCompletionRate('h1');
    expect(result.total).toBe(10);
    expect(result.completed).toBe(8);
    expect(result.failed).toBe(1);
    expect(result.rate).toBe(0.8);
  });

  it('getCompletionRate returns zero rate when no runs', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([]);
    const result = await service.getCompletionRate('h1');
    expect(result.total).toBe(0);
    expect(result.rate).toBe(0);
  });

  it('getCompletionRate includes stopped runs', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      { status: 'COMPLETED', count: 5n },
      { status: 'FAILED', count: 2n },
      { status: 'STOPPED', count: 3n },
    ]);
    const result = await service.getCompletionRate('h1');
    expect(result.total).toBe(10);
    expect(result.completed).toBe(5);
    expect(result.failed).toBe(2);
    expect(result.stopped).toBe(3);
    expect(result.rate).toBe(0.5);
  });

  it('getLlmCostByAgent returns agent cost breakdown', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      {
        agent_id: 'acquire-default',
        total_input_tokens: 5000n,
        total_output_tokens: 1000n,
        call_count: 10n,
      },
    ]);
    const result = await service.getLlmCostByAgent('h1');
    expect(result).toEqual([
      {
        agentId: 'acquire-default',
        totalInputTokens: 5000,
        totalOutputTokens: 1000,
        callCount: 10,
      },
    ]);
  });

  it('getLlmCostByAgent handles null token values', async () => {
    prisma.$queryRawUnsafe.mockResolvedValue([
      {
        agent_id: 'plan-default',
        total_input_tokens: null,
        total_output_tokens: null,
        call_count: 1n,
      },
    ]);
    const result = await service.getLlmCostByAgent('h1');
    expect(result).toEqual([
      {
        agentId: 'plan-default',
        totalInputTokens: 0,
        totalOutputTokens: 0,
        callCount: 1,
      },
    ]);
  });
});
