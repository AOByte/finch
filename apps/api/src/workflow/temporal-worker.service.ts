import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Worker, NativeConnection } from '@temporalio/worker';
import { RunRepository } from '../persistence/run.repository';
import { AuditRepository } from '../audit/audit.repository';
import { AuditLoggerService } from '../audit/audit-logger.service';
import { HarnessRepository } from '../persistence/harness.repository';
import { GateControllerService } from '../orchestrator/gate-controller.service';
import { AgentDispatcherService } from '../orchestrator/agent-dispatcher.service';
import { MemoryConnectorService } from '../memory/memory-connector.service';
import { TriggerAgentService } from '../agents/trigger-agent.service';
import { AcquireAgentService } from '../agents/acquire-agent.service';
import { PlanAgentService } from '../agents/plan-agent.service';
import { ExecuteAgentService } from '../agents/execute-agent.service';
import { ShipAgentService } from '../agents/ship-agent.service';
import { GateEvent } from '../agents/gate-event';
import type {
  FinchActivities,
  RawTriggerInput,
  TaskDescriptor,
  ContextObject,
  PlanArtifact,
  VerificationReport,
  ShipResult,
  ShipOutcome,
  GateResolution,
  TraversalEvent,
  RegisteredRepo,
} from './types';
import type { AgentContext, TriggerSource } from '@finch/types';

@Injectable()
export class TemporalWorkerService implements OnModuleInit {
  private readonly logger = new Logger(TemporalWorkerService.name);

  constructor(
    private readonly runRepository: RunRepository,
    private readonly auditRepository: AuditRepository,
    private readonly auditLogger: AuditLoggerService,
    private readonly harnessRepository: HarnessRepository,
    private readonly gateController: GateControllerService,
    private readonly agentDispatcher: AgentDispatcherService,
    private readonly memoryConnector: MemoryConnectorService,
    private readonly triggerAgent: TriggerAgentService,
    private readonly acquireAgent: AcquireAgentService,
    private readonly planAgent: PlanAgentService,
    private readonly executeAgent: ExecuteAgentService,
    private readonly shipAgent: ShipAgentService,
  ) {}

  /** Resolve path to the compiled workflow bundle entry point. */
  resolveWorkflowsPath(): string {
    return require.resolve('./finch.workflow');
  }

  private buildDefaultSource(runId: string): TriggerSource {
    return {
      type: 'webhook',
      channelId: 'webhook',
      messageId: runId,
      threadTs: runId,
      authorId: 'system',
      timestamp: new Date().toISOString(),
    };
  }

  private buildAgentContext(
    runId: string,
    harnessId: string,
    phase: 'TRIGGER' | 'ACQUIRE' | 'PLAN' | 'EXECUTE' | 'SHIP',
    source: TriggerSource,
  ): AgentContext {
    return {
      runId,
      harnessId,
      phase,
      agentConfig: {
        agentId: `${phase.toLowerCase()}-default`,
        position: 0,
        llmConnectorId: 'anthropic',
        llmProvider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4096,
        systemPromptBody: '',
        skills: [],
        rules: [],
      },
      source,
      pipelinePosition: 0,
    };
  }

  private createActivities(): FinchActivities {
    return {
      runTriggerPhase: async (rawInput: RawTriggerInput): Promise<TaskDescriptor> => {
        const source = rawInput.source as TriggerSource;
        const context = this.buildAgentContext(rawInput.runId, rawInput.harnessId, 'TRIGGER', source);
        const result = await this.triggerAgent.runTrigger(rawInput, context);
        if (result instanceof GateEvent) {
          // Trigger agent shouldn't fire gates, but handle gracefully
          return {
            runId: rawInput.runId,
            harnessId: rawInput.harnessId,
            normalizedPrompt: rawInput.rawText,
            intent: 'unknown',
            scope: [],
          };
        }
        return result;
      },

      runAcquirePhase: async (taskDescriptor: TaskDescriptor): Promise<ContextObject> => {
        const source = this.buildDefaultSource(taskDescriptor.runId);
        const context = this.buildAgentContext(taskDescriptor.runId, taskDescriptor.harnessId, 'ACQUIRE', source);
        const result = await this.acquireAgent.runAcquire(taskDescriptor, context);
        if (result instanceof GateEvent) {
          await this.gateController.dispatch(result);
          return {
            runId: taskDescriptor.runId,
            harnessId: taskDescriptor.harnessId,
            hasGap: true,
            gapDescription: result.gapDescription,
            question: result.question,
            gateId: result.gateId,
            files: [],
            dependencies: [],
          };
        }
        return result;
      },

      resumeAcquirePhase: async (
        context: ContextObject,
        resolution: GateResolution,
      ): Promise<ContextObject> => {
        return {
          ...context,
          hasGap: false,
          gapDescription: undefined,
          question: undefined,
          gateId: undefined,
          dependencies: [...context.dependencies, `[Gate Answer]: ${resolution.answer}`],
        };
      },

      runPlanPhase: async (_context: ContextObject): Promise<PlanArtifact> => {
        const source = this.buildDefaultSource(_context.runId);
        const agentContext = this.buildAgentContext(_context.runId, _context.harnessId, 'PLAN', source);
        const result = await this.planAgent.runPlan(_context, agentContext);
        if (result instanceof GateEvent) {
          await this.gateController.dispatch(result);
          return {
            runId: _context.runId,
            hasGap: true,
            gapDescription: result.gapDescription,
            question: result.question,
            gateId: result.gateId,
            steps: [],
          };
        }
        return result;
      },

      resumePlanPhase: async (
        plan: PlanArtifact,
        resolution: GateResolution,
      ): Promise<PlanArtifact> => {
        return {
          ...plan,
          hasGap: false,
          gapDescription: undefined,
          question: undefined,
          gateId: undefined,
          steps: [...plan.steps, `[Gate Answer]: ${resolution.answer}`],
        };
      },

      runExecutePhase: async (
        _plan: PlanArtifact,
        _context: ContextObject,
      ): Promise<VerificationReport> => {
        const source = this.buildDefaultSource(_plan.runId);
        const agentContext = this.buildAgentContext(_plan.runId, _context.harnessId, 'EXECUTE', source);
        const result = await this.executeAgent.runExecute(_plan, _context, agentContext);
        if (result instanceof GateEvent) {
          await this.gateController.dispatch(result);
          return {
            runId: _plan.runId,
            hasGap: true,
            gapDescription: result.gapDescription,
            question: result.question,
            gateId: result.gateId,
            allPassing: false,
            results: [],
          };
        }
        return result;
      },

      resumeExecutePhase: async (
        report: VerificationReport,
        resolution: GateResolution,
      ): Promise<VerificationReport> => {
        return {
          ...report,
          hasGap: false,
          gapDescription: undefined,
          question: undefined,
          gateId: undefined,
          results: [...report.results, `[Gate Answer]: ${resolution.answer}`],
        };
      },

      runShipPhase: async (
        _plan: PlanArtifact,
        _report: VerificationReport,
        _context: ContextObject,
        repoId: string,
      ): Promise<ShipResult> => {
        const source = this.buildDefaultSource(_plan.runId);
        const agentContext = this.buildAgentContext(_plan.runId, _context.harnessId, 'SHIP', source);
        const result = await this.shipAgent.runShip(_plan, _report, _context, repoId, agentContext);
        if (result instanceof GateEvent) {
          throw new Error('ShipAgent returned GateEvent — this violates FF-06');
        }
        return result;
      },

      aggregateShipResults: async (
        runId: string,
        _results: ShipOutcome[],
      ): Promise<void> => {
        await this.runRepository.markCompleted(runId);
      },

      getRegisteredRepos: async (
        _harnessId: string,
      ): Promise<RegisteredRepo[]> => {
        return [{ repoId: 'default-repo' }];
      },

      mergeRunMemory: async (runId: string): Promise<void> => {
        await this.memoryConnector.mergeRecords(runId);
      },

      markRunCompleted: async (runId: string): Promise<void> => {
        await this.runRepository.markCompleted(runId);
      },

      logTraversalEvent: async (event: TraversalEvent): Promise<void> => {
        // Idempotent: check if already logged
        const existing = await this.auditRepository.findByGateIdAndEventType(
          event.gateId,
          'gate_traversal_backward',
        );
        if (existing) {
          return; // Already logged — deduplicate
        }
        await this.auditLogger.log({
          runId: event.runId,
          eventType: 'gate_traversal_backward',
          payload: {
            gateId: event.gateId,
            fromPhase: event.fromPhase,
            toPhase: event.toPhase,
          },
        });
      },
    };
  }

  async onModuleInit(): Promise<void> {
    const address =
      process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';

    const connection = await NativeConnection.connect({ address });

    const activities = this.createActivities();

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
