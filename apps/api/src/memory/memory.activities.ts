import { Injectable, Logger } from '@nestjs/common';
import { MemoryConnectorService } from './memory-connector.service';
import { AuditLoggerService } from '../audit/audit-logger.service';

@Injectable()
export class MemoryActivities {
  private readonly logger = new Logger(MemoryActivities.name);

  constructor(
    private readonly memoryConnector: MemoryConnectorService,
    private readonly auditLogger: AuditLoggerService,
  ) {}

  /**
   * FF-07: mergeRecord() is ONLY called from this method.
   * Idempotent: if staging is already empty, returns cleanly.
   */
  async mergeRunMemory(runId: string): Promise<void> {
    const staging = await this.memoryConnector.getStagingRecords(runId);

    if (staging.length === 0) {
      this.logger.debug(`No staging records for run=${runId} — skipping merge`);
      return;
    }

    for (const record of staging) {
      await this.memoryConnector.mergeRecord(record);
    }

    // ME-03: Clear staging records after merge
    await this.memoryConnector.clearStaging(runId);

    // Emit memory_merged audit event
    await this.auditLogger.log({
      runId,
      eventType: 'memory_merged',
      actor: { type: 'orchestrator' },
      payload: { recordCount: staging.length },
    });

    this.logger.log(`Merged ${staging.length} memory records for run=${runId}`);
  }
}
