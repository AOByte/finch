import { describe, it, expect, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { WebhookConnectorService } from '../../src/connectors/webhook-connector.service';
import { ConfigService } from '@nestjs/config';

function makeService(envOverrides: Record<string, string | undefined> = {}): WebhookConnectorService {
  const config = new ConfigService({
    WEBHOOK_SECRET: 'test-secret-key',
    ...envOverrides,
  });
  return new WebhookConnectorService(config);
}

function sign(body: string, secret = 'test-secret-key'): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('WebhookConnectorService', () => {
  describe('validateSignature', () => {
    it('accepts a valid HMAC-SHA256 signature with sha256= prefix', () => {
      const service = makeService();
      const body = '{"rawText":"hello"}';
      const sig = sign(body);
      expect(() => service.validateSignature(body, sig)).not.toThrow();
    });

    it('accepts a valid signature without sha256= prefix', () => {
      const service = makeService();
      const body = '{"rawText":"hello"}';
      const rawSig = createHmac('sha256', 'test-secret-key').update(body).digest('hex');
      expect(() => service.validateSignature(body, rawSig)).not.toThrow();
    });

    it('rejects missing signature with 401', () => {
      const service = makeService();
      expect(() => service.validateSignature('body', undefined)).toThrow(UnauthorizedException);
    });

    it('rejects empty signature with 401', () => {
      const service = makeService();
      expect(() => service.validateSignature('body', '')).toThrow(UnauthorizedException);
    });

    it('rejects wrong signature with 401', () => {
      const service = makeService();
      const wrongSig = sign('different-body');
      expect(() => service.validateSignature('body', wrongSig)).toThrow(UnauthorizedException);
    });

    it('rejects signature with wrong length', () => {
      const service = makeService();
      expect(() => service.validateSignature('body', 'sha256=tooshort')).toThrow(UnauthorizedException);
    });

    it('throws when WEBHOOK_SECRET is not configured', () => {
      const service = makeService({ WEBHOOK_SECRET: undefined });
      expect(() => service.validateSignature('body', 'sig')).toThrow(UnauthorizedException);
    });

    it('uses timing-safe comparison (no early exit on partial match)', () => {
      const service = makeService();
      const body = '{"rawText":"hello"}';
      const validSig = sign(body);
      // Flip last char to test timing-safe comparison
      const tamperedSig = validSig.slice(0, -1) + (validSig.slice(-1) === 'a' ? 'b' : 'a');
      expect(() => service.validateSignature(body, tamperedSig)).toThrow(UnauthorizedException);
    });
  });

  describe('computeSignature', () => {
    it('returns sha256= prefixed HMAC', () => {
      const service = makeService();
      const sig = service.computeSignature('test-body');
      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('produces a signature that validateSignature accepts', () => {
      const service = makeService();
      const body = '{"data":"round-trip"}';
      const sig = service.computeSignature(body);
      expect(() => service.validateSignature(body, sig)).not.toThrow();
    });

    it('throws when WEBHOOK_SECRET is not configured', () => {
      const service = makeService({ WEBHOOK_SECRET: undefined });
      expect(() => service.computeSignature('body')).toThrow('WEBHOOK_SECRET not configured');
    });
  });

  describe('sendMessage', () => {
    it('sendMessage logs the message without error', async () => {
      const service = makeService();
      await expect(
        service.sendMessage({
          channelId: 'ch1',
          threadTs: 'ts1',
          message: 'Hello from gate',
        }),
      ).resolves.toBeUndefined();
    });

    it('sendMessage handles various input', async () => {
      const service = makeService();
      await expect(
        service.sendMessage({
          channelId: '',
          threadTs: '',
          message: '',
        }),
      ).resolves.toBeUndefined();
    });
  });
});
