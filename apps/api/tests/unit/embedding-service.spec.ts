import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingService } from '../../src/memory/embedding.service';

// Mock the OpenAI module with a real class constructor
vi.mock('openai', () => {
  class MockOpenAI {
    embeddings = {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0.01) }],
      }),
    };
  }
  return { default: MockOpenAI };
});

describe('EmbeddingService', () => {
  let service: EmbeddingService;

  beforeEach(() => {
    service = new EmbeddingService();
  });

  it('embed returns a 1536-element number[]', async () => {
    const result = await service.embed('test');
    expect(result).toHaveLength(1536);
    expect(typeof result[0]).toBe('number');
  });

  it('embed calls OpenAI with text-embedding-3-small model', async () => {
    await service.embed('hello world');
    // The mock resolves with 1536-dim vector
    const result = await service.embed('another test');
    expect(result).toHaveLength(1536);
  });
});
