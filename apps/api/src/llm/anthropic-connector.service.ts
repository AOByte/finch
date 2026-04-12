import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { LLMRegistryService } from './llm-registry.service';
import type {
  LLMConnector,
  LLMCompleteParams,
  LLMResponse,
  ToolUse,
  LLMContentBlock,
} from '@finch/types';

@Injectable()
export class AnthropicConnectorService implements LLMConnector, OnModuleInit {
  private readonly logger = new Logger(AnthropicConnectorService.name);
  private client: Anthropic | null = null;
  readonly providerId = 'anthropic';

  constructor(private readonly llmRegistry: LLMRegistryService) {}

  onModuleInit(): void {
    const apiKey = this.llmRegistry.getAnthropicApiKey();
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
      this.llmRegistry.register(this.providerId, this);
      this.logger.log('Anthropic connector registered');
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — Anthropic connector not registered');
    }
  }

  async complete(params: LLMCompleteParams): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('Anthropic client not initialized — ANTHROPIC_API_KEY not set');
    }

    const messages: Anthropic.MessageParam[] = params.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const requestParams: Anthropic.MessageCreateParams = {
      model: params.model,
      max_tokens: params.maxTokens,
      messages,
    };

    if (params.system) {
      requestParams.system = params.system;
    }

    if (params.tools && params.tools.length > 0) {
      requestParams.tools = params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      }));
    }

    const response = await this.client.messages.create(requestParams);

    const toolUses: ToolUse[] = [];
    const contentBlocks: LLMContentBlock[] = [];
    let text = '';

    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
        contentBlocks.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        toolUses.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
        contentBlocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      text,
      content: contentBlocks,
      toolUses,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      stopReason: response.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
    };
  }
}
