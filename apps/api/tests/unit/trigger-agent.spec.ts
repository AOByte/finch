import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TriggerAgentService } from '../../src/agents/trigger-agent.service';
import { GateEvent } from '../../src/agents/gate-event';
import { ParseOutputError } from '../../src/agents/errors';

describe('TriggerAgentService', () => {
  const mockAuditLogger = { log: vi.fn().mockResolvedValue(undefined) };
  const mockLLM = { complete: vi.fn(), providerId: 'anthropic' };
  const mockMemoryConnector = { query: vi.fn(), stageRecord: vi.fn(), mergeRecords: vi.fn() };
  const mockDispatcher = {
    getAuditLogger: vi.fn().mockReturnValue(mockAuditLogger),
    getLLM: vi.fn().mockReturnValue(mockLLM),
    getLockedPreamble: vi.fn().mockReturnValue('locked preamble'),
    getMemoryConnector: vi.fn().mockReturnValue(mockMemoryConnector),
  };

  let service: TriggerAgentService;

  const makeContext = () => ({
    runId: 'r1', harnessId: 'h1', phase: 'TRIGGER' as const,
    agentConfig: {
      agentId: 'trigger-default', position: 0, llmConnectorId: 'anthropic',
      llmProvider: 'anthropic', model: 'claude-sonnet-4-20250514', maxTokens: 4096,
      systemPromptBody: '', skills: [], rules: [],
    },
    source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
    pipelinePosition: 0,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TriggerAgentService(mockDispatcher as never);
  });

  it('buildLockedPreamble delegates to dispatcher', () => {
    expect(service.buildLockedPreamble()).toBe('locked preamble');
  });

  it('buildInitialMessage includes rawText', () => {
    const msg = service.buildInitialMessage({ rawText: 'fix payments', harnessId: 'h1', runId: 'r1', source: {} as never });
    expect(msg).toContain('fix payments');
  });

  it('buildToolSet returns empty array', () => {
    expect(service.buildToolSet(makeContext() as never)).toEqual([]);
  });

  it('parseOutput parses valid JSON', () => {
    const result = service.parseOutput({
      text: JSON.stringify({ runId: 'r1', harnessId: 'h1', normalizedPrompt: 'fix', intent: 'bug', scope: ['src'] }),
      content: [], toolUses: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn',
    });
    expect(result.normalizedPrompt).toBe('fix');
  });

  it('parseOutput throws ParseOutputError on invalid JSON', () => {
    expect(() => service.parseOutput({
      text: 'not json', content: [], toolUses: [],
      usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn',
    })).toThrow(ParseOutputError);
  });

  it('parseFallback returns basic descriptor from text', () => {
    const result = service.parseFallback({
      text: 'not json', content: [], toolUses: [],
      usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn',
    });
    expect(result.normalizedPrompt).toBe('not json');
    expect(result.intent).toBe('unknown');
    expect(result.scope).toEqual([]);
  });

  it('executeToolCall returns error for any tool', async () => {
    const result = await service.executeToolCall('anything', {}, makeContext() as never);
    expect(result).toEqual({ error: 'No tools available for trigger agent' });
  });

  it('runTrigger returns TaskDescriptor on success', async () => {
    mockLLM.complete.mockResolvedValue({
      text: JSON.stringify({ normalizedPrompt: 'fix payments', intent: 'bug', scope: ['src/payments'] }),
      content: [], toolUses: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn',
    });

    const input = { rawText: 'fix payments', harnessId: 'h1', runId: 'r1', source: {} as never };
    const result = await service.runTrigger(input, makeContext() as never);

    expect(result).not.toBeInstanceOf(GateEvent);
    expect((result as { runId: string }).runId).toBe('r1');
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'phase_started' }));
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'phase_completed' }));
  });

  it('runTrigger returns GateEvent if run() somehow returns one (defensive)', async () => {
    const gate = new GateEvent({
      phase: 'TRIGGER', runId: 'r1', harnessId: 'h1',
      gapDescription: 'gap', question: 'q',
      source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
      agentId: 'trigger-default', pipelinePosition: 0,
    });
    vi.spyOn(service, 'run').mockResolvedValue(gate);

    const input = { rawText: 'test', harnessId: 'h1', runId: 'r1', source: {} as never };
    const result = await service.runTrigger(input, makeContext() as never);
    expect(result).toBeInstanceOf(GateEvent);
  });

  it('runTrigger blocks fire_gate in TRIGGER phase (FC-01) and continues', async () => {
    // First call: fire_gate in TRIGGER → blocked by BaseAgent guard
    mockLLM.complete.mockResolvedValueOnce({
      text: '', content: [], stopReason: 'tool_use',
      toolUses: [{ id: 't1', name: 'fire_gate', input: { gapDescription: 'gap', question: 'q' } }],
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    // Second call: agent continues with end_turn after gate is blocked
    mockLLM.complete.mockResolvedValueOnce({
      text: JSON.stringify({ normalizedPrompt: 'vague task', intent: 'unknown', scope: [] }),
      content: [], toolUses: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn',
    });

    const input = { rawText: 'vague task', harnessId: 'h1', runId: 'r1', source: {} as never };
    const result = await service.runTrigger(input, makeContext() as never);
    // Gate is blocked — result is a TaskDescriptor, not a GateEvent
    expect(result).not.toBeInstanceOf(GateEvent);
    expect((result as { normalizedPrompt: string }).normalizedPrompt).toBe('vague task');
    // Verify agent_anomaly audit event was emitted
    expect(mockAuditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'agent_anomaly' }),
    );
  });
});
