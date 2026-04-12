import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentConfigService } from '../../src/agents/agent-config.service';

describe('AgentConfigService', () => {
  const mockPrisma = {
    agentConfig: {
      findMany: vi.fn(),
    },
  };
  let service: AgentConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AgentConfigService(mockPrisma as never);
  });

  it('getPipeline returns agents sorted by position', async () => {
    mockPrisma.agentConfig.findMany.mockResolvedValue([
      {
        agentConfigId: 'ac-1',
        position: 0,
        model: 'claude-sonnet-4-20250514',
        maxTokens: 4096,
        systemPromptBody: 'You are helpful',
        skills: [{ skillId: 's1', name: 'test', content: 'content', version: 1 }],
        rules: [{ ruleId: 'r1', name: 'rule1', constraint: 'no bad', enforcement: 'hard', patternType: 'path', patterns: ['bad'] }],
      },
    ]);

    const result = await service.getPipeline('TRIGGER', 'harness-1');
    expect(result.phase).toBe('TRIGGER');
    expect(result.harnessId).toBe('harness-1');
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].agentId).toBe('ac-1');
    expect(result.agents[0].model).toBe('claude-sonnet-4-20250514');
    expect(result.agents[0].skills).toHaveLength(1);
    expect(result.agents[0].rules).toHaveLength(1);
    expect(mockPrisma.agentConfig.findMany).toHaveBeenCalledWith({
      where: { harnessId: 'harness-1', phase: 'TRIGGER', isActive: true },
      orderBy: { position: 'asc' },
    });
  });

  it('getPipeline handles null maxTokens and systemPromptBody', async () => {
    mockPrisma.agentConfig.findMany.mockResolvedValue([
      {
        agentConfigId: 'ac-2',
        position: 0,
        model: 'claude-sonnet-4-20250514',
        maxTokens: null,
        systemPromptBody: null,
        skills: null,
        rules: null,
      },
    ]);

    const result = await service.getPipeline('ACQUIRE', 'harness-1');
    expect(result.agents[0].maxTokens).toBe(4096);
    expect(result.agents[0].systemPromptBody).toBe('');
    expect(result.agents[0].skills).toEqual([]);
    expect(result.agents[0].rules).toEqual([]);
  });

  it('getPipeline returns empty agents when none configured', async () => {
    mockPrisma.agentConfig.findMany.mockResolvedValue([]);
    const result = await service.getPipeline('PLAN', 'harness-1');
    expect(result.agents).toHaveLength(0);
  });
});
