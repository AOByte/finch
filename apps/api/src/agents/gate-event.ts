import { v4 as uuidv4 } from 'uuid';
import type { Phase, TriggerSource, GateSnapshot } from '@finch/types';

export class GateEvent {
  readonly gateId: string;
  readonly runId: string;
  readonly harnessId: string;
  readonly phase: Phase;
  readonly firedAt: Date;
  readonly gapDescription: string;
  readonly question: string;
  readonly source: TriggerSource;
  readonly agentId: string;
  readonly pipelinePosition: number;
  readonly temporalWorkflowId?: string;
  readonly timeoutMs: number;
  snapshot?: GateSnapshot;

  constructor(params: {
    phase: Phase;
    runId: string;
    harnessId: string;
    gapDescription: string;
    question: string;
    source: TriggerSource;
    agentId: string;
    pipelinePosition: number;
    temporalWorkflowId?: string;
    timeoutMs?: number;
  }) {
    this.gateId = uuidv4();
    this.runId = params.runId;
    this.harnessId = params.harnessId;
    this.phase = params.phase;
    this.firedAt = new Date();
    this.gapDescription = params.gapDescription;
    this.question = params.question;
    this.source = params.source;
    this.agentId = params.agentId;
    this.pipelinePosition = params.pipelinePosition;
    this.temporalWorkflowId = params.temporalWorkflowId;
    this.timeoutMs = params.timeoutMs ?? 48 * 60 * 60 * 1000;
  }
}
