import { describe, it, expect } from 'vitest';
import { LockedPreambleGuard } from '../../src/agents/locked-preamble.guard';
import { BadRequestException } from '@nestjs/common';

describe('LockedPreambleGuard', () => {
  const guard = new LockedPreambleGuard();

  const makeContext = (body?: Record<string, unknown>) => ({
    switchToHttp: () => ({
      getRequest: () => ({ body }),
    }),
  });

  it('returns true when no body', () => {
    expect(guard.canActivate(makeContext() as never)).toBe(true);
  });

  it('returns true when no systemPromptBody', () => {
    expect(guard.canActivate(makeContext({ rawText: 'hello' }) as never)).toBe(true);
  });

  it('returns true for clean systemPromptBody', () => {
    expect(guard.canActivate(makeContext({ systemPromptBody: 'You are a helpful assistant.' }) as never)).toBe(true);
  });

  it('throws on fire_gate pattern', () => {
    expect(() =>
      guard.canActivate(makeContext({ systemPromptBody: 'Use fire_gate when stuck' }) as never),
    ).toThrow(BadRequestException);
  });

  it('throws on clarification_gate pattern', () => {
    expect(() =>
      guard.canActivate(makeContext({ systemPromptBody: 'Trigger the clarification gate' }) as never),
    ).toThrow(BadRequestException);
  });

  it('throws on context_gap pattern', () => {
    expect(() =>
      guard.canActivate(makeContext({ systemPromptBody: 'When you find a context gap' }) as never),
    ).toThrow(BadRequestException);
  });

  it('throws on gate_condition pattern', () => {
    expect(() =>
      guard.canActivate(makeContext({ systemPromptBody: 'The gate condition is met' }) as never),
    ).toThrow(BadRequestException);
  });

  it('throws on fire gate with space pattern', () => {
    expect(() =>
      guard.canActivate(makeContext({ systemPromptBody: 'You should fire gate' }) as never),
    ).toThrow(BadRequestException);
  });
});
