import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { ValueTransformer } from 'typeorm';

const PREFIX = 'enc:v1:';
const BINARY_PREFIX = Buffer.from('PPENC\x00\x01', 'latin1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const BINARY_HEADER_BYTES = BINARY_PREFIX.length + 4 + IV_BYTES + TAG_BYTES;

type Keyring = { activeVersion: number; keys: Map<number, Buffer> };

function keyring(): Keyring | null {
  const configured = process.env.MESSAGE_ENCRYPTION_KEYS?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT)
      return null;
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

export function encryptMessageText(value: string): string;
export function encryptMessageText(value: null): null;
export function encryptMessageText(value: undefined): undefined;
export function encryptMessageText(
  value: string | null | undefined,
): string | null | undefined;
export function encryptMessageText(
  value: string | null | undefined,
): string | null | undefined {
  if (value == null) return value;
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

export function decryptMessageText(value: string): string;
export function decryptMessageText(value: null): null;
export function decryptMessageText(value: undefined): undefined;
export function decryptMessageText(
  value: string | null | undefined,
): string | null | undefined;
export function decryptMessageText(
  value: string | null | undefined,
): string | null | undefined {
  if (value == null || !isEncryptedMessageText(value)) return value;
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

export function isEncryptedMessageBytes(value: Buffer): boolean {
  return (
    value.length >= BINARY_HEADER_BYTES &&
    value.subarray(0, BINARY_PREFIX.length).equals(BINARY_PREFIX)
  );
}

export function encryptMessageBytes(value: Buffer): Buffer {
  const ring = keyring();
  if (!ring) return value;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(
    'aes-256-gcm',
    ring.keys.get(ring.activeVersion)!,
    iv,
    { authTagLength: TAG_BYTES },
  );
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  const version = Buffer.alloc(4);
  version.writeUInt32BE(ring.activeVersion, 0);
  return Buffer.concat([
    BINARY_PREFIX,
    version,
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

export function decryptMessageBytes(value: Buffer): Buffer {
  if (!isEncryptedMessageBytes(value)) return value;
  const versionOffset = BINARY_PREFIX.length;
  const ivOffset = versionOffset + 4;
  const tagOffset = ivOffset + IV_BYTES;
  const version = value.readUInt32BE(versionOffset);
  const ring = keyring();
  const key = ring?.keys.get(version);
  if (!key) throw new Error(`Message encryption key ${version} is unavailable`);
  const iv = value.subarray(ivOffset, tagOffset);
  const tag = value.subarray(tagOffset, BINARY_HEADER_BYTES);
  const ciphertext = value.subarray(BINARY_HEADER_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: TAG_BYTES,
  });
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptMessageContent<T>(value: T): T {
  if (value == null || typeof value !== 'object' || Array.isArray(value))
    return value;
  const ring = keyring();
  if (!ring) return value;
  const next: Record<string, unknown> = {
    ...(value as Record<string, unknown>),
  };
  if (typeof next.fileName === 'string') {
    next.fileName = encryptMessageText(next.fileName);
  }
  if (
    next.replyTo &&
    typeof next.replyTo === 'object' &&
    !Array.isArray(next.replyTo)
  ) {
    const replyTo: Record<string, unknown> = {
      ...(next.replyTo as Record<string, unknown>),
    };
    if (typeof replyTo.excerpt === 'string') {
      replyTo.excerpt = encryptMessageText(replyTo.excerpt);
    }
    next.replyTo = replyTo;
  }
  if (typeof next.latitude === 'number' && typeof next.longitude === 'number') {
    next.coordinates = encryptMessageText(
      JSON.stringify({ latitude: next.latitude, longitude: next.longitude }),
    );
    delete next.latitude;
    delete next.longitude;
  }
  return next as T;
}

export function decryptMessageContent<T>(value: T): T {
  if (value == null || typeof value !== 'object' || Array.isArray(value))
    return value;
  const next: Record<string, unknown> = {
    ...(value as Record<string, unknown>),
  };
  if (typeof next.fileName === 'string') {
    next.fileName = decryptMessageText(next.fileName);
  }
  if (
    next.replyTo &&
    typeof next.replyTo === 'object' &&
    !Array.isArray(next.replyTo)
  ) {
    const replyTo: Record<string, unknown> = {
      ...(next.replyTo as Record<string, unknown>),
    };
    if (typeof replyTo.excerpt === 'string') {
      replyTo.excerpt = decryptMessageText(replyTo.excerpt);
    }
    next.replyTo = replyTo;
  }
  if (typeof next.coordinates === 'string') {
    const parsed = JSON.parse(decryptMessageText(next.coordinates)) as {
      latitude?: unknown;
      longitude?: unknown;
    };
    if (
      typeof parsed?.latitude !== 'number' ||
      typeof parsed?.longitude !== 'number'
    ) {
      throw new Error('Encrypted coordinates have an invalid payload');
    }
    next.latitude = parsed.latitude;
    next.longitude = parsed.longitude;
    delete next.coordinates;
  }
  return next as T;
}

export function needsMessageContentEncryption(value: unknown): boolean {
  if (value == null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (
    typeof record.fileName === 'string' &&
    !isEncryptedMessageText(record.fileName)
  )
    return true;
  if (
    record.replyTo &&
    typeof record.replyTo === 'object' &&
    !Array.isArray(record.replyTo)
  ) {
    const excerpt = (record.replyTo as Record<string, unknown>).excerpt;
    if (typeof excerpt === 'string' && !isEncryptedMessageText(excerpt))
      return true;
  }
  return (
    typeof record.latitude === 'number' && typeof record.longitude === 'number'
  );
}

export function backfillMessageContent(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...value };
  if (
    typeof next.fileName === 'string' &&
    !isEncryptedMessageText(next.fileName)
  ) {
    next.fileName = encryptMessageText(next.fileName);
  }
  if (
    next.replyTo &&
    typeof next.replyTo === 'object' &&
    !Array.isArray(next.replyTo)
  ) {
    const replyTo: Record<string, unknown> = {
      ...(next.replyTo as Record<string, unknown>),
    };
    if (
      typeof replyTo.excerpt === 'string' &&
      !isEncryptedMessageText(replyTo.excerpt)
    ) {
      replyTo.excerpt = encryptMessageText(replyTo.excerpt);
    }
    next.replyTo = replyTo;
  }
  if (typeof next.latitude === 'number' && typeof next.longitude === 'number') {
    next.coordinates = encryptMessageText(
      JSON.stringify({ latitude: next.latitude, longitude: next.longitude }),
    );
    delete next.latitude;
    delete next.longitude;
  }
  return next;
}

export const messageContentTransformer: ValueTransformer = {
  to: encryptMessageContent,
  from: decryptMessageContent,
};
