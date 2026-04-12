import { Module } from '@nestjs/common';
import { AgentModule } from '../agents/agent.module';
import { MemoryModule } from '../memory/memory.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';

@Module({
  imports: [AgentModule, MemoryModule, OrchestratorModule],
  providers: [],
  exports: [],
})
export class WorkflowModule {}
