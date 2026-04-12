import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectorRegistryService } from './connector-registry.service';
import { CredentialEncryptionService } from './credential-encryption.service';
import type { TriggerConnector } from '@finch/types';

export interface SlackMessageEvent {
  type: string;
  subtype?: string;
  text: string;
  channel: string;
  user: string;
  ts: string;
  thread_ts?: string;
}

@Injectable()
export class SlackConnectorService implements TriggerConnector, OnModuleInit {
  private readonly logger = new Logger(SlackConnectorService.name);
  private app: unknown = null;
  private initialized = false;

  constructor(
    private readonly config: ConfigService,
    private readonly registry: ConnectorRegistryService,
    private readonly encryption: CredentialEncryptionService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.registry.register('slack', 'trigger', this as never);

    const token = this.config.get<string>('SLACK_BOT_TOKEN');
    const appToken = this.config.get<string>('SLACK_APP_TOKEN');

    if (token && appToken) {
      try {
        const { App } = await import('@slack/bolt');
        this.app = new App({
          token,
          appToken,
          socketMode: true, // Socket Mode avoids port 3000 conflict
        });
        await (this.app as { start: () => Promise<void> }).start();
        this.initialized = true;
        this.logger.log('Slack connector initialized with Socket Mode');
      } catch (err) {
        this.logger.warn(`Slack initialization failed: ${(err as Error).message}`);
      }
    } else {
      this.logger.warn('Slack credentials not configured — connector disabled');
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  extractRawInput(event: SlackMessageEvent): {
    rawText: string;
    source: {
      type: string;
      channelId: string;
      messageId: string;
      threadTs: string;
      authorId: string;
      timestamp: string;
    };
  } {
    const prefix = this.config.get<string>('TRIGGER_PREFIX') ?? '@finch';
    const text = event.text.startsWith(prefix)
      ? event.text.slice(prefix.length).trim()
      : event.text;

    return {
      rawText: text,
      source: {
        type: 'slack',
        channelId: event.channel,
        messageId: event.ts,
        threadTs: event.thread_ts ?? event.ts,
        authorId: event.user,
        timestamp: new Date(Number(event.ts) * 1000).toISOString(),
      },
    };
  }

  shouldProcessMessage(event: SlackMessageEvent): boolean {
    // Ignore messages with subtype (bot messages, file uploads, join/leave)
    if (event.subtype) return false;

    const prefix = this.config.get<string>('TRIGGER_PREFIX') ?? '@finch';
    if (!event.text?.startsWith(prefix)) return false;

    return true;
  }

  isThreadReply(event: SlackMessageEvent): boolean {
    return !!event.thread_ts && event.thread_ts !== event.ts;
  }

  async sendMessage(params: {
    channelId: string;
    threadTs: string;
    message: string;
  }): Promise<void> {
    if (!this.app || !this.initialized) {
      this.logger.warn('Slack not initialized — message not sent');
      return;
    }

    try {
      const app = this.app as { client: { chat: { postMessage: (p: unknown) => Promise<void> } } };
      await app.client.chat.postMessage({
        channel: params.channelId,
        thread_ts: params.threadTs,
        text: params.message,
      });
    } catch (err) {
      this.logger.error(`Failed to send Slack message: ${(err as Error).message}`);
    }
  }
}
