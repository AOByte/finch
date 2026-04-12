// @finch/types — shared TypeScript types and artifact schemas
// Types will be added as implementation progresses through waves.

export type Phase = 'TRIGGER' | 'ACQUIRE' | 'PLAN' | 'EXECUTE' | 'SHIP';

export type RunStatus = 'RUNNING' | 'WAITING_FOR_HUMAN' | 'STALLED' | 'COMPLETED' | 'FAILED';

export type MemoryType =
  | 'TaskPattern'
  | 'FileConvention'
  | 'TeamConvention'
  | 'GatePattern'
  | 'RiskSignal'
  | 'RepoMap';

export type Enforcement = 'hard' | 'soft';

export type PatternType = 'path' | 'regex' | 'semantic';

// --- Wave 3 types ---

export type ConnectorCategory = 'trigger' | 'acquire' | 'execute' | 'ship';

export interface TriggerSource {
  type: string;
  channelId: string;
  messageId: string;
  threadTs: string;
  authorId: string;
  timestamp: string;
}

export interface LLMCompleteParams {
  messages: Message[];
  system?: string;
  tools?: Tool[];
  model: string;
  maxTokens: number;
}

export interface LLMResponse {
  text: string;
  content: LLMContentBlock[];
  toolUses: ToolUse[];
  usage: { inputTokens: number; outputTokens: number };
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
}

export interface LLMContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMConnector {
  readonly providerId: string;
  complete(params: LLMCompleteParams): Promise<LLMResponse>;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string | ToolResultMessage[];
}

export interface ToolResultMessage {
  type: 'tool_result';
  toolUseId: string;
  content: string;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentContext {
  runId: string;
  harnessId: string;
  phase: Phase;
  agentConfig: AgentStepConfig;
  source: TriggerSource;
  pipelinePosition: number;
  temporalWorkflowId?: string;
}

export interface AgentPipelineConfig {
  phase: Phase;
  harnessId: string;
  agents: AgentStepConfig[];
}

export interface AgentStepConfig {
  agentId: string;
  position: number;
  llmConnectorId: string;
  llmProvider: string;
  model: string;
  maxTokens: number;
  systemPromptBody: string;
  skills: SkillRef[];
  rules: RuleRef[];
}

export interface SkillRef {
  skillId: string;
  name: string;
  content: string;
  version: number;
}

export interface RuleRef {
  ruleId: string;
  name: string;
  constraint: string;
  enforcement: Enforcement;
  patternType: PatternType;
  patterns: string[];
}

export interface MemoryHit {
  memoryId: string;
  type: MemoryType;
  content: string;
  relevanceTags: string[];
  score: number;
}

export interface GateASnapshot {
  pipelinePosition: number;
  artifactAtSuspension: unknown;
  agentOutputsBeforeGate: { position: number; artifact: unknown }[];
}

export interface GatePSnapshot {
  pipelinePosition: number;
  artifactAtSuspension: unknown;
  agentOutputsBeforeGate: { position: number; artifact: unknown }[];
  contextObject: unknown;
}

export interface GateESnapshot {
  pipelinePosition: number;
  artifactAtSuspension: unknown;
  agentOutputsBeforeGate: { position: number; artifact: unknown }[];
  executionProgress: ExecutionProgress;
  planArtifact: unknown;
  contextObject: unknown;
}

export interface ExecutionProgress {
  completedSubTaskIds: string[];
  modifiedFiles: string[];
  verificationResultsSoFar: string[];
}

export type GateSnapshot = GateASnapshot | GatePSnapshot | GateESnapshot;

export interface RuleCheckResult {
  violated: boolean;
  rule?: RuleRef;
  gateQuestion?: string;
}

export interface TriggerConnector {
  sendMessage(params: {
    channelId: string;
    threadTs: string;
    message: string;
  }): Promise<void>;
}

export interface AuditEventData {
  runId: string;
  harnessId?: string;
  phase?: Phase | string;
  eventType: string;
  actor?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}
