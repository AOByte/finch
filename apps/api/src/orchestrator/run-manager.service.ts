import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { WorkflowClient } from '@temporalio/client';
import { RunRepository } from '../persistence/run.repository';
import { AuditLoggerService } from '../audit/audit-logger.service';

@Injectable()
export class RunManagerService {
  private readonly logger = new Logger(RunManagerService.name);

  constructor(
    private readonly runRepository: RunRepository,
    private readonly workflowClient: WorkflowClient,
    private readonly auditLogger: AuditLoggerService,
  ) {}

  async stopRun(runId: string): Promise<void> {
    const run = await this.runRepository.findById(runId);
    if (!run) {
      throw new NotFoundException(`Run ${runId} not found`);
    }

    if (run.status === 'COMPLETED' || run.status === 'FAILED' || run.status === 'STOPPED') {
      this.logger.warn(`Run ${runId} already in terminal state: ${run.status}`);
      return;
    }

    // Signal the Temporal workflow via stopRunSignal
    const handle = this.workflowClient.getHandle(run.temporalWorkflowId);
    await handle.signal('stop_run');

    // Mark the run as stopped
    await this.runRepository.updateStatus(runId, 'STOPPED');

    // Emit run_stopped audit event
    await this.auditLogger.log({
      runId,
      harnessId: run.harnessId,
      eventType: 'run_stopped',
      actor: { type: 'user' },
      payload: { previousStatus: run.status, previousPhase: run.currentPhase },
    });

    this.logger.log(`Run ${runId} stopped`);
  }
}
