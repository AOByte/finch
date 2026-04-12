import { Injectable } from '@nestjs/common';
import { AuditEvent, Prisma } from '@prisma/client';
import { PrismaService } from '../persistence/prisma.service';

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.AuditEventUncheckedCreateInput): Promise<AuditEvent> {
    return this.prisma.auditEvent.create({ data });
  }

  async findByRunId(runId: string): Promise<AuditEvent[]> {
    return this.prisma.auditEvent.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByGateIdAndEventType(
    gateId: string,
    eventType: string,
  ): Promise<AuditEvent | null> {
    return this.prisma.auditEvent.findFirst({
      where: {
        eventType,
        payload: {
          path: ['gateId'],
          equals: gateId,
        },
      },
    });
  }
}
