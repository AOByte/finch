import {
  Controller,
  Post,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { WorkflowClient } from '@temporalio/client';
import { v4 as uuidv4 } from 'uuid';
import { RunRepository } from '../persistence/run.repository';
import { HarnessRepository } from '../persistence/harness.repository';
import type { RawTriggerInput } from '../workflow/types';

@Controller('api/trigger')
export class TriggerController {
  constructor(
    private readonly runRepository: RunRepository,
    private readonly harnessRepository: HarnessRepository,
    private readonly workflowClient: WorkflowClient,
  ) {}

  @Post(':harnessId')
  @HttpCode(HttpStatus.CREATED)
  async trigger(
    @Param('harnessId') harnessIdOrName: string,
    @Body() body: { rawText: string; harnessId?: string; runId?: string },
  ) {
    // Resolve harness — accept either UUID or name
    let harnessId = harnessIdOrName;
    if (harnessIdOrName === 'default') {
      const harness = await this.harnessRepository.findByName('default');
      if (!harness) {
        throw new NotFoundException('Default harness not found');
      }
      harnessId = harness.harnessId;
    }

    const runId = body.runId ?? uuidv4();
    const temporalWorkflowId = `finch-${runId}`;

    // Create run record (Run model has no triggerSource field — source is in the workflow input)
    await this.runRepository.create({
      runId,
      harnessId,
      status: 'RUNNING',
      currentPhase: 'TRIGGER',
      temporalWorkflowId,
    });

    // Start Temporal workflow
    const rawInput: RawTriggerInput = {
      rawText: body.rawText,
      source: {
        type: 'webhook',
        channelId: 'webhook',
        messageId: runId,
        threadTs: runId,
        authorId: 'system',
        timestamp: new Date().toISOString(),
      },
      harnessId,
      runId,
    };

    await this.workflowClient.start('finchWorkflow', {
      workflowId: temporalWorkflowId,
      taskQueue: 'finch',
      args: [rawInput],
    });

    return {
      data: {
        runId,
        temporalWorkflowId,
        status: 'RUNNING',
      },
    };
  }
}
