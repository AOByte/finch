import { Injectable } from '@nestjs/common';
import { PhaseArtifact, Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class ArtifactRepository {
  constructor(private readonly prisma: PrismaService) {}

  async save(data: {
    runId: string;
    phase: string;
    artifactType: string;
    content: Prisma.InputJsonValue;
    version: number;
  }): Promise<PhaseArtifact> {
    return this.prisma.phaseArtifact.create({ data });
  }

  async findByRunIdAndPhase(
    runId: string,
    phase: string,
  ): Promise<PhaseArtifact | null> {
    return this.prisma.phaseArtifact.findFirst({
      where: { runId, phase },
      orderBy: { version: 'desc' },
    });
  }
}
