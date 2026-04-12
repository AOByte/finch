import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Prisma } from '@prisma/client';
import { AuditRepository } from './audit.repository';
import { isCriticalEvent } from './audit-event-types';
import type { AuditEventData } from '@finch/types';

@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger(AuditLoggerService.name);

  constructor(
    private readonly auditRepository: AuditRepository,
    @InjectQueue('audit-write') private readonly auditQueue: Queue,
  ) {}

  async log(event: AuditEventData): Promise<void> {
    const data = {
      runId: event.runId,
      harnessId: event.harnessId ?? null,
      phase: event.phase ?? null,
      eventType: event.eventType,
      actor: (event.actor ?? {}) as Prisma.InputJsonValue,
      payload: (event.payload ?? {}) as Prisma.InputJsonValue,
    };

    if (isCriticalEvent(event.eventType)) {
      await this.auditRepository.create(data);
      this.logger.debug(`Critical audit event written: ${event.eventType}`);
    } else {
      await this.auditQueue.add('audit-write', data);
      this.logger.debug(`Non-critical audit event enqueued: ${event.eventType}`);
    }
  }
}
