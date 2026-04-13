import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsController } from '../../src/api/analytics.controller';
import { AnalyticsService } from '../../src/api/analytics.service';
import { HarnessRepository } from '../../src/persistence/harness.repository';

describe('AnalyticsController', () => {
  let controller: AnalyticsController;
  let analyticsService: {
    getGateFrequencyByPhase: ReturnType<typeof vi.fn>;
    getGateFrequencyTrend: ReturnType<typeof vi.fn>;
    getAvgGateResolutionTime: ReturnType<typeof vi.fn>;
    getCompletionRate: ReturnType<typeof vi.fn>;
    getLlmCostByAgent: ReturnType<typeof vi.fn>;
  };
  let harnessRepo: { findByName: ReturnType<typeof vi.fn> };
  const H1 = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    analyticsService = {
      getGateFrequencyByPhase: vi.fn().mockResolvedValue([{ phase: 'ACQUIRE', count: 5 }]),
      getGateFrequencyTrend: vi.fn().mockResolvedValue([{ date: '2026-04-01', count: 3 }]),
      getAvgGateResolutionTime: vi.fn().mockResolvedValue([{ phase: 'PLAN', avgMs: 1200 }]),
      getCompletionRate: vi.fn().mockResolvedValue({ total: 10, completed: 8, failed: 1, stopped: 1, rate: 0.8 }),
      getLlmCostByAgent: vi.fn().mockResolvedValue([{ agentId: 'acquire-default', totalInputTokens: 5000, totalOutputTokens: 1000, callCount: 10 }]),
    };
    harnessRepo = { findByName: vi.fn() };
    controller = new AnalyticsController(
      analyticsService as unknown as AnalyticsService,
      harnessRepo as unknown as HarnessRepository,
    );
  });

  it('getAnalytics returns { data } envelope with all 5 aggregation sections', async () => {
    const result = await controller.getAnalytics(H1);
    expect(result).toHaveProperty('data');
    expect(result.data).toHaveProperty('gateFrequencyByPhase');
    expect(result.data).toHaveProperty('gateFrequencyTrend');
    expect(result.data).toHaveProperty('avgGateResolutionTime');
    expect(result.data).toHaveProperty('completionRate');
    expect(result.data).toHaveProperty('llmCostByAgent');
  });

  it('getAnalytics calls all 5 aggregation methods', async () => {
    await controller.getAnalytics(H1);
    expect(analyticsService.getGateFrequencyByPhase).toHaveBeenCalledWith(H1);
    expect(analyticsService.getGateFrequencyTrend).toHaveBeenCalledWith(H1);
    expect(analyticsService.getAvgGateResolutionTime).toHaveBeenCalledWith(H1);
    expect(analyticsService.getCompletionRate).toHaveBeenCalledWith(H1);
    expect(analyticsService.getLlmCostByAgent).toHaveBeenCalledWith(H1);
  });
});
