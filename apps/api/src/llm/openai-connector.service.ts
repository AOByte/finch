import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import OpenAI from 'openai';
import { LLMRegistryService } from './llm-registry.service';
import type {
  LLMConnector,
  LLMCompleteParams,
  LLMResponse,
} from '@finch/types';

@Injectable()
export class OpenAIConnectorService implements LLMConnector, OnModuleInit {
  private readonly logger = new Logger(OpenAIConnectorService.name);
  private client: OpenAI | null = null;
  readonly providerId = 'openai';

  constructor(private readonly llmRegistry: LLMRegistryService) {}

  onModuleInit(): void {
    const apiKey = this.llmRegistry.getOpenAIApiKey();
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
      this.llmRegistry.register(this.providerId, this);
      this.logger.log('OpenAI connector registered');
    } else {
      this.logger.warn('OPENAI_API_KEY not set — OpenAI connector not registered');
    }
  }

  async complete(params: LLMCompleteParams): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('OpenAI client not initialized — OPENAI_API_KEY not set');
    }

    const messages: OpenAI.ChatCompletionMessageParam[] = [];
    if (params.system) {
      messages.push({ role: 'system', content: params.system });
    }
    for (const m of params.messages) {
      messages.push({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
    }

    const response = await this.client.chat.completions.create({
      model: params.model,
      max_tokens: params.maxTokens,
      messages,
    });

    const choice = response.choices[0];
    const text = choice?.message?.content ?? '';

    return {
      text,
      content: [{ type: 'text', text }],
      toolUses: [],
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
      stopReason: choice?.finish_reason === 'stop' ? 'end_turn' : 'end_turn',
    };
  }
}
