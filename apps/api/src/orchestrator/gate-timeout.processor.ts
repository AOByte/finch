import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GateRepository } from '../persistence/gate.repository';
import { RunRepository } from '../persistence/run.repository';
import { ConnectorRegistryService } from '../connectors/connector-registry.service';
import { AuditLoggerService } from '../audit/audit-logger.service';

@Injectable()
@Processor('gate-timeout')
export class GateTimeoutProcessor extends WorkerHost {
  private readonly logger = new Logger(GateTimeoutProcessor.name);

  constructor(
    private readonly gateRepository: GateRepository,
    private readonly runRepository: RunRepository,
    private readonly connectorRegistry: ConnectorRegistryService,
    private readonly auditLogger: AuditLoggerService,
    @InjectQueue('gate-timeout') private readonly gateTimeoutQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<{ gateId: string; runId: string }>): Promise<void> {
    const { gateId, runId } = job.data;

    // Idempotency check — return early if already resolved
    const gate = await this.gateRepository.findById(gateId);
    if (!gate) {
      this.logger.warn(`Gate ${gateId} not found — skipping timeout`);
      return;
    }

    if (gate.resolvedAt) {
      this.logger.debug(`Gate ${gateId} already resolved — skipping timeout`);
      return;
    }

    // Set run to STALLED
    await this.runRepository.updateStatus(runId, 'STALLED');

    // Re-send gate question to trigger channel
    const triggerConnector = this.connectorRegistry.getDefaultTriggerConnector();
    if (triggerConnector) {
      const source = gate.source as { channelId?: string; threadTs?: string } | null;
      await triggerConnector.sendMessage({
        channelId: source?.channelId ?? '',
        threadTs: source?.threadTs ?? '',
        message: `*Reminder — Finch is waiting for your response* (Run: \`${runId}\`)\n\n${gate.question}`,
      });
    }

    // Schedule 24-hour retry job
    await this.gateTimeoutQueue.add(
      'gate-timeout',
      { gateId, runId },
      { delay: 24 * 60 * 60 * 1000, jobId: `gate-timeout:${gateId}:retry` },
    );

    // Audit gate_stalled
    await this.auditLogger.log({
      runId,
      harnessId: gate.harnessId,
      eventType: 'gate_stalled',
      payload: { gateId },
    });

    this.logger.log(`Gate ${gateId} timed out — run ${runId} set to STALLED`);
  }
}
