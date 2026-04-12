import { describe, it, expect } from 'vitest';
import { ForcedGateError, ParseOutputError } from '../../src/agents/errors';

describe('ForcedGateError', () => {
  it('has correct name and message', () => {
    const err = new ForcedGateError('test message');
    expect(err.name).toBe('ForcedGateError');
    expect(err.message).toBe('test message');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('ParseOutputError', () => {
  it('has correct name and message', () => {
    const err = new ParseOutputError('parse failed');
    expect(err.name).toBe('ParseOutputError');
    expect(err.message).toBe('parse failed');
    expect(err).toBeInstanceOf(Error);
  });
});
