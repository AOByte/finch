import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { WorkflowClient } from '@temporalio/client';
import { v4 as uuidv4 } from 'uuid';
import { RunRepository } from '../persistence/run.repository';
import { HarnessRepository } from '../persistence/harness.repository';
import { WebhookConnectorService } from '../connectors/webhook-connector.service';
import type { RawTriggerInput } from '../workflow/types';
import type { Request } from 'express';

@Controller('api/trigger')
export class TriggerController {
  constructor(
    private readonly runRepository: RunRepository,
    private readonly harnessRepository: HarnessRepository,
    private readonly workflowClient: WorkflowClient,
    private readonly webhookConnector: WebhookConnectorService,
  ) {}

  @Post(':harnessId')
  @HttpCode(HttpStatus.CREATED)
  async trigger(
    @Param('harnessId') harnessIdOrName: string,
    @Headers('x-finch-signature') signature: string | undefined,
    @Req() req: Request,
    @Body() body: { rawText: string; harnessId?: string; runId?: string },
  ) {
    // Validate HMAC-SHA256 signature (PRD TR-03)
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    this.webhookConnector.validateSignature(rawBody, signature);
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
