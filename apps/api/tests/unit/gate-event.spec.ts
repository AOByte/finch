import { describe, it, expect } from 'vitest';
import { GateEvent } from '../../src/agents/gate-event';

describe('GateEvent', () => {
  it('creates with all fields', () => {
    const event = new GateEvent({
      phase: 'ACQUIRE',
      runId: 'run-1',
      harnessId: 'harness-1',
      gapDescription: 'Missing info',
      question: 'What is X?',
      source: { type: 'webhook', channelId: 'ch1', messageId: 'm1', threadTs: 't1', authorId: 'a1', timestamp: '2024-01-01' },
      agentId: 'agent-1',
      pipelinePosition: 0,
      temporalWorkflowId: 'wf-1',
    });

    expect(event.gateId).toBeDefined();
    expect(event.runId).toBe('run-1');
    expect(event.harnessId).toBe('harness-1');
    expect(event.phase).toBe('ACQUIRE');
    expect(event.gapDescription).toBe('Missing info');
    expect(event.question).toBe('What is X?');
    expect(event.agentId).toBe('agent-1');
    expect(event.pipelinePosition).toBe(0);
    expect(event.temporalWorkflowId).toBe('wf-1');
    expect(event.firedAt).toBeInstanceOf(Date);
    expect(event.timeoutMs).toBe(48 * 60 * 60 * 1000);
  });

  it('uses custom timeoutMs when provided', () => {
    const event = new GateEvent({
      phase: 'PLAN',
      runId: 'run-2',
      harnessId: 'harness-2',
      gapDescription: 'gap',
      question: 'q',
      source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
      agentId: 'agent-2',
      pipelinePosition: 1,
      timeoutMs: 5000,
    });

    expect(event.timeoutMs).toBe(5000);
    expect(event.temporalWorkflowId).toBeUndefined();
  });

  it('allows setting snapshot', () => {
    const event = new GateEvent({
      phase: 'EXECUTE',
      runId: 'r',
      harnessId: 'h',
      gapDescription: 'g',
      question: 'q',
      source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
      agentId: 'a',
      pipelinePosition: 0,
    });
    expect(event.snapshot).toBeUndefined();
    event.snapshot = { pipelinePosition: 0, artifactAtSuspension: {}, agentOutputsBeforeGate: [] };
    expect(event.snapshot.pipelinePosition).toBe(0);
  });
});
