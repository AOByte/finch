import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Worker, NativeConnection } from '@temporalio/worker';
import { createStubActivities } from './stub-activities';
import { RunRepository } from '../persistence/run.repository';

@Injectable()
export class TemporalWorkerService implements OnModuleInit {
  private readonly logger = new Logger(TemporalWorkerService.name);

  constructor(private readonly runRepository: RunRepository) {}

  /** Resolve path to the compiled workflow bundle entry point. */
  resolveWorkflowsPath(): string {
    return require.resolve('./finch.workflow');
  }

  async onModuleInit(): Promise<void> {
    const address =
      process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';

    const connection = await NativeConnection.connect({ address });

    const activities = createStubActivities({
      markRunCompletedInDb: async (runId: string) => {
        await this.runRepository.markCompleted(runId);
      },
    });

    const worker = await Worker.create({
      connection,
      workflowsPath: this.resolveWorkflowsPath(),
      activities,
      taskQueue: 'finch',
    });

    // Detached — does not block NestJS bootstrap
    worker.run().catch((err) => {
      this.logger.error(err, 'Temporal worker crashed');
      process.exit(1);
    });

    this.logger.log('Temporal worker started on task queue "finch"');
  }
}
