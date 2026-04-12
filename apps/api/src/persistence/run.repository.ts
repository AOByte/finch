import { Injectable } from '@nestjs/common';
import { Prisma, Run } from '@prisma/client';
import { PrismaService } from './prisma.service';

export interface PipelineState {
  pipelinePosition: number;
  pipelineArtifact: Prisma.JsonValue;
}

@Injectable()
export class RunRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.RunUncheckedCreateInput): Promise<Run> {
    return this.prisma.run.create({ data });
  }

  async findById(runId: string): Promise<Run | null> {
    return this.prisma.run.findUnique({ where: { runId } });
  }

  async findByHarnessId(
    harnessId: string,
    options?: { skip?: number; take?: number },
  ): Promise<Run[]> {
    return this.prisma.run.findMany({
      where: { harnessId },
      orderBy: { startedAt: 'desc' },
      skip: options?.skip,
      take: options?.take,
    });
  }

  async updateStatus(runId: string, status: string): Promise<Run> {
    return this.prisma.run.update({
      where: { runId },
      data: { status },
    });
  }

  async updatePhase(runId: string, currentPhase: string): Promise<Run> {
    return this.prisma.run.update({
      where: { runId },
      data: { currentPhase },
    });
  }

  async updatePipelinePosition(
    runId: string,
    phase: string,
    position: number,
    artifact: Prisma.InputJsonValue,
  ): Promise<Run> {
    return this.prisma.run.update({
      where: { runId },
      data: {
        currentPhase: phase,
        pipelinePosition: position,
        pipelineArtifact: artifact,
      },
    });
  }

  async getPipelineState(
    runId: string,
    _phase: string,
  ): Promise<PipelineState | null> {
    const run = await this.prisma.run.findUnique({
      where: { runId },
      select: { pipelinePosition: true, pipelineArtifact: true },
    });
    if (!run || run.pipelinePosition === null || run.pipelineArtifact === null) {
      return null;
    }
    return {
      pipelinePosition: run.pipelinePosition,
      pipelineArtifact: run.pipelineArtifact,
    };
  }

  async getPersistedPipelineArtifact(
    runId: string,
    _phase: string,
    position: number,
  ): Promise<Prisma.JsonValue | null> {
    const run = await this.prisma.run.findUnique({
      where: { runId },
      select: { pipelinePosition: true, pipelineArtifact: true },
    });
    if (
      !run ||
      run.pipelinePosition === null ||
      run.pipelineArtifact === null ||
      run.pipelinePosition !== position
    ) {
      return null;
    }
    return run.pipelineArtifact;
  }

  async markCompleted(runId: string): Promise<Run> {
    return this.prisma.run.update({
      where: { runId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });
  }
}
