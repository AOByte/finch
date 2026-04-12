export interface RawTriggerInput {
  rawText: string;
  source: {
    type: string;
    channelId: string;
    messageId: string;
    threadTs: string;
    authorId: string;
    timestamp: string;
  };
  harnessId: string;
  runId: string;
}

export interface TaskDescriptor {
  runId: string;
  harnessId: string;
  normalizedPrompt: string;
  intent: string;
  scope: string[];
}

export interface ContextObject {
  runId: string;
  harnessId: string;
  hasGap: boolean;
  gapDescription?: string;
  question?: string;
  gateId?: string;
  files: string[];
  dependencies: string[];
  repoMap?: Record<string, string[]>;
}

export interface PlanStep {
  description: string;
  repoId?: string;
}

export interface PlanArtifact {
  runId: string;
  hasGap: boolean;
  gapDescription?: string;
  question?: string;
  gateId?: string;
  steps: PlanStep[];
}

export interface VerificationReport {
  runId: string;
  hasGap: boolean;
  gapDescription?: string;
  question?: string;
  gateId?: string;
  allPassing: boolean;
  results: string[];
}

export interface ShipResult {
  repoId: string;
  prUrl?: string;
  commitSha?: string;
}

export interface ShipOutcome {
  repoId: string;
  status: 'success' | 'failed';
  result?: ShipResult;
  error?: string;
}

export interface GateResolution {
  gateId: string;
  requiresPhase: 'ACQUIRE' | 'PLAN' | 'EXECUTE';
  answer: string;
}

export interface TraversalEvent {
  runId: string;
  gateId: string;
  fromPhase: string;
  toPhase: string;
}

export interface RegisteredRepo {
  repoId: string;
}

export interface RunResult {
  status: string;
  phase?: string;
}

export interface FinchActivities {
  runTriggerPhase(rawInput: RawTriggerInput): Promise<TaskDescriptor>;
  runAcquirePhase(taskDescriptor: TaskDescriptor): Promise<ContextObject>;
  resumeAcquirePhase(context: ContextObject, resolution: GateResolution): Promise<ContextObject>;
  runPlanPhase(context: ContextObject): Promise<PlanArtifact>;
  resumePlanPhase(plan: PlanArtifact, resolution: GateResolution): Promise<PlanArtifact>;
  runExecutePhase(plan: PlanArtifact, context: ContextObject): Promise<VerificationReport>;
  resumeExecutePhase(report: VerificationReport, resolution: GateResolution): Promise<VerificationReport>;
  runShipPhase(plan: PlanArtifact, report: VerificationReport, context: ContextObject, repoId: string): Promise<ShipResult>;
  aggregateShipResults(runId: string, results: ShipOutcome[]): Promise<void>;
  getRegisteredRepos(harnessId: string): Promise<RegisteredRepo[]>;
  mergeRunMemory(runId: string): Promise<void>;
  markRunCompleted(runId: string): Promise<void>;
  logTraversalEvent(event: TraversalEvent): Promise<void>;
}
