import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { LLMConnector } from '@finch/types';

@Injectable()
export class LLMRegistryService {
  private readonly logger = new Logger(LLMRegistryService.name);
  private readonly providers = new Map<string, LLMConnector>();

  constructor(private readonly configService: ConfigService) {}

  register(providerId: string, connector: LLMConnector): void {
    this.providers.set(providerId, connector);
    this.logger.log(`Registered LLM provider: ${providerId}`);
  }

  get(providerId: string): LLMConnector {
    const connector = this.providers.get(providerId);
    if (!connector) {
      throw new Error(`LLM provider "${providerId}" not registered`);
    }
    return connector;
  }

  getDefault(_harnessId: string): LLMConnector {
    // Default to anthropic provider
    return this.get('anthropic');
  }

  getAnthropicApiKey(): string | undefined {
    return this.configService.get<string>('ANTHROPIC_API_KEY');
  }

  getOpenAIApiKey(): string | undefined {
    return this.configService.get<string>('OPENAI_API_KEY');
  }

  has(providerId: string): boolean {
    return this.providers.has(providerId);
  }
}
