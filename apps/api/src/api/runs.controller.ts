import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { RunRepository } from '../persistence/run.repository';

@Controller('api/runs')
export class RunsController {
  constructor(private readonly runRepository: RunRepository) {}

  @Get(':runId')
  async getRunById(@Param('runId') runId: string) {
    const run = await this.runRepository.findById(runId);
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }
    return run;
  }
}
