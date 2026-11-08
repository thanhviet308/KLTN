import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';
import type { ValueTransformer } from 'typeorm';

const PREFIX = 'enc:v1:';
const IV_BYTES = 12;
const TAG_BYTES = 16;

type Keyring = { activeVersion: number; keys: Map<number, Buffer> };

function keyring(): Keyring | null {
  const configured = process.env.MESSAGE_ENCRYPTION_KEYS?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === 'test') return null;
    throw new Error(
      'MESSAGE_ENCRYPTION_KEYS is required to encrypt stored messages',
    );
  }

  const keys = new Map<number, Buffer>();
  for (const entry of configured.split(',')) {
    const match = /^(\d+):([a-f0-9]{64})$/.exec(entry.trim());
    if (!match) throw new Error('MESSAGE_ENCRYPTION_KEYS is invalid');
    const version = Number(match[1]);
    if (!Number.isSafeInteger(version) || version < 1 || keys.has(version))
      throw new Error('MESSAGE_ENCRYPTION_KEYS contains an invalid version');
    keys.set(version, Buffer.from(match[2]!, 'hex'));
  }
  if (!keys.size) throw new Error('MESSAGE_ENCRYPTION_KEYS is empty');
  return { activeVersion: Math.max(...keys.keys()), keys };
}

function encode(value: Buffer): string {
  return value.toString('base64url');
}

export function isEncryptedMessageText(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptMessageText(value: string | null): string | null {
  if (value === null) return value;
  const ring = keyring();
  // Unit tests that construct repositories without application configuration
  // remain plaintext. Development and production always require a real key.
  if (!ring) return value;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(
    'aes-256-gcm',
    ring.keys.get(ring.activeVersion)!,
    iv,
    { authTagLength: TAG_BYTES },
  );
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  return [
    'enc',
    'v1',
    String(ring.activeVersion),
    encode(iv),
    encode(cipher.getAuthTag()),
    encode(ciphertext),
  ].join(':');
}

export function decryptMessageText(value: string | null): string | null {
  if (value === null || !isEncryptedMessageText(value)) return value;
  const parts = value.split(':');
  if (parts.length !== 6 || parts[0] !== 'enc' || parts[1] !== 'v1')
    throw new Error('Encrypted message has an invalid envelope');
  const version = Number(parts[2]);
  const ring = keyring();
  const key = ring?.keys.get(version);
  if (!key) throw new Error(`Message encryption key ${version} is unavailable`);
  const iv = Buffer.from(parts[3]!, 'base64url');
  const tag = Buffer.from(parts[4]!, 'base64url');
  const ciphertext = Buffer.from(parts[5]!, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES)
    throw new Error('Encrypted message has an invalid envelope');
  const decipher = createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8');
}

export const messageTextTransformer: ValueTransformer = {
  to: encryptMessageText,
  from: decryptMessageText,
};
