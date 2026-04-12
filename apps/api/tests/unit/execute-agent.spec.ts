import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecuteAgentService } from '../../src/agents/execute-agent.service';
import { GateEvent } from '../../src/agents/gate-event';

describe('ExecuteAgentService', () => {
  const mockAuditLogger = { log: vi.fn().mockResolvedValue(undefined) };
  const mockLLM = { complete: vi.fn(), providerId: 'anthropic' };
  const mockDispatcher = {
    getAuditLogger: vi.fn().mockReturnValue(mockAuditLogger),
    getLLM: vi.fn().mockReturnValue(mockLLM),
    getLockedPreamble: vi.fn().mockReturnValue('locked preamble'),
    getMemoryConnector: vi.fn(),
  };

  let service: ExecuteAgentService;

  const makeContext = () => ({
    runId: 'r1', harnessId: 'h1', phase: 'EXECUTE' as const,
    agentConfig: {
      agentId: 'execute-default', position: 0, llmConnectorId: 'anthropic',
      llmProvider: 'anthropic', model: 'claude-sonnet-4-20250514', maxTokens: 4096,
      systemPromptBody: '', skills: [], rules: [],
    },
    source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
    pipelinePosition: 0,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ExecuteAgentService(mockDispatcher as never);
  });

  it('buildLockedPreamble delegates to dispatcher', () => {
    expect(service.buildLockedPreamble()).toBe('locked preamble');
  });

  it('buildInitialMessage includes plan steps and files', () => {
    const msg = service.buildInitialMessage({
      plan: { runId: 'r1', hasGap: false, steps: ['step1', 'step2'] },
      context: { runId: 'r1', harnessId: 'h1', hasGap: false, files: ['a.ts', 'b.ts'], dependencies: [] },
    });
    expect(msg).toContain('step1');
    expect(msg).toContain('a.ts');
  });

  it('buildToolSet returns fire_gate tool', () => {
    const tools = service.buildToolSet(makeContext() as never);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('fire_gate');
  });

  it('parseOutput parses valid JSON', () => {
    const result = service.parseOutput({
      text: JSON.stringify({ runId: 'r1', hasGap: false, allPassing: true, results: ['ok'] }),
      content: [], toolUses: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn',
    });
    expect(result.allPassing).toBe(true);
    expect(result.results).toEqual(['ok']);
  });

  it('parseOutput handles invalid JSON', () => {
    const result = service.parseOutput({
      text: 'plain text', content: [], toolUses: [],
      usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn',
    });
    expect(result.allPassing).toBe(true);
    expect(result.results).toEqual(['plain text']);
  });

  it('executeToolCall returns error', async () => {
    const result = await service.executeToolCall('anything', {}, makeContext() as never);
    expect(result).toEqual({ error: 'Unknown tool' });
  });

  it('runExecute returns VerificationReport on success', async () => {
    mockLLM.complete.mockResolvedValue({
      text: JSON.stringify({ allPassing: true, results: ['pass'] }),
      content: [], toolUses: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn',
    });

    const plan = { runId: 'r1', hasGap: false, steps: ['step1'] };
    const context = { runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [] };
    const result = await service.runExecute(plan, context, makeContext() as never);

    expect(result).not.toBeInstanceOf(GateEvent);
    expect((result as { runId: string }).runId).toBe('r1');
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'phase_started' }));
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'phase_completed' }));
  });

  it('runExecute returns GateEvent when gate fired', async () => {
    mockLLM.complete.mockResolvedValue({
      text: '', content: [], stopReason: 'tool_use',
      toolUses: [{ id: 't1', name: 'fire_gate', input: { gapDescription: 'gap', question: 'q' } }],
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const plan = { runId: 'r1', hasGap: false, steps: [] };
    const context = { runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [] };
    const result = await service.runExecute(plan, context, makeContext() as never);
    expect(result).toBeInstanceOf(GateEvent);
  });
});
