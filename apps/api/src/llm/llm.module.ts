import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LLMRegistryService } from './llm-registry.service';
import { AnthropicConnectorService } from './anthropic-connector.service';
import { OpenAIConnectorService } from './openai-connector.service';

@Module({
  imports: [ConfigModule],
  providers: [LLMRegistryService, AnthropicConnectorService, OpenAIConnectorService],
  exports: [LLMRegistryService, AnthropicConnectorService, OpenAIConnectorService],
})
export class LLMModule {}
