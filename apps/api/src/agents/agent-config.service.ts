import { Injectable } from '@nestjs/common';
import { PrismaService } from '../persistence/prisma.service';
import type { Phase, AgentPipelineConfig, AgentStepConfig } from '@finch/types';

@Injectable()
export class AgentConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async getPipeline(phase: Phase, harnessId: string): Promise<AgentPipelineConfig> {
    const configs = await this.prisma.agentConfig.findMany({
      where: {
        harnessId,
        phase,
        isActive: true,
      },
      orderBy: { position: 'asc' },
    });

    const agents: AgentStepConfig[] = configs.map((c) => ({
      agentId: c.agentConfigId,
      position: c.position,
      llmConnectorId: 'anthropic',
      llmProvider: 'anthropic',
      model: c.model,
      maxTokens: c.maxTokens ?? 4096,
      systemPromptBody: c.systemPromptBody ?? '',
      skills: (c.skills as Array<{ skillId: string; name: string; content: string; version: number }>) ?? [],
      rules: (c.rules as Array<{ ruleId: string; name: string; constraint: string; enforcement: 'hard' | 'soft'; patternType: 'path' | 'regex' | 'semantic'; patterns: string[] }>) ?? [],
    }));

    return { phase, harnessId, agents };
  }
}
