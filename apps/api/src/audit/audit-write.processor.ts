import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { Prisma } from '@prisma/client';
import { AuditRepository } from './audit.repository';

interface AuditWriteJobData {
  runId: string;
  harnessId: string | null;
  phase: string | null;
  eventType: string;
  actor: Prisma.InputJsonValue;
  payload: Prisma.InputJsonValue;
}

@Processor('audit-write')
export class AuditWriteProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditWriteProcessor.name);

  constructor(private readonly auditRepository: AuditRepository) {
    super();
  }

  async process(job: Job<AuditWriteJobData>): Promise<void> {
    await this.auditRepository.create({
      runId: job.data.runId,
      harnessId: job.data.harnessId,
      phase: job.data.phase,
      eventType: job.data.eventType,
      actor: job.data.actor,
      payload: job.data.payload,
    });
    this.logger.debug(`Persisted non-critical audit event: ${job.data.eventType}`);
  }
}
