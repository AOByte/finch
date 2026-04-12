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
