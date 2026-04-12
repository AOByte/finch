import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseAgent } from '../../src/agents/base-agent';
import { GateEvent } from '../../src/agents/gate-event';
import type { LLMConnector, LLMResponse, AgentContext, Tool, AuditEventData } from '@finch/types';

class TestAgent extends BaseAgent<string, string> {
  public mockLLM: LLMConnector;
  public auditLogs: AuditEventData[] = [];

  constructor(mockLLM: LLMConnector) {
    super();
    this.mockLLM = mockLLM;
  }

  protected async auditLog(event: AuditEventData): Promise<void> {
    this.auditLogs.push(event);
  }

  protected getLLM(): LLMConnector {
    return this.mockLLM;
  }

  buildLockedPreamble(): string {
    return 'test preamble';
  }

  buildInitialMessage(input: string): string {
    return `Process: ${input}`;
  }

  buildToolSet(_context: AgentContext): Tool[] {
    return [
      {
        name: 'fire_gate',
        description: 'Fire a gate',
        inputSchema: {
          type: 'object',
          properties: {
            gapDescription: { type: 'string' },
            question: { type: 'string' },
          },
          required: ['gapDescription', 'question'],
        },
      },
      {
        name: 'custom_tool',
        description: 'A custom tool',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
    ];
  }

  parseOutput(response: LLMResponse): string {
    return response.text;
  }

  async executeToolCall(
    toolName: string,
    _toolInput: Record<string, unknown>,
    _context: AgentContext,
  ): Promise<unknown> {
    if (toolName === 'custom_tool') {
      return { result: 'custom_result' };
    }
    return { error: 'Unknown tool' };
  }
}

describe('BaseAgent', () => {
  let mockLLM: { complete: ReturnType<typeof vi.fn> };
  let agent: TestAgent;

  const makeContext = (): AgentContext => ({
    runId: 'r1',
    harnessId: 'h1',
    phase: 'TRIGGER',
    agentConfig: {
      agentId: 'test-agent',
      position: 0,
      llmConnectorId: 'anthropic',
      llmProvider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      maxTokens: 4096,
      systemPromptBody: 'custom body',
      skills: [{ content: 'skill1 content' }, { content: 'skill2 content' }],
      rules: [
        { enforcement: 'hard', constraint: 'must do X' },
        { enforcement: 'soft', constraint: 'should do Y' },
      ],
    },
    source: {
      type: 'webhook',
      channelId: 'c',
      messageId: 'm',
      threadTs: 't',
      authorId: 'a',
      timestamp: '2024-01-01',
    },
    pipelinePosition: 0,
  });

  beforeEach(() => {
    mockLLM = { complete: vi.fn() };
    agent = new TestAgent(mockLLM as unknown as LLMConnector);
  });

  it('run() builds system prompt from preamble, body, skills, and rules', async () => {
    mockLLM.complete.mockResolvedValue({
      text: 'result',
      content: [],
      toolUses: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
    });

    const ctx = makeContext();
    await agent.run('test input', ctx);

    const callArgs = mockLLM.complete.mock.calls[0][0];
    expect(callArgs.system).toContain('test preamble');
    expect(callArgs.system).toContain('custom body');
    expect(callArgs.system).toContain('skill1 content');
    expect(callArgs.system).toContain('skill2 content');
    expect(callArgs.system).toContain('RULE [HARD]: must do X');
    expect(callArgs.system).toContain('RULE [SOFT]: should do Y');
  });

  it('run() returns parsed output on end_turn', async () => {
    mockLLM.complete.mockResolvedValue({
      text: 'final answer',
      content: [],
      toolUses: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
    });

    const result = await agent.run('test', makeContext());
    expect(result).toBe('final answer');
  });

  it('run() returns GateEvent on fire_gate tool use', async () => {
    mockLLM.complete.mockResolvedValue({
      text: '',
      content: [],
      toolUses: [{ id: 't1', name: 'fire_gate', input: { gapDescription: 'missing info', question: 'what?' } }],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'tool_use',
    });

    const result = await agent.run('test', makeContext());
    expect(result).toBeInstanceOf(GateEvent);
    const gate = result as GateEvent;
    expect(gate.gapDescription).toBe('missing info');
    expect(gate.question).toBe('what?');
    expect(gate.phase).toBe('TRIGGER');
    expect(gate.runId).toBe('r1');
  });

  it('run() processes non-gate tool calls and continues loop', async () => {
    // First call: tool_use with custom_tool
    mockLLM.complete.mockResolvedValueOnce({
      text: '',
      content: [],
      toolUses: [{ id: 't1', name: 'custom_tool', input: { key: 'value' } }],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'tool_use',
    });
    // Second call: end_turn
    mockLLM.complete.mockResolvedValueOnce({
      text: 'after tool',
      content: [],
      toolUses: [],
      usage: { inputTokens: 15, outputTokens: 8 },
      stopReason: 'end_turn',
    });

    const result = await agent.run('test', makeContext());
    expect(result).toBe('after tool');
    expect(mockLLM.complete).toHaveBeenCalledTimes(2);

    // Verify tool_call audit was logged
    const toolCallLogs = agent.auditLogs.filter((l) => l.eventType === 'tool_call');
    expect(toolCallLogs).toHaveLength(1);
    expect((toolCallLogs[0].payload as Record<string, unknown>).toolName).toBe('custom_tool');
  });

  it('run() logs llm_call audit events for each iteration', async () => {
    mockLLM.complete.mockResolvedValue({
      text: 'done',
      content: [],
      toolUses: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
    });

    await agent.run('test', makeContext());
    const llmLogs = agent.auditLogs.filter((l) => l.eventType === 'llm_call');
    expect(llmLogs).toHaveLength(1);
    expect((llmLogs[0].payload as Record<string, unknown>).inputTokens).toBe(10);
    expect((llmLogs[0].payload as Record<string, unknown>).outputTokens).toBe(5);
  });

  it('run() throws after 50 iterations', async () => {
    // Always returns a non-end_turn, non-tool_use response
    mockLLM.complete.mockResolvedValue({
      text: 'thinking...',
      content: [],
      toolUses: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: 'max_tokens',
    });

    await expect(agent.run('test', makeContext())).rejects.toThrow('Agent loop exceeded maximum iterations (50)');
  });

  it('run() handles empty skills and rules', async () => {
    mockLLM.complete.mockResolvedValue({
      text: 'result',
      content: [],
      toolUses: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
    });

    const ctx = makeContext();
    ctx.agentConfig.skills = [];
    ctx.agentConfig.rules = [];
    ctx.agentConfig.systemPromptBody = '';

    await agent.run('test', ctx);
    const callArgs = mockLLM.complete.mock.calls[0][0];
    expect(callArgs.system).toBe('test preamble');
  });

  it('run() filters out undefined/null systemPromptBody in system prompt', async () => {
    mockLLM.complete.mockResolvedValue({
      text: 'result',
      content: [],
      toolUses: [],
      usage: { inputTokens: 10, outputTokens: 5 },
      stopReason: 'end_turn',
    });

    const ctx = makeContext();
    ctx.agentConfig.systemPromptBody = undefined as unknown as string;
    ctx.agentConfig.skills = [{ content: 'skill content' }];
    ctx.agentConfig.rules = [{ enforcement: 'hard', constraint: 'rule1' }];

    await agent.run('test', ctx);
    const callArgs = mockLLM.complete.mock.calls[0][0];
    // preamble is present, systemPromptBody is filtered out, skills and rules are present
    expect(callArgs.system).toContain('test preamble');
    expect(callArgs.system).toContain('skill content');
    expect(callArgs.system).toContain('RULE [HARD]: rule1');
    // Should have 3 sections separated by ---
    const sections = callArgs.system.split('\n\n---\n\n');
    expect(sections).toHaveLength(3);
  });

  it('run() passes correct maxTokens defaulting to 4096', async () => {
    mockLLM.complete.mockResolvedValue({
      text: 'done',
      content: [],
      toolUses: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: 'end_turn',
    });

    const ctx = makeContext();
    ctx.agentConfig.maxTokens = null as unknown as number;
    await agent.run('test', ctx);

    const callArgs = mockLLM.complete.mock.calls[0][0];
    expect(callArgs.maxTokens).toBe(4096);
  });

  it('run() includes tool_result messages in conversation', async () => {
    mockLLM.complete.mockResolvedValueOnce({
      text: '',
      content: [],
      toolUses: [{ id: 'tool-1', name: 'custom_tool', input: {} }],
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: 'tool_use',
    });
    mockLLM.complete.mockResolvedValueOnce({
      text: 'final',
      content: [],
      toolUses: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      stopReason: 'end_turn',
    });

    await agent.run('test', makeContext());

    // Second LLM call should have tool_result in messages
    const secondCall = mockLLM.complete.mock.calls[1][0];
    const toolResultMsg = secondCall.messages.find(
      (m: { role: string; content: unknown }) =>
        Array.isArray(m.content) &&
        m.content.some((c: { type: string }) => c.type === 'tool_result'),
    );
    expect(toolResultMsg).toBeDefined();
  });
});
