import {
  Controller,
  Get,
  Param,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';
import { HarnessRepository } from '../persistence/harness.repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('api/analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly harnessRepository: HarnessRepository,
  ) {}

  @Get(':harnessId')
  async getAnalytics(@Param('harnessId') harnessId: string) {
    // Resolve harness name to UUID when a non-UUID value is passed
    let resolvedId = harnessId;
    if (!UUID_RE.test(harnessId)) {
      const harness = await this.harnessRepository.findByName(harnessId);
      if (!harness) {
        return {
          data: {
            gateFrequencyByPhase: [],
            gateFrequencyTrend: [],
            avgGateResolutionTime: [],
            completionRate: { total: 0, completed: 0, failed: 0, stopped: 0, rate: 0 },
            llmCostByAgent: [],
          },
        };
      }
      resolvedId = harness.harnessId;
    }

    const [
      gateFrequencyByPhase,
      gateFrequencyTrend,
      avgGateResolutionTime,
      completionRate,
      llmCostByAgent,
    ] = await Promise.all([
      this.analyticsService.getGateFrequencyByPhase(resolvedId),
      this.analyticsService.getGateFrequencyTrend(resolvedId),
      this.analyticsService.getAvgGateResolutionTime(resolvedId),
      this.analyticsService.getCompletionRate(resolvedId),
      this.analyticsService.getLlmCostByAgent(resolvedId),
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
