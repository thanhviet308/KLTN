const { test, after } = require('node:test');
const assert = require('node:assert/strict');

const originalKeys = process.env.MESSAGE_ENCRYPTION_KEYS;
const originalMode = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
process.env.MESSAGE_ENCRYPTION_KEYS = `1:${'11'.repeat(32)}`;

const {
  backfillMessageContent,
  decryptMessageBytes,
  decryptMessageContent,
  decryptMessageText,
  encryptMessageBytes,
  encryptMessageContent,
  encryptMessageText,
  isEncryptedMessageBytes,
  isEncryptedMessageText,
  needsMessageContentEncryption,
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

test('binary files are encrypted with AES-256-GCM, reject tampering, support key rotation, and read legacy unencrypted files', () => {
  process.env.MESSAGE_ENCRYPTION_KEYS = `1:${'11'.repeat(32)}`;
  const raw = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0xaa, 0xff, 0x10]);
  const first = encryptMessageBytes(raw);
  const second = encryptMessageBytes(raw);
  assert.ok(isEncryptedMessageBytes(first));
  assert.notDeepEqual(first, second);
  assert.ok(!first.includes(raw));
  assert.deepEqual(decryptMessageBytes(first), raw);
  assert.deepEqual(decryptMessageBytes(second), raw);

  const tampered = Buffer.from(first);
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => decryptMessageBytes(tampered));

  process.env.MESSAGE_ENCRYPTION_KEYS = `1:${'11'.repeat(32)},2:${'22'.repeat(32)}`;
  const rotated = encryptMessageBytes(raw);
  assert.equal(rotated.readUInt32BE(7), 2);
  assert.deepEqual(decryptMessageBytes(first), raw);
  assert.deepEqual(decryptMessageBytes(rotated), raw);

  const legacyFile = Buffer.from('legacy unencrypted chat attachment');
  assert.equal(isEncryptedMessageBytes(legacyFile), false);
  assert.deepEqual(decryptMessageBytes(legacyFile), legacyFile);

  const magicLookalike = Buffer.concat([
    Buffer.from('PPENC\x00\x01', 'latin1'),
    Buffer.from('user file payload matching magic bytes'),
  ]);
  assert.deepEqual(
    decryptMessageBytes(encryptMessageBytes(magicLookalike)),
    magicLookalike,
  );
});

test('message JSONB metadata encrypts filenames, reply excerpts, and location coordinates while preserving shape', () => {
  process.env.MESSAGE_ENCRYPTION_KEYS = `1:${'11'.repeat(32)}`;
  const fileContent = {
    attachmentId: '10000000-0000-4000-8000-000000000001',
    fileName: 'bao-cao-tot-nghiep.pdf',
    mimeType: 'application/pdf',
    size: 4096,
    sha256: 'ab'.repeat(32),
    replyTo: {
      messageId: '20000000-0000-4000-8000-000000000002',
      senderId: '30000000-0000-4000-8000-000000000003',
      type: 'text',
      excerpt: 'Nhớ gửi file báo cáo nhé',
    },
  };
  const storedFile = encryptMessageContent(fileContent);
  assert.equal(storedFile.attachmentId, fileContent.attachmentId);
  assert.ok(isEncryptedMessageText(storedFile.fileName));
  assert.ok(isEncryptedMessageText(storedFile.replyTo.excerpt));
  assert.equal(fileContent.fileName, 'bao-cao-tot-nghiep.pdf');
  assert.deepEqual(decryptMessageContent(storedFile), fileContent);

  const locationContent = {
    latitude: 10.7769,
    longitude: 106.7009,
  };
  const storedLocation = encryptMessageContent(locationContent);
  assert.equal(storedLocation.latitude, undefined);
  assert.equal(storedLocation.longitude, undefined);
  assert.ok(isEncryptedMessageText(storedLocation.coordinates));
  assert.deepEqual(decryptMessageContent(storedLocation), locationContent);

  // Legacy unencrypted metadata continues to hydrate cleanly
  assert.deepEqual(decryptMessageContent(fileContent), fileContent);
  assert.deepEqual(decryptMessageContent(locationContent), locationContent);

  // Backfill is idempotent
  assert.equal(needsMessageContentEncryption(fileContent), true);
  assert.equal(needsMessageContentEncryption(locationContent), true);
  const backfilled = backfillMessageContent(locationContent);
  assert.equal(needsMessageContentEncryption(backfilled), false);
  assert.deepEqual(decryptMessageContent(backfilled), locationContent);
});
