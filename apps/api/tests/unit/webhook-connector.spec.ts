import { describe, it, expect, vi } from 'vitest';
import { WebhookConnectorService } from '../../src/connectors/webhook-connector.service';

describe('WebhookConnectorService', () => {
  it('sendMessage logs the message without error', async () => {
    const service = new WebhookConnectorService();
    // Should not throw — stub just logs
    await expect(
      service.sendMessage({
        channelId: 'ch1',
        threadTs: 'ts1',
        message: 'Hello from gate',
      }),
    ).resolves.toBeUndefined();
  });

  it('sendMessage handles various input', async () => {
    const service = new WebhookConnectorService();
    await expect(
      service.sendMessage({
        channelId: '',
        threadTs: '',
        message: '',
      }),
    ).resolves.toBeUndefined();
  });
});
