import {
  Controller,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WorkflowClient } from '@temporalio/client';
import { GateControllerService } from '../orchestrator/gate-controller.service';
import { GateRepository } from '../persistence/gate.repository';

@Controller('api/gate')
export class GateController {
  constructor(
    private readonly gateControllerService: GateControllerService,
    private readonly gateRepository: GateRepository,
    private readonly workflowClient: WorkflowClient,
  ) {}

  @Post(':gateId/respond')
  @HttpCode(HttpStatus.OK)
  async respond(
    @Param('gateId') gateId: string,
    @Body() body: { answer: string },
  ) {
    const resolution = await this.gateControllerService.resolve(gateId, body.answer);

    // Signal the Temporal workflow to resume
    const gate = await this.gateRepository.findById(gateId);
    if (gate) {
      const run = await this.gateControllerService['runRepository'].findById(gate.runId);
      if (run?.temporalWorkflowId) {
        const handle = this.workflowClient.getHandle(run.temporalWorkflowId);
        await handle.signal('gateResolution', resolution);
      }
    }

    return { data: resolution };
  }
}
