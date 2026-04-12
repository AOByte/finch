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

export function createStubActivities(deps: {
  markRunCompletedInDb: (runId: string) => Promise<void>;
}): FinchActivities {
  return {
    async runTriggerPhase(rawInput: RawTriggerInput): Promise<TaskDescriptor> {
      return {
        runId: rawInput.runId,
        harnessId: rawInput.harnessId,
        normalizedPrompt: rawInput.rawText,
        intent: 'stub-intent',
        scope: ['stub-scope'],
      };
    },

    async runAcquirePhase(
      taskDescriptor: TaskDescriptor,
    ): Promise<ContextObject> {
      return {
        runId: taskDescriptor.runId,
        harnessId: taskDescriptor.harnessId,
        hasGap: false,
        files: [],
        dependencies: [],
      };
    },

    async resumeAcquirePhase(
      context: ContextObject,
      _resolution: GateResolution,
    ): Promise<ContextObject> {
      return { ...context, hasGap: false };
    },

    async runPlanPhase(_context: ContextObject): Promise<PlanArtifact> {
      return {
        runId: _context.runId,
        hasGap: false,
        steps: [{ description: 'stub-step' }],
      };
    },

    async resumePlanPhase(
      plan: PlanArtifact,
      _resolution: GateResolution,
    ): Promise<PlanArtifact> {
      return { ...plan, hasGap: false };
    },

    async runExecutePhase(
      _plan: PlanArtifact,
      _context: ContextObject,
    ): Promise<VerificationReport> {
      return {
        runId: _plan.runId,
        hasGap: false,
        allPassing: true,
        results: ['stub-result'],
      };
    },

    async resumeExecutePhase(
      report: VerificationReport,
      _resolution: GateResolution,
    ): Promise<VerificationReport> {
      return { ...report, hasGap: false };
    },

    async runShipPhase(
      _plan: PlanArtifact,
      _report: VerificationReport,
      _context: ContextObject,
      repoId: string,
    ): Promise<ShipResult> {
      return {
        repoId,
        prUrl: 'https://stub-pr-url',
        commitSha: 'stub-sha',
      };
    },

    async aggregateShipResults(
      runId: string,
      _results: ShipOutcome[],
    ): Promise<void> {
      await deps.markRunCompletedInDb(runId);
    },

    async getRegisteredRepos(
      _harnessId: string,
    ): Promise<RegisteredRepo[]> {
      return [{ repoId: 'stub-repo' }];
    },

    async mergeRunMemory(_runId: string): Promise<void> {
      // no-op stub
    },

    async markRunCompleted(runId: string): Promise<void> {
      await deps.markRunCompletedInDb(runId);
    },

    async logTraversalEvent(_event: TraversalEvent): Promise<void> {
      // no-op stub — real idempotent implementation in W3-20
    },
  };
}
