import {
  Controller,
  Get,
  Param,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get(':harnessId')
  async getAnalytics(@Param('harnessId') harnessId: string) {
    const [
      gateFrequencyByPhase,
      gateFrequencyTrend,
      avgGateResolutionTime,
      completionRate,
      llmCostByAgent,
    ] = await Promise.all([
      this.analyticsService.getGateFrequencyByPhase(harnessId),
      this.analyticsService.getGateFrequencyTrend(harnessId),
      this.analyticsService.getAvgGateResolutionTime(harnessId),
      this.analyticsService.getCompletionRate(harnessId),
      this.analyticsService.getLlmCostByAgent(harnessId),
    ]);

    return {
      data: {
        gateFrequencyByPhase,
        gateFrequencyTrend,
        avgGateResolutionTime,
        completionRate,
        llmCostByAgent,
      },
    };
  }
}
