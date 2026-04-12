import { Injectable, Logger } from '@nestjs/common';
import type { TriggerConnector } from '@finch/types';

@Injectable()
export class WebhookConnectorService implements TriggerConnector {
  private readonly logger = new Logger(WebhookConnectorService.name);

  async sendMessage(params: {
    channelId: string;
    threadTs: string;
    message: string;
  }): Promise<void> {
    // Stub: logs the message. Real implementation in Wave 4.
    this.logger.log(
      `[WebhookConnector] sendMessage to channel=${params.channelId} thread=${params.threadTs}: ${params.message}`,
    );
  }
}
