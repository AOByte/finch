import { Module } from '@nestjs/common';
import { WorkflowClient, Connection } from '@temporalio/client';
import { PersistenceModule } from '../persistence/persistence.module';
import { AuditModule } from '../audit/audit.module';
import { OrchestratorModule } from '../orchestrator/orchestrator.module';
import { MemoryModule } from '../memory/memory.module';
import { AgentModule } from '../agents/agent.module';
import { TemporalWorkerService } from './temporal-worker.service';

@Module({
  imports: [PersistenceModule, AuditModule, OrchestratorModule, MemoryModule, AgentModule],
  providers: [
    TemporalWorkerService,
    {
      provide: WorkflowClient,
      useFactory: async () => {
        const address =
          process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
        const connection = await Connection.connect({ address });
        return new WorkflowClient({ connection });
      },
    },
  ],
  exports: [WorkflowClient, TemporalWorkerService],
})
export class WorkflowModule {}
