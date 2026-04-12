import { Injectable } from '@nestjs/common';
import { GateEvent, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class GateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.GateEventUncheckedCreateInput): Promise<GateEvent> {
    return this.prisma.gateEvent.create({ data });
  }

  async findById(gateId: string): Promise<GateEvent | null> {
    return this.prisma.gateEvent.findUnique({ where: { gateId } });
  }

  async findByRunId(runId: string): Promise<GateEvent[]> {
    return this.prisma.gateEvent.findMany({
      where: { runId },
      orderBy: { firedAt: 'asc' },
    });
  }

  async findOpenGateByThread(params: {
    channelId: string;
    threadTs: string;
  }): Promise<GateEvent | null> {
    const gates = await this.prisma.gateEvent.findMany({
      where: {
        resolvedAt: null,
        source: {
          path: ['channelId'],
          equals: params.channelId,
        },
      },
      orderBy: { firedAt: 'desc' },
    });

    return (
      gates.find((g) => {
        const source = g.source as Record<string, unknown>;
        return source['threadTs'] === params.threadTs;
      }) ?? null
    );
  }

  async saveResolution(
    gateId: string,
    resolution: Prisma.InputJsonValue,
  ): Promise<GateEvent> {
    return this.prisma.gateEvent.update({
      where: { gateId },
      data: {
        resolution,
        resolvedAt: new Date(),
      },
    });
  }

  async markResolved(gateId: string): Promise<GateEvent> {
    return this.prisma.gateEvent.update({
      where: { gateId },
      data: { resolvedAt: new Date() },
    });
  }
}
