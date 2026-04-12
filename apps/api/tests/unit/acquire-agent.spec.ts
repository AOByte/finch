import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AcquireAgentService } from '../../src/agents/acquire-agent.service';
import { GateEvent } from '../../src/agents/gate-event';
import { ParseOutputError } from '../../src/agents/errors';

describe('AcquireAgentService', () => {
  const mockAuditLogger = { log: vi.fn().mockResolvedValue(undefined) };
  const mockLLM = { complete: vi.fn(), providerId: 'anthropic' };
  const mockMemoryConnector = {
    query: vi.fn().mockResolvedValue([]),
    stageRecord: vi.fn(), mergeRecords: vi.fn(),
  };
  const mockDispatcher = {
    getAuditLogger: vi.fn().mockReturnValue(mockAuditLogger),
    getLLM: vi.fn().mockReturnValue(mockLLM),
    getLockedPreamble: vi.fn().mockReturnValue('locked preamble'),
    getMemoryConnector: vi.fn().mockReturnValue(mockMemoryConnector),
  };

  let service: AcquireAgentService;

  const makeContext = () => ({
    runId: 'r1', harnessId: 'h1', phase: 'ACQUIRE' as const,
    agentConfig: {
      agentId: 'acquire-default', position: 0, llmConnectorId: 'anthropic',
      llmProvider: 'anthropic', model: 'claude-sonnet-4-20250514', maxTokens: 4096,
      systemPromptBody: '', skills: [], rules: [],
    },
    source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
    pipelinePosition: 0,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AcquireAgentService(mockDispatcher as never);
  });

  it('buildLockedPreamble delegates to dispatcher', () => {
    expect(service.buildLockedPreamble()).toBe('locked preamble');
  });

  it('buildInitialMessage includes task details', () => {
    const msg = service.buildInitialMessage({
      runId: 'r1', harnessId: 'h1', normalizedPrompt: 'fix payments', intent: 'bug', scope: ['src'],
    });
    expect(msg).toContain('fix payments');
    expect(msg).toContain('bug');
  });

  it('buildToolSet returns fire_gate tool', () => {
    const tools = service.buildToolSet(makeContext() as never);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('fire_gate');
  });

  it('parseOutput parses valid JSON', () => {
    const result = service.parseOutput({
      text: JSON.stringify({ hasGap: false, files: ['a.ts'], dependencies: ['dep'] }),
      content: [], toolUses: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn',
    });
    expect(result.files).toEqual(['a.ts']);
  });

  it('parseOutput throws ParseOutputError on invalid JSON', () => {
    expect(() => service.parseOutput({
      text: 'not json', content: [], toolUses: [],
      usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn',
    })).toThrow(ParseOutputError);
  });

  it('parseFallback returns empty context object', () => {
    const result = service.parseFallback({
      text: 'not json', content: [], toolUses: [],
      usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn',
    });
    expect(result.hasGap).toBe(false);
    expect(result.files).toEqual([]);
    expect(result.dependencies).toEqual([]);
  });

  it('executeToolCall returns error', async () => {
    const result = await service.executeToolCall('anything', {}, makeContext() as never);
    expect(result).toEqual({ error: 'Unknown tool' });
  });

  it('runAcquire returns ContextObject on success', async () => {
    mockLLM.complete.mockResolvedValue({
      text: JSON.stringify({ hasGap: false, files: ['a.ts'], dependencies: [] }),
      content: [], toolUses: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn',
    });

    const input = { runId: 'r1', harnessId: 'h1', normalizedPrompt: 'fix', intent: 'bug', scope: [] };
    const result = await service.runAcquire(input, makeContext() as never);

    expect(result).not.toBeInstanceOf(GateEvent);
    expect((result as { runId: string }).runId).toBe('r1');
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'phase_started' }));
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'memory_read' }));
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'phase_completed' }));
    expect(mockMemoryConnector.query).toHaveBeenCalledWith({ harnessId: 'h1', query: 'fix' });
  });

  it('runAcquire logs memory hits with type and score when hits exist', async () => {
    mockMemoryConnector.query.mockResolvedValue([
      { memoryId: 'm1', type: 'TaskPattern', content: 'fix auth', relevanceTags: [], score: 0.85 },
      { memoryId: 'm2', type: 'ErrorPattern', content: 'timeout fix', relevanceTags: [], score: 0.72 },
    ]);
    mockLLM.complete.mockResolvedValue({
      text: JSON.stringify({ hasGap: false, files: ['b.ts'], dependencies: [] }),
      content: [], toolUses: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn',
    });

    const input = { runId: 'r1', harnessId: 'h1', normalizedPrompt: 'fix auth', intent: 'bug', scope: [] };
    await service.runAcquire(input, makeContext() as never);

    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'memory_read',
      payload: expect.objectContaining({
        hitCount: 2,
        hits: [
          { type: 'TaskPattern', score: 0.85 },
          { type: 'ErrorPattern', score: 0.72 },
        ],
      }),
    }));
  });

  it('runAcquire returns GateEvent when gate fired', async () => {
    mockLLM.complete.mockResolvedValue({
      text: '', content: [], stopReason: 'tool_use',
      toolUses: [{ id: 't1', name: 'fire_gate', input: { gapDescription: 'gap', question: 'q' } }],
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const input = { runId: 'r1', harnessId: 'h1', normalizedPrompt: 'vague', intent: 'unknown', scope: [] };
    const result = await service.runAcquire(input, makeContext() as never);
    expect(result).toBeInstanceOf(GateEvent);
  });
});
