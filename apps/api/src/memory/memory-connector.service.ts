import { Injectable, Logger } from '@nestjs/common';
import type { MemoryHit } from '@finch/types';

@Injectable()
export class MemoryConnectorService {
  private readonly logger = new Logger(MemoryConnectorService.name);

  async query(harnessId: string, queryText: string): Promise<MemoryHit[]> {
    this.logger.debug(`Memory query for harness=${harnessId}: "${queryText}" — returning empty (stub)`);
    // W3-17: Stub — returns empty results. Real implementation in Wave 4.
    return [];
  }

  async stageRecord(params: {
    runId: string;
    harnessId: string;
    type: string;
    content: string;
    relevanceTags: string[];
  }): Promise<void> {
    this.logger.debug(`Memory staging for run=${params.runId}: type=${params.type}`);
    // W3-17: Stub — no-op. Real implementation in Wave 4.
  }

  async mergeRecords(runId: string): Promise<void> {
    this.logger.debug(`Memory merge for run=${runId} — no-op (stub)`);
    // W3-17: Stub — no-op. Real implementation in Wave 4.
  }
}
