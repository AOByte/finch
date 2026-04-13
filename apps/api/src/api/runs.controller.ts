import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  NotFoundException,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RunRepository } from '../persistence/run.repository';
import { RunManagerService } from '../orchestrator/run-manager.service';
import { AuditRepository } from '../audit/audit.repository';
import { GateRepository } from '../persistence/gate.repository';

@Controller('api/runs')
@UseGuards(JwtAuthGuard)
export class RunsController {
  constructor(
    private readonly runRepository: RunRepository,
    private readonly runManager: RunManagerService,
    private readonly auditRepository: AuditRepository,
    private readonly gateRepository: GateRepository,
  ) {}

  @Get()
  async listRuns(
    @Query('harnessId') harnessId?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!harnessId) {
      return { data: [], meta: { total: 0, hasMore: false } };
    }

    const take = limit ? parseInt(limit, 10) : 20;
    const skip = offset ? parseInt(offset, 10) : 0;

    const runs = await this.runRepository.findByHarnessId(harnessId, { skip, take });
    const filtered = status ? runs.filter((r) => r.status === status) : runs;

    return {
      data: filtered,
      meta: {
        total: filtered.length,
        hasMore: filtered.length === take,
      },
    };
  }

  @Get(':runId')
  async getRunById(@Param('runId') runId: string) {
    const run = await this.runRepository.findById(runId);
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }
    return { data: run };
  }

  @Get(':runId/audit')
  async getRunAudit(@Param('runId') runId: string) {
    const run = await this.runRepository.findById(runId);
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }
    const events = await this.auditRepository.findByRunId(runId);
    return { data: events };
  }

  @Get(':runId/gates')
  async getRunGates(@Param('runId') runId: string) {
    const run = await this.runRepository.findById(runId);
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }
    const gates = await this.gateRepository.findByRunId(runId);
    return { data: gates };
  }

  @Post(':runId/stop')
  @HttpCode(HttpStatus.OK)
  async stopRun(@Param('runId') runId: string) {
    await this.runManager.stopRun(runId);
    return { data: { runId, status: 'STOPPED' } };
  }
}
