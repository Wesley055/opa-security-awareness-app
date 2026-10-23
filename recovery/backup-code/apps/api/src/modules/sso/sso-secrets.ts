import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'crypto';
import type { SecretReference } from './sso.contracts';
import { SsoDenied } from './sso.policy';

/** Versioned, context-bound envelopes. Key material comes only from server configuration. */
@Injectable()
export class SsoSecrets {
  constructor(private readonly config: ConfigService) {}
  private keys(): { active: string; keys: Record<string, string> } {
    const value = JSON.parse(
      this.config.getOrThrow<string>('SSO_ENCRYPTION_KEYS'),
    ) as { active: string; keys: Record<string, string> };
    if (
      !/^[a-zA-Z0-9_-]{1,40}$/.test(value.active) ||
      !/^[a-f0-9]{64}$/i.test(value.keys[value.active] ?? '')
    )
      throw new SsoDenied();
    return value;
  }
  seal(value: string, context: string): SecretReference {
    const keys = this.keys();
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(keys.keys[keys.active]!, 'hex'),
      iv,
    );
    cipher.setAAD(Buffer.from('OPA:SSO:v1:' + context));
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return {
      kind: 'envelope',
      keyReference: context,
      keyVersion: keys.active,
      ciphertext: [
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        encrypted.toString('base64url'),
      ].join('.'),
    };
  }
  open(ref: SecretReference, context: string): string {
    if (ref.kind !== 'envelope' || ref.keyReference !== context)
      throw new SsoDenied();
    const hex = this.keys().keys[ref.keyVersion];
    if (!hex || !/^[a-f0-9]{64}$/i.test(hex)) throw new SsoDenied();
    const parts = ref.ciphertext.split('.');
    if (parts.length !== 3) throw new SsoDenied();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(hex, 'hex'),
      Buffer.from(parts[0]!, 'base64url'),
    );
    decipher.setAAD(Buffer.from('OPA:SSO:v1:' + context));
    decipher.setAuthTag(Buffer.from(parts[1]!, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[2]!, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
  identityDigest(tuple: string): string {
    const key = this.config.getOrThrow<string>('SSO_LOOKUP_KEY');
    if (!/^[a-f0-9]{64}$/i.test(key)) throw new SsoDenied();
    return createHmac('sha256', Buffer.from(key, 'hex'))
      .update('OPA:SSO:identity:v1:')
      .update(tuple)
      .digest('hex');
  }
}
