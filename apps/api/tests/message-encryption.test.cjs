const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const originalKeys = process.env.MESSAGE_ENCRYPTION_KEYS;
const originalMode = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
process.env.MESSAGE_ENCRYPTION_KEYS = `1:${'11'.repeat(32)}`;

const {
  decryptMessageText,
  encryptMessageText,
  isEncryptedMessageText,
} = require('../dist/modules/database/message-encryption');

after(() => {
  if (originalKeys === undefined) delete process.env.MESSAGE_ENCRYPTION_KEYS;
  else process.env.MESSAGE_ENCRYPTION_KEYS = originalKeys;
  if (originalMode === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalMode;
});

test('AES-256-GCM message envelopes round-trip and use a fresh nonce', () => {
  const first = encryptMessageText('Nội dung bí mật');
  const second = encryptMessageText('Nội dung bí mật');
  assert.ok(isEncryptedMessageText(first));
  assert.notEqual(first, second);
  assert.equal(decryptMessageText(first), 'Nội dung bí mật');
  assert.equal(decryptMessageText(second), 'Nội dung bí mật');
});

test('authenticated encryption rejects modified ciphertext', () => {
  const encrypted = encryptMessageText('không được sửa');
  const changed = `${encrypted.slice(0, -1)}${encrypted.endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() => decryptMessageText(changed));
});

test('old key versions remain readable while the highest version encrypts', () => {
  const oldEnvelope = encryptMessageText('tin cũ');
  process.env.MESSAGE_ENCRYPTION_KEYS = `1:${'11'.repeat(32)},2:${'22'.repeat(32)}`;
  const newEnvelope = encryptMessageText('tin mới');
  assert.match(newEnvelope, /^enc:v1:2:/);
  assert.equal(decryptMessageText(oldEnvelope), 'tin cũ');
  assert.equal(decryptMessageText(newEnvelope), 'tin mới');
});

test('legacy plaintext remains readable during migration', () => {
  assert.equal(decryptMessageText('dữ liệu cũ'), 'dữ liệu cũ');
  assert.equal(encryptMessageText(null), null);
});

test('nullable TypeORM columns preserve undefined without invoking crypto', () => {
  assert.equal(encryptMessageText(undefined), undefined);
  assert.equal(decryptMessageText(undefined), undefined);
});

test('plaintext resembling an envelope is still encrypted', () => {
  const plaintext = 'enc:v1:nội dung người dùng';
  assert.equal(decryptMessageText(encryptMessageText(plaintext)), plaintext);
});
