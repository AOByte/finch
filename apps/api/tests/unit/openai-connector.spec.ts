import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIConnectorService } from '../../src/llm/openai-connector.service';

const mockChatCreate = vi.fn();
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockChatCreate } };
      constructor(_opts?: Record<string, unknown>) {}
    },
  };
});

describe('OpenAIConnectorService', () => {
  let service: OpenAIConnectorService;
  const mockRegistry = {
    getOpenAIApiKey: vi.fn(),
    register: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OpenAIConnectorService(mockRegistry as never);
  });

  it('has providerId "openai"', () => {
    expect(service.providerId).toBe('openai');
  });

  describe('onModuleInit', () => {
    it('registers when API key is set', () => {
      mockRegistry.getOpenAIApiKey.mockReturnValue('test-key');
      service.onModuleInit();
      expect(mockRegistry.register).toHaveBeenCalledWith('openai', service);
    });

    it('does not register when API key is missing', () => {
      mockRegistry.getOpenAIApiKey.mockReturnValue(undefined);
      service.onModuleInit();
      expect(mockRegistry.register).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('throws when client not initialized', async () => {
      mockRegistry.getOpenAIApiKey.mockReturnValue(undefined);
      service.onModuleInit();
      await expect(service.complete({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
        maxTokens: 100,
      })).rejects.toThrow('OpenAI client not initialized');
    });

    it('completes with text response', async () => {
      mockRegistry.getOpenAIApiKey.mockReturnValue('test-key');
      service.onModuleInit();

      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      });

      const result = await service.complete({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
        maxTokens: 100,
      });

      expect(result.text).toBe('Hello');
      expect(result.stopReason).toBe('end_turn');
      expect(result.usage.inputTokens).toBe(10);
    });

    it('handles null content in response', async () => {
      mockRegistry.getOpenAIApiKey.mockReturnValue('test-key');
      service.onModuleInit();

      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: null }, finish_reason: 'length' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

      const result = await service.complete({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
        maxTokens: 100,
      });

      expect(result.text).toBe('');
    });

    it('handles missing usage', async () => {
      mockRegistry.getOpenAIApiKey.mockReturnValue('test-key');
      service.onModuleInit();

      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: undefined,
      });

      const result = await service.complete({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
        maxTokens: 100,
      });

      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
    });

    it('includes system prompt when provided', async () => {
      mockRegistry.getOpenAIApiKey.mockReturnValue('test-key');
      service.onModuleInit();

      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

      await service.complete({
        messages: [{ role: 'user', content: 'test' }],
        system: 'You are helpful',
        model: 'gpt-4',
        maxTokens: 100,
      });

      const callArgs = mockChatCreate.mock.calls[0][0];
      expect(callArgs.messages[0]).toEqual({ role: 'system', content: 'You are helpful' });
    });

    it('handles non-string message content', async () => {
      mockRegistry.getOpenAIApiKey.mockReturnValue('test-key');
      service.onModuleInit();

      mockChatCreate.mockResolvedValue({
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

      await service.complete({
        messages: [{ role: 'user', content: [{ type: 'tool_result', toolUseId: '1', content: 'res' }] }],
        model: 'gpt-4',
        maxTokens: 100,
      });

      expect(mockChatCreate).toHaveBeenCalled();
    });

    it('handles empty choices', async () => {
      mockRegistry.getOpenAIApiKey.mockReturnValue('test-key');
      service.onModuleInit();

      mockChatCreate.mockResolvedValue({
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });

      const result = await service.complete({
        messages: [{ role: 'user', content: 'test' }],
        model: 'gpt-4',
        maxTokens: 100,
      });

      expect(result.text).toBe('');
    });
  });
});
