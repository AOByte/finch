import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { SlackConnectorService } from '../../src/connectors/slack-connector.service';
import { ConnectorRegistryService } from '../../src/connectors/connector-registry.service';
import { CredentialEncryptionService } from '../../src/connectors/credential-encryption.service';

const mockPostMessage = vi.fn().mockResolvedValue({ ok: true });
const mockStart = vi.fn().mockResolvedValue(undefined);

vi.mock('@slack/bolt', () => {
  class MockApp {
    start = mockStart;
    event = vi.fn();
    client = { chat: { postMessage: mockPostMessage } };
    constructor(_opts?: unknown) {}
  }
  return { App: MockApp };
});

function makeService(envOverrides: Record<string, string | undefined> = {}) {
  const config = new ConfigService({
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_APP_TOKEN: 'xapp-test',
    TRIGGER_PREFIX: '@finch',
    ENCRYPTION_KEY: 'a'.repeat(64),
    ...envOverrides,
  });
  const registry = new ConnectorRegistryService();
  const encryption = new CredentialEncryptionService(new ConfigService({ ENCRYPTION_KEY: 'a'.repeat(64) }));
  return { service: new SlackConnectorService(config, registry, encryption), registry };
}

describe('SlackConnectorService', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('registers in ConnectorRegistryService on init', async () => {
    const { service, registry } = makeService();
    await service.onModuleInit();
    expect(registry.has('slack')).toBe(true);
  });

  it('initializes Slack app with Socket Mode when credentials provided', async () => {
    const { service } = makeService();
    await service.onModuleInit();
    expect(service.isInitialized()).toBe(true);
  });

  it('skips initialization when credentials are missing', async () => {
    const { service } = makeService({ SLACK_BOT_TOKEN: undefined, SLACK_APP_TOKEN: undefined });
    await service.onModuleInit();
    expect(service.isInitialized()).toBe(false);
  });

  it('handles initialization failure gracefully', async () => {
    mockStart.mockRejectedValueOnce(new Error('Connection failed'));

    const { service } = makeService();
    await service.onModuleInit();
    expect(service.isInitialized()).toBe(false);
  });

  describe('extractRawInput', () => {
    it('strips trigger prefix from text', () => {
      const { service } = makeService();
      const result = service.extractRawInput({
        type: 'message',
        text: '@finch fix the login page',
        channel: 'C123',
        user: 'U456',
        ts: '1234567890.123456',
      });
      expect(result.rawText).toBe('fix the login page');
      expect(result.source.type).toBe('slack');
      expect(result.source.channelId).toBe('C123');
      expect(result.source.authorId).toBe('U456');
    });

    it('uses thread_ts when available', () => {
      const { service } = makeService();
      const result = service.extractRawInput({
        type: 'message',
        text: '@finch hello',
        channel: 'C123',
        user: 'U456',
        ts: '111.111',
        thread_ts: '222.222',
      });
      expect(result.source.threadTs).toBe('222.222');
    });

    it('uses ts as threadTs when no thread_ts', () => {
      const { service } = makeService();
      const result = service.extractRawInput({
        type: 'message',
        text: 'no prefix hello',
        channel: 'C123',
        user: 'U456',
        ts: '111.111',
      });
      expect(result.source.threadTs).toBe('111.111');
      expect(result.rawText).toBe('no prefix hello');
    });
  });

  describe('shouldProcessMessage', () => {
    it('returns true for messages with trigger prefix', () => {
      const { service } = makeService();
      expect(service.shouldProcessMessage({
        type: 'message', text: '@finch do something', channel: 'C1', user: 'U1', ts: '1.1',
      })).toBe(true);
    });

    it('returns false for messages with subtype', () => {
      const { service } = makeService();
      expect(service.shouldProcessMessage({
        type: 'message', subtype: 'bot_message', text: '@finch do something', channel: 'C1', user: 'U1', ts: '1.1',
      })).toBe(false);
    });

    it('returns false for messages without trigger prefix', () => {
      const { service } = makeService();
      expect(service.shouldProcessMessage({
        type: 'message', text: 'just a message', channel: 'C1', user: 'U1', ts: '1.1',
      })).toBe(false);
    });
  });

  describe('isThreadReply', () => {
    it('returns true when thread_ts differs from ts', () => {
      const { service } = makeService();
      expect(service.isThreadReply({ type: 'message', text: 'x', channel: 'C1', user: 'U1', ts: '1.1', thread_ts: '2.2' })).toBe(true);
    });

    it('returns false when thread_ts equals ts', () => {
      const { service } = makeService();
      expect(service.isThreadReply({ type: 'message', text: 'x', channel: 'C1', user: 'U1', ts: '1.1', thread_ts: '1.1' })).toBe(false);
    });

    it('returns false when no thread_ts', () => {
      const { service } = makeService();
      expect(service.isThreadReply({ type: 'message', text: 'x', channel: 'C1', user: 'U1', ts: '1.1' })).toBe(false);
    });
  });

  describe('sendMessage', () => {
    it('sends message via Slack client when initialized', async () => {
      const { service } = makeService();
      await service.onModuleInit();
      await service.sendMessage({ channelId: 'C123', threadTs: '1.1', message: 'Hello' });
    });

    it('logs warning when not initialized', async () => {
      const { service } = makeService({ SLACK_BOT_TOKEN: undefined, SLACK_APP_TOKEN: undefined });
      await service.onModuleInit();
      // Should not throw
      await service.sendMessage({ channelId: 'C123', threadTs: '1.1', message: 'Hello' });
    });

    it('handles send failure gracefully', async () => {
      const { service } = makeService();
      await service.onModuleInit();
      mockPostMessage.mockRejectedValueOnce(new Error('API error'));
      // Should not throw
      await service.sendMessage({ channelId: 'C123', threadTs: '1.1', message: 'Hello' });
    });
  });
});
