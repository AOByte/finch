import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { RunRepository } from './run.repository';
import { GateRepository } from './gate.repository';
import { ArtifactRepository } from './artifact.repository';
import { HarnessRepository } from './harness.repository';

@Module({
  imports: [],
  providers: [
    PrismaService,
    RunRepository,
    GateRepository,
    ArtifactRepository,
    HarnessRepository,
  ],
  exports: [
    PrismaService,
    RunRepository,
    GateRepository,
    ArtifactRepository,
    HarnessRepository,
  ],
})
export class PersistenceModule {}
