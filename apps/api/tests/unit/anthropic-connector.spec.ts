import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicConnectorService } from '../../src/llm/anthropic-connector.service';

const mockMessagesCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockMessagesCreate };
      constructor(_opts?: Record<string, unknown>) {}
    },
  };
});

describe('AnthropicConnectorService', () => {
  let service: AnthropicConnectorService;
  const mockRegistry = {
    getAnthropicApiKey: vi.fn(),
    register: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AnthropicConnectorService(mockRegistry as never);
  });

  it('has providerId "anthropic"', () => {
    expect(service.providerId).toBe('anthropic');
  });

  describe('onModuleInit', () => {
    it('registers when API key is set', () => {
      mockRegistry.getAnthropicApiKey.mockReturnValue('test-key');
      service.onModuleInit();
      expect(mockRegistry.register).toHaveBeenCalledWith('anthropic', service);
    });

    it('does not register when API key is missing', () => {
      mockRegistry.getAnthropicApiKey.mockReturnValue(undefined);
      service.onModuleInit();
      expect(mockRegistry.register).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('throws when client not initialized', async () => {
      mockRegistry.getAnthropicApiKey.mockReturnValue(undefined);
      service.onModuleInit();
      await expect(service.complete({
        messages: [{ role: 'user', content: 'test' }],
        model: 'claude-sonnet-4-20250514',
        maxTokens: 100,
      })).rejects.toThrow('Anthropic client not initialized');
    });

    it('completes with text response', async () => {
      mockRegistry.getAnthropicApiKey.mockReturnValue('test-key');
      service.onModuleInit();

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Hello world' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      });

      const result = await service.complete({
        messages: [{ role: 'user', content: 'test' }],
        model: 'claude-sonnet-4-20250514',
        maxTokens: 100,
      });

      expect(result.text).toBe('Hello world');
      expect(result.stopReason).toBe('end_turn');
      expect(result.usage.inputTokens).toBe(10);
      expect(result.usage.outputTokens).toBe(5);
    });

    it('completes with tool_use response', async () => {
      mockRegistry.getAnthropicApiKey.mockReturnValue('test-key');
      service.onModuleInit();

      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'fire_gate', input: { question: 'what?' } },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'tool_use',
      });

      const result = await service.complete({
        messages: [{ role: 'user', content: 'test' }],
        model: 'claude-sonnet-4-20250514',
        maxTokens: 100,
        tools: [{ name: 'fire_gate', description: 'test', inputSchema: { type: 'object' } }],
      });

      expect(result.toolUses).toHaveLength(1);
      expect(result.toolUses[0].name).toBe('fire_gate');
      expect(result.stopReason).toBe('tool_use');
    });

    it('includes system prompt when provided', async () => {
      mockRegistry.getAnthropicApiKey.mockReturnValue('test-key');
      service.onModuleInit();

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await service.complete({
        messages: [{ role: 'user', content: 'test' }],
        system: 'You are helpful',
        model: 'claude-sonnet-4-20250514',
        maxTokens: 100,
      });

      expect(mockMessagesCreate).toHaveBeenCalledWith(
        expect.objectContaining({ system: 'You are helpful' }),
      );
    });

    it('handles mixed text and tool_use blocks in response', async () => {
      mockRegistry.getAnthropicApiKey.mockReturnValue('test-key');
      service.onModuleInit();

      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'reasoning...' },
          { type: 'tool_use', id: 'tool-2', name: 'search', input: { q: 'test' } },
        ],
        usage: { input_tokens: 20, output_tokens: 10 },
        stop_reason: 'tool_use',
      });

      const result = await service.complete({
        messages: [{ role: 'user', content: 'test' }],
        model: 'claude-sonnet-4-20250514',
        maxTokens: 100,
        tools: [{ name: 'search', description: 'search', inputSchema: { type: 'object' } }],
      });

      expect(result.text).toBe('reasoning...');
      expect(result.toolUses).toHaveLength(1);
      expect(result.toolUses[0].name).toBe('search');
      expect(result.content).toHaveLength(2);
      expect(result.stopReason).toBe('tool_use');
    });

    it('handles unknown content block types gracefully', async () => {
      mockRegistry.getAnthropicApiKey.mockReturnValue('test-key');
      service.onModuleInit();

      mockMessagesCreate.mockResolvedValue({
        content: [
          { type: 'text', text: 'hello' },
          { type: 'thinking', thinking: 'internal reasoning' },
        ],
        usage: { input_tokens: 5, output_tokens: 3 },
        stop_reason: 'end_turn',
      });

      const result = await service.complete({
        messages: [{ role: 'user', content: 'test' }],
        model: 'claude-sonnet-4-20250514',
        maxTokens: 100,
      });

      expect(result.text).toBe('hello');
      // Unknown block type is silently skipped
      expect(result.content).toHaveLength(1);
    });

    it('handles non-string message content', async () => {
      mockRegistry.getAnthropicApiKey.mockReturnValue('test-key');
      service.onModuleInit();

      mockMessagesCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'end_turn',
      });

      await service.complete({
        messages: [{ role: 'user', content: [{ type: 'tool_result', toolUseId: '1', content: 'result' }] }],
        model: 'claude-sonnet-4-20250514',
        maxTokens: 100,
      });

      expect(mockMessagesCreate).toHaveBeenCalled();
    });
  });
});
