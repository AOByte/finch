import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShipAgentService } from '../../src/agents/ship-agent.service';
import { GateEvent } from '../../src/agents/gate-event';

describe('ShipAgentService', () => {
  const mockAuditLogger = { log: vi.fn().mockResolvedValue(undefined) };
  const mockLLM = { complete: vi.fn(), providerId: 'anthropic' };
  const mockMemoryConnector = { query: vi.fn(), stageRecord: vi.fn().mockResolvedValue(undefined), mergeRecords: vi.fn() };
  const mockDispatcher = {
    getAuditLogger: vi.fn().mockReturnValue(mockAuditLogger),
    getLLM: vi.fn().mockReturnValue(mockLLM),
    getLockedPreamble: vi.fn().mockReturnValue('locked preamble'),
    getMemoryConnector: vi.fn().mockReturnValue(mockMemoryConnector),
  };

  let service: ShipAgentService;

  const makeContext = () => ({
    runId: 'r1', harnessId: 'h1', phase: 'SHIP' as const,
    agentConfig: {
      agentId: 'ship-default', position: 0, llmConnectorId: 'anthropic',
      llmProvider: 'anthropic', model: 'claude-sonnet-4-20250514', maxTokens: 4096,
      systemPromptBody: '', skills: [], rules: [],
    },
    source: { type: 'webhook', channelId: 'c', messageId: 'm', threadTs: 't', authorId: 'a', timestamp: '2024-01-01' },
    pipelinePosition: 0,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ShipAgentService(mockDispatcher as never);
  });

  it('buildLockedPreamble delegates to dispatcher', () => {
    expect(service.buildLockedPreamble()).toBe('locked preamble');
  });

  it('buildInitialMessage includes repo and plan', () => {
    const msg = service.buildInitialMessage({
      plan: { runId: 'r1', hasGap: false, steps: ['step1'] },
      report: { runId: 'r1', hasGap: false, allPassing: true, results: [] },
      context: { runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [] },
      repoId: 'my-repo',
    });
    expect(msg).toContain('my-repo');
    expect(msg).toContain('step1');
    expect(msg).toContain('all passing');
  });

  it('buildInitialMessage shows some failing when allPassing is false', () => {
    const msg = service.buildInitialMessage({
      plan: { runId: 'r1', hasGap: false, steps: ['step1'] },
      report: { runId: 'r1', hasGap: false, allPassing: false, results: [] },
      context: { runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [] },
      repoId: 'my-repo',
    });
    expect(msg).toContain('some failing');
  });

  it('buildToolSet returns stage_memory tool', () => {
    const tools = service.buildToolSet(makeContext() as never);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('stage_memory');
  });

  it('parseOutput parses valid JSON', () => {
    const result = service.parseOutput({
      text: JSON.stringify({ repoId: 'repo1', commitSha: 'abc123', prUrl: 'http://pr' }),
      content: [], toolUses: [], usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn',
    });
    expect(result.commitSha).toBe('abc123');
  });

  it('parseOutput handles invalid JSON', () => {
    const result = service.parseOutput({
      text: 'not json', content: [], toolUses: [],
      usage: { inputTokens: 0, outputTokens: 0 }, stopReason: 'end_turn',
    });
    expect(result.commitSha).toBe('stub-sha');
  });

  it('executeToolCall handles stage_memory tool', async () => {
    const ctx = makeContext();
    const result = await service.executeToolCall(
      'stage_memory',
      { type: 'decision', content: 'chose X', relevanceTags: ['tag1'] },
      ctx as never,
    );
    expect(result).toEqual({ staged: true });
    expect(mockMemoryConnector.stageRecord).toHaveBeenCalledWith({
      runId: 'r1', harnessId: 'h1', type: 'decision', content: 'chose X', relevanceTags: ['tag1'],
    });
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'memory_staged' }));
  });

  it('executeToolCall returns error for unknown tool', async () => {
    const result = await service.executeToolCall('unknown', {}, makeContext() as never);
    expect(result).toEqual({ error: 'Unknown tool' });
  });

  it('runShip returns ShipResult on success', async () => {
    mockLLM.complete.mockResolvedValue({
      text: JSON.stringify({ repoId: 'repo1', commitSha: 'def456' }),
      content: [], toolUses: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'end_turn',
    });

    const plan = { runId: 'r1', hasGap: false, steps: ['deploy'] };
    const report = { runId: 'r1', hasGap: false, allPassing: true, results: [] };
    const context = { runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [] };
    const result = await service.runShip(plan, report, context, 'repo1', makeContext() as never);

    expect(result).not.toBeInstanceOf(GateEvent);
    expect((result as { repoId: string }).repoId).toBe('repo1');
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'phase_started' }));
    expect(mockAuditLogger.log).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'phase_completed' }));
  });

  it('runShip returns GateEvent gracefully', async () => {
    mockLLM.complete.mockResolvedValue({
      text: '', content: [], stopReason: 'tool_use',
      toolUses: [{ id: 't1', name: 'fire_gate', input: { gapDescription: 'gap', question: 'q' } }],
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const plan = { runId: 'r1', hasGap: false, steps: [] };
    const report = { runId: 'r1', hasGap: false, allPassing: true, results: [] };
    const context = { runId: 'r1', harnessId: 'h1', hasGap: false, files: [], dependencies: [] };
    const result = await service.runShip(plan, report, context, 'repo1', makeContext() as never);
    expect(result).toBeInstanceOf(GateEvent);
  });
});
