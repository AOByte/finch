import { describe, it, expect } from 'vitest';
import { CredentialEncryptionService } from '../../src/connectors/credential-encryption.service';

describe('CredentialEncryptionService', () => {
  // Valid 64-hex-char key (32 bytes)
  const validKey = 'a'.repeat(64);

  const makeConfig = (key?: string) => ({
    get: <T = string>(k: string): T | undefined => {
      if (k === 'ENCRYPTION_KEY') return key as T | undefined;
      return undefined;
    },
  });

  it('constructor throws if ENCRYPTION_KEY is missing', () => {
    expect(() => new CredentialEncryptionService(makeConfig() as never)).toThrow(
      'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)',
    );
  });

  it('constructor throws if ENCRYPTION_KEY is wrong length', () => {
    expect(() => new CredentialEncryptionService(makeConfig('abcd') as never)).toThrow(
      'ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)',
    );
  });

  it('constructor succeeds with valid 64-hex-char key', () => {
    expect(() => new CredentialEncryptionService(makeConfig(validKey) as never)).not.toThrow();
  });

  it('encrypt returns a JSON string with iv, data, authTag', () => {
    const service = new CredentialEncryptionService(makeConfig(validKey) as never);
    const encrypted = service.encrypt('hello world');
    const parsed = JSON.parse(encrypted) as { iv: string; data: string; authTag: string };
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('data');
    expect(parsed).toHaveProperty('authTag');
    expect(typeof parsed.iv).toBe('string');
    expect(typeof parsed.data).toBe('string');
    expect(typeof parsed.authTag).toBe('string');
  });

  it('encrypt produces different ciphertexts for the same plaintext (random IV)', () => {
    const service = new CredentialEncryptionService(makeConfig(validKey) as never);
    const a = service.encrypt('same text');
    const b = service.encrypt('same text');
    expect(a).not.toBe(b);
  });

  it('decrypt reverses encrypt (round-trip)', () => {
    const service = new CredentialEncryptionService(makeConfig(validKey) as never);
    const plaintext = 'my secret API key 🔑';
    const encrypted = service.encrypt(plaintext);
    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('decrypt handles empty string', () => {
    const service = new CredentialEncryptionService(makeConfig(validKey) as never);
    const encrypted = service.encrypt('');
    expect(service.decrypt(encrypted)).toBe('');
  });

  it('decrypt handles long strings', () => {
    const service = new CredentialEncryptionService(makeConfig(validKey) as never);
    const longText = 'x'.repeat(10000);
    const encrypted = service.encrypt(longText);
    expect(service.decrypt(encrypted)).toBe(longText);
  });

  it('decrypt throws on tampered ciphertext', () => {
    const service = new CredentialEncryptionService(makeConfig(validKey) as never);
    const encrypted = service.encrypt('secret');
    const parsed = JSON.parse(encrypted) as { iv: string; data: string; authTag: string };
    parsed.data = 'ff'.repeat(16); // tampered data
    const tampered = JSON.stringify(parsed);
    expect(() => service.decrypt(tampered)).toThrow();
  });

  it('decrypt throws on invalid JSON', () => {
    const service = new CredentialEncryptionService(makeConfig(validKey) as never);
    expect(() => service.decrypt('not json')).toThrow();
  });

  it('decrypt with wrong key fails', () => {
    const service1 = new CredentialEncryptionService(makeConfig(validKey) as never);
    const service2 = new CredentialEncryptionService(makeConfig('b'.repeat(64)) as never);
    const encrypted = service1.encrypt('secret');
    expect(() => service2.decrypt(encrypted)).toThrow();
  });
});
