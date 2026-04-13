import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly client: OpenAI;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.warn('OPENAI_API_KEY not configured — embedding calls will fail');
    }
    this.client = new OpenAI({ apiKey: apiKey ?? '' });
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });

    const embedding = response.data[0].embedding;
    this.logger.debug(`Generated embedding: ${embedding.length} dimensions`);
    return embedding;
  }
}
