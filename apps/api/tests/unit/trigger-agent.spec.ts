import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TriggerAgentService } from '../../src/agents/trigger-agent.service';
import { GateEvent } from '../../src/agents/gate-event';

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

  it('parseOutput handles invalid JSON', () => {
    const result = service.parseOutput({
      text: 'not json', content: [], toolUses: [],
      usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn',
    });
    expect(result.normalizedPrompt).toBe('not json');
    expect(result.intent).toBe('unknown');
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
