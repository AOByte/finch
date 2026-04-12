import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

@Injectable()
export class CredentialEncryptionService {
  private readonly algorithm = 'aes-256-gcm' as const;
  private readonly keyBuffer: Buffer;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('ENCRYPTION_KEY');
    if (!key || key.length !== 64) {
      throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)');
    }
    this.keyBuffer = Buffer.from(key, 'hex');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.keyBuffer, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return JSON.stringify({
      iv: iv.toString('hex'),
      data: encrypted.toString('hex'),
      authTag: cipher.getAuthTag().toString('hex'),
    });
  }

  decrypt(ciphertext: string): string {
    const { iv, data, authTag } = JSON.parse(ciphertext) as {
      iv: string;
      data: string;
      authTag: string;
    };
    const decipher = createDecipheriv(this.algorithm, this.keyBuffer, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }
}
