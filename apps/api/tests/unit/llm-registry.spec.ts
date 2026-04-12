import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LLMRegistryService } from '../../src/llm/llm-registry.service';
import type { LLMConnector } from '@finch/types';

describe('LLMRegistryService', () => {
  let service: LLMRegistryService;
  const mockConfigService = {
    get: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LLMRegistryService(mockConfigService as never);
  });

  it('registers and retrieves a provider', () => {
    const mockConnector: LLMConnector = {
      providerId: 'test',
      complete: vi.fn(),
    };
    service.register('test', mockConnector);
    expect(service.get('test')).toBe(mockConnector);
  });

  it('throws when getting unregistered provider', () => {
    expect(() => service.get('nonexistent')).toThrow('LLM provider "nonexistent" not registered');
  });

  it('getDefault returns anthropic provider', () => {
    const mockConnector: LLMConnector = {
      providerId: 'anthropic',
      complete: vi.fn(),
    };
    service.register('anthropic', mockConnector);
    expect(service.getDefault('any-harness')).toBe(mockConnector);
  });

  it('getAnthropicApiKey delegates to ConfigService', () => {
    mockConfigService.get.mockReturnValue('test-key');
    expect(service.getAnthropicApiKey()).toBe('test-key');
    expect(mockConfigService.get).toHaveBeenCalledWith('ANTHROPIC_API_KEY');
  });

  it('getOpenAIApiKey delegates to ConfigService', () => {
    mockConfigService.get.mockReturnValue('openai-key');
    expect(service.getOpenAIApiKey()).toBe('openai-key');
    expect(mockConfigService.get).toHaveBeenCalledWith('OPENAI_API_KEY');
  });

  it('has returns true for registered provider', () => {
    const mockConnector: LLMConnector = {
      providerId: 'test',
      complete: vi.fn(),
    };
    service.register('test', mockConnector);
    expect(service.has('test')).toBe(true);
    expect(service.has('nonexistent')).toBe(false);
  });
});
