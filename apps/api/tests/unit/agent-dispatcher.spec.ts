import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentDispatcherService } from '../../src/orchestrator/agent-dispatcher.service';
import { GateEvent } from '../../src/agents/gate-event';
import { ForcedGateError } from '../../src/agents/errors';

describe('AgentDispatcherService', () => {
  const mockRunRepository = {
    updatePipelinePosition: vi.fn().mockResolvedValue(undefined),
    getPersistedPipelineArtifact: vi.fn().mockResolvedValue(null),
  };
  const mockAgentConfigService = {
    getPipeline: vi.fn(),
  };
  const mockRuleEnforcement = {
    checkHardRules: vi.fn().mockResolvedValue({ violated: false }),
    checkSoftRules: vi.fn().mockResolvedValue({ deviations: [] }),
  };
  const mockAuditLogger = {
    log: vi.fn().mockResolvedValue(undefined),
  };
  const mockLLMRegistry = {
    get: vi.fn().mockReturnValue({ providerId: 'anthropic', complete: vi.fn() }),
  };
  const mockMemoryConnector = {
    query: vi.fn().mockResolvedValue([]),
    stageRecord: vi.fn().mockResolvedValue(undefined),
    mergeRecords: vi.fn().mockResolvedValue(undefined),
  };

  let service: AgentDispatcherService;

  const makeAgent = (id: string, pos: number) => ({
    agentId: id, position: pos, llmConnectorId: 'anthropic', llmProvider: 'anthropic',
    model: 'claude-sonnet-4-20250514', maxTokens: 4096, systemPromptBody: '', skills: [], rules: [],
  });
  const makeSource = () => ({
    type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set default implementations (clearAllMocks doesn't reset mockResolvedValue)
    mockRunRepository.updatePipelinePosition.mockResolvedValue(undefined);
    mockRunRepository.getPersistedPipelineArtifact.mockResolvedValue(null);
    mockRuleEnforcement.checkHardRules.mockResolvedValue({ violated: false });
    mockRuleEnforcement.checkSoftRules.mockResolvedValue({ deviations: [] });
    mockAuditLogger.log.mockResolvedValue(undefined);
    mockLLMRegistry.get.mockReturnValue({ providerId: 'anthropic', complete: vi.fn() });
    service = new AgentDispatcherService(
      mockRunRepository as never,
      mockAgentConfigService as never,
      mockRuleEnforcement as never,
      mockAuditLogger as never,
      mockLLMRegistry as never,
      mockMemoryConnector as never,
    );
  });

  it('getLockedPreamble returns the locked preamble string', () => {
    const preamble = service.getLockedPreamble();
    expect(preamble).toContain('TAPES framework agent');
    expect(preamble).toContain('fire_gate');
  });

  it('getLLM delegates to llmRegistry', () => {
    const llm = service.getLLM({ llmProvider: 'anthropic' } as never);
    expect(mockLLMRegistry.get).toHaveBeenCalledWith('anthropic');
    expect(llm).toBeDefined();
  });

  it('getLLM defaults to anthropic when llmProvider empty', () => {
    service.getLLM({ llmProvider: '' } as never);
    expect(mockLLMRegistry.get).toHaveBeenCalledWith('anthropic');
  });

  it('getMemoryConnector returns memoryConnector', () => {
    expect(service.getMemoryConnector()).toBe(mockMemoryConnector);
  });

  it('getAuditLogger returns auditLogger', () => {
    expect(service.getAuditLogger()).toBe(mockAuditLogger);
  });

  it('registerPhaseRunner stores and uses a runner', async () => {
    const runner = vi.fn().mockResolvedValue({ result: 'ok' });
    service.registerPhaseRunner('TRIGGER', runner);
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'TRIGGER', harnessId: 'h1', agents: [makeAgent('a1', 0)],
    });

    const result = await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'TRIGGER',
      input: { rawText: 'test' }, source: makeSource(),
    });
    expect(runner).toHaveBeenCalled();
    expect(result).toEqual({ result: 'ok' });
  });

  it('dispatchPhase returns input when no agents configured', async () => {
    mockAgentConfigService.getPipeline.mockResolvedValue({ phase: 'TRIGGER', harnessId: 'h1', agents: [] });
    const result = await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'TRIGGER', input: { rawText: 'test' }, source: makeSource(),
    });
    expect(result).toEqual({ rawText: 'test' });
  });

  it('dispatchPhase throws when no phase runner registered', async () => {
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'TRIGGER', harnessId: 'h1', agents: [makeAgent('a1', 0)],
    });
    await expect(service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'TRIGGER', input: {}, source: makeSource(),
    })).rejects.toThrow('No phase runner registered for phase: TRIGGER');
  });

  it('dispatchPhase returns GateEvent when hard rule violated', async () => {
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'ACQUIRE', harnessId: 'h1', agents: [makeAgent('a1', 0)],
    });
    mockRuleEnforcement.checkHardRules.mockResolvedValue({
      violated: true, rule: { constraint: 'no bad' }, gateQuestion: 'How to proceed?',
    });
    const result = await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE', input: {}, source: makeSource(),
    });
    expect(result).toBeInstanceOf(GateEvent);
  });

  it('dispatchPhase handles hard rule with null constraint', async () => {
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'ACQUIRE', harnessId: 'h1', agents: [makeAgent('a1', 0)],
    });
    mockRuleEnforcement.checkHardRules.mockResolvedValue({ violated: true, rule: null, gateQuestion: null });
    const result = await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE', input: {}, source: makeSource(),
    });
    expect(result).toBeInstanceOf(GateEvent);
    expect((result as GateEvent).gapDescription).toContain('unknown');
  });

  it('dispatchPhase returns GateEvent when agent fires gate', async () => {
    const gateEvent = new GateEvent({
      phase: 'ACQUIRE', runId: 'r1', harnessId: 'h1',
      gapDescription: 'missing', question: 'what?', source: makeSource() as never,
      agentId: 'a1', pipelinePosition: 0,
    });
    service.registerPhaseRunner('ACQUIRE', vi.fn().mockResolvedValue(gateEvent));
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'ACQUIRE', harnessId: 'h1', agents: [makeAgent('a1', 0)],
    });
    const result = await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE', input: {}, source: makeSource(),
    });
    expect(result).toBeInstanceOf(GateEvent);
    expect((result as GateEvent).snapshot).toBeDefined();
  });

  it('dispatchPhase logs soft rule deviations', async () => {
    service.registerPhaseRunner('PLAN', vi.fn().mockResolvedValue({ result: 'ok' }));
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'PLAN', harnessId: 'h1', agents: [makeAgent('a1', 0)],
    });
    mockRuleEnforcement.checkSoftRules.mockResolvedValue({
      deviations: [{ rule: { constraint: 'be nice' }, reason: 'was rude' }],
    });
    await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'PLAN', input: {}, source: makeSource(),
    });
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'rule_deviation' }));
  });

  it('dispatchPhase resumes from snapshot correctly', async () => {
    service.registerPhaseRunner('ACQUIRE', vi.fn().mockResolvedValue({ result: 'resumed' }));
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'ACQUIRE', harnessId: 'h1', agents: [makeAgent('a0', 0), makeAgent('a1', 1)],
    });
    const result = await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE', input: {}, source: makeSource(),
      resumeFromSnapshot: {
        pipelinePosition: 1, artifactAtSuspension: { prev: 'data' },
        agentOutputsBeforeGate: [{ position: 0, artifact: { output: 'from-agent-0' } }],
      },
    });
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'agent_skipped_on_resume' }));
    expect(result).toEqual({ result: 'resumed' });
  });

  it('dispatchPhase resumes from snapshot with empty outputs', async () => {
    service.registerPhaseRunner('ACQUIRE', vi.fn().mockResolvedValue({ result: 'resumed-empty' }));
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'ACQUIRE', harnessId: 'h1', agents: [makeAgent('a0', 0)],
    });
    await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE', input: { original: true }, source: makeSource(),
      resumeFromSnapshot: { pipelinePosition: 0, artifactAtSuspension: {}, agentOutputsBeforeGate: [] },
    });
  });

  it('buildSnapshot handles ACQUIRE phase', async () => {
    const ge = new GateEvent({
      phase: 'ACQUIRE', runId: 'r1', harnessId: 'h1', gapDescription: 'm', question: 'q',
      source: makeSource() as never, agentId: 'a1', pipelinePosition: 0,
    });
    service.registerPhaseRunner('ACQUIRE', vi.fn().mockResolvedValue(ge));
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'ACQUIRE', harnessId: 'h1', agents: [makeAgent('a1', 0)],
    });
    const result = await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE', input: {}, source: makeSource(),
    });
    expect((result as GateEvent).snapshot!.pipelinePosition).toBe(0);
  });

  it('buildSnapshot handles PLAN phase with contextObject', async () => {
    const ge = new GateEvent({
      phase: 'PLAN', runId: 'r1', harnessId: 'h1', gapDescription: 'm', question: 'q',
      source: makeSource() as never, agentId: 'a1', pipelinePosition: 0,
    });
    service.registerPhaseRunner('PLAN', vi.fn().mockResolvedValue(ge));
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'PLAN', harnessId: 'h1', agents: [makeAgent('a1', 0)],
    });
    const result = await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'PLAN', input: { context: 'data' }, source: makeSource(),
    });
    expect((result as GateEvent).snapshot).toBeDefined();
  });

  it('buildSnapshot handles EXECUTE phase with executionProgress', async () => {
    const ge = new GateEvent({
      phase: 'EXECUTE', runId: 'r1', harnessId: 'h1', gapDescription: 'm', question: 'q',
      source: makeSource() as never, agentId: 'a1', pipelinePosition: 0,
    });
    service.registerPhaseRunner('EXECUTE', vi.fn().mockResolvedValue(ge));
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'EXECUTE', harnessId: 'h1', agents: [makeAgent('a1', 0)],
    });
    const result = await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'EXECUTE', input: { plan: 'data' }, source: makeSource(),
    });
    expect((result as GateEvent).snapshot).toBeDefined();
  });

  it('dispatchPhase skips audit for positions beyond agents length on resume', async () => {
    // Cover line 96: i >= agents.length branch
    service.registerPhaseRunner('ACQUIRE', vi.fn().mockResolvedValue({ result: 'ok' }));
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'ACQUIRE', harnessId: 'h1', agents: [makeAgent('a0', 0)],
    });
    // startPosition=3 but only 1 agent in pipeline, so i=0 < agents.length=1 (true), i=1 >= 1 (false), i=2 >= 1 (false)
    await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE', input: {}, source: makeSource(),
      resumeFromSnapshot: {
        pipelinePosition: 3, artifactAtSuspension: {}, agentOutputsBeforeGate: [],
      },
    });
    // agent_skipped_on_resume logged once (for i=0 only, since agents.length=1)
    const skipCalls = mockAuditLogger.log.mock.calls.filter(
      (c: unknown[]) => (c[0] as Record<string, unknown>).eventType === 'agent_skipped_on_resume',
    );
    expect(skipCalls).toHaveLength(1);
  });

  it('dispatchPhase handles null currentArtifact via nullish coalescing', async () => {
    // Cover line 125: currentArtifact ?? {} branch
    service.registerPhaseRunner('TRIGGER', vi.fn().mockResolvedValue({ done: true }));
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'TRIGGER', harnessId: 'h1', agents: [makeAgent('a1', 0)],
    });
    const result = await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'TRIGGER', input: null, source: makeSource(),
    });
    expect(result).toEqual({ done: true });
    expect(mockRunRepository.updatePipelinePosition).toHaveBeenCalledWith('r1', 'TRIGGER', 0, {});
  });

  it('dispatchPhase throws ForcedGateError when agent returns GateEvent in TRIGGER phase', async () => {
    const gateEvent = new GateEvent({
      phase: 'TRIGGER', runId: 'r1', harnessId: 'h1',
      gapDescription: 'gap', question: 'q?', source: makeSource() as never,
      agentId: 'a1', pipelinePosition: 0,
    });
    service.registerPhaseRunner('TRIGGER', vi.fn().mockResolvedValue(gateEvent));
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'TRIGGER', harnessId: 'h1', agents: [makeAgent('a1', 0)],
    });
    await expect(service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'TRIGGER', input: {}, source: makeSource(),
    })).rejects.toThrow(ForcedGateError);
  });

  it('dispatchPhase throws ForcedGateError when agent returns GateEvent in SHIP phase', async () => {
    const gateEvent = new GateEvent({
      phase: 'SHIP', runId: 'r1', harnessId: 'h1',
      gapDescription: 'gap', question: 'q?', source: makeSource() as never,
      agentId: 'a1', pipelinePosition: 0,
    });
    service.registerPhaseRunner('SHIP', vi.fn().mockResolvedValue(gateEvent));
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'SHIP', harnessId: 'h1', agents: [makeAgent('a1', 0)],
    });
    await expect(service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'SHIP', input: {}, source: makeSource(),
    })).rejects.toThrow(ForcedGateError);
  });

  it('buildSnapshot includes persisted artifacts and skips nulls', async () => {
    // position=2 means buildSnapshot loops i=0,1
    // i=0 returns non-null, i=1 returns null → covers both branches of persisted !== null
    mockRunRepository.getPersistedPipelineArtifact
      .mockResolvedValueOnce({ data: 'artifact-0' })  // i=0: non-null → push (true branch)
      .mockResolvedValueOnce(null);                     // i=1: null → skip (false branch)

    const ge = new GateEvent({
      phase: 'ACQUIRE', runId: 'r1', harnessId: 'h1', gapDescription: 'm', question: 'q',
      source: makeSource() as never, agentId: 'a3', pipelinePosition: 2,
    });
    const runner = vi.fn()
      .mockResolvedValueOnce({ output: 'first' })
      .mockResolvedValueOnce({ output: 'second' })
      .mockResolvedValueOnce(ge);
    service.registerPhaseRunner('ACQUIRE', runner);
    mockAgentConfigService.getPipeline.mockResolvedValue({
      phase: 'ACQUIRE', harnessId: 'h1', agents: [makeAgent('a1', 0), makeAgent('a2', 1), makeAgent('a3', 2)],
    });
    const result = await service.dispatchPhase({
      runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE', input: {}, source: makeSource(),
    });
    expect(result).toBeInstanceOf(GateEvent);
    // Only the non-null artifact is included
    expect((result as GateEvent).snapshot!.agentOutputsBeforeGate).toHaveLength(1);
    expect((result as GateEvent).snapshot!.agentOutputsBeforeGate[0].artifact).toEqual({ data: 'artifact-0' });
  });
});
