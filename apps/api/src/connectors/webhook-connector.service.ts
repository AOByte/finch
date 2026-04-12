import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { TriggerConnector } from '@finch/types';

@Injectable()
export class WebhookConnectorService implements TriggerConnector {
  private readonly logger = new Logger(WebhookConnectorService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Validate X-Finch-Signature header using HMAC-SHA256 with timing-safe comparison.
   * Rejects unsigned or incorrectly signed requests with 401.
   */
  validateSignature(body: string, signature: string | undefined): void {
    const secret = this.config.get<string>('WEBHOOK_SECRET');
    if (!secret) {
      throw new UnauthorizedException('WEBHOOK_SECRET not configured');
    }

    if (!signature) {
      throw new UnauthorizedException('Missing X-Finch-Signature header');
    }

    const expected = createHmac('sha256', secret).update(body).digest('hex');
    const sig = signature.startsWith('sha256=') ? signature.slice(7) : signature;

    if (sig.length !== expected.length) {
      throw new UnauthorizedException('Invalid signature');
    }

    const isValid = timingSafeEqual(
      Buffer.from(sig, 'hex'),
      Buffer.from(expected, 'hex'),
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid signature');
    }

    this.logger.debug('Webhook signature validated successfully');
  }

  /**
   * Compute HMAC-SHA256 signature for a given body.
   */
  computeSignature(body: string): string {
    const secret = this.config.get<string>('WEBHOOK_SECRET');
    if (!secret) {
      throw new Error('WEBHOOK_SECRET not configured');
    }
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  }

  async sendMessage(params: {
    channelId: string;
    threadTs: string;
    message: string;
  }): Promise<void> {
    this.logger.log(
      `[WebhookConnector] sendMessage to channel=${params.channelId} thread=${params.threadTs}: ${params.message}`,
    );
  }
}
