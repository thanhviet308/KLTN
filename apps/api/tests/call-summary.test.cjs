const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
require('reflect-metadata');
const {
  CallSummaryService,
  callSummaryRequestId,
} = require('../dist/modules/calls/call-summary.service');
const { Call } = require('../dist/modules/database/entities/call.entity');
const { Message } = require('../dist/modules/database/entities/message.entity');

const bytes = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from('webm test audio'),
]);
function request(audio = bytes, mime = 'audio/webm;codecs=opus') {
  const stream = Readable.from([audio]);
  stream.headers = { 'content-type': mime };
  return stream;
}
function fixture(overrides = {}) {
  const call = {
    id: 'call',
    initiatorId: 'alice',
    conversationId: 'chat',
    status: 'ended',
    summaryEnabled: true,
    ...overrides,
  };
  let existing = null;
  const generated = [];
  const sent = [];
  const db = {
    getRepository: (entity) => ({
      findOneBy: async () =>
        entity === Call
          ? call
          : entity === Message
            ? existing
            : { userId: 'alice' },
    }),
  };
  const provider = {
    available: () => true,
    summarizeCallAudio: async (...args) => {
      generated.push(args);
      return {
        summary: 'Thảo luận giao diện.',
        decisions: ['Dùng màu xanh.'],
        tasks: ['Hoàn thành giao diện.'],
      };
    },
  };
  const messages = {
    send: async (...args) => {
      sent.push(args);
      existing = { id: 'summary-message' };
      return { message: existing };
    },
  };
  return {
    service: new CallSummaryService(db, provider, messages),
    generated,
    sent,
    provider,
  };
}

test('only the call initiator may upload; rejected requests never invoke AI', async () => {
  const f = fixture();
  const upload = request();
  await assert.rejects(
    f.service.summarize('bob', 'call', upload),
    (e) => e.getStatus() === 404,
  );
  assert.equal(upload.readableDidRead, false);
  assert.equal(f.generated.length, 0);
  upload.destroy();
});

test('active, missed and non-enabled calls cannot be summarized', async () => {
  for (const overrides of [
    { status: 'active' },
    { status: 'missed' },
    { summaryEnabled: false },
  ]) {
    const f = fixture(overrides);
    const upload = request();
    await assert.rejects(
      f.service.summarize('alice', 'call', upload),
      (e) => e.getStatus() === 409,
    );
    assert.equal(f.generated.length, 0);
    upload.destroy();
  }
});

test('ended call produces a chat message and retry does not call AI twice', async () => {
  const f = fixture();
  await f.service.summarize('alice', 'call', request());
  assert.deepEqual(f.generated[0], [bytes, 'audio/webm']);
  assert.equal(f.sent[0][1], 'chat');
  assert.match(f.sent[0][2].body, /Tóm tắt cuộc gọi · AI/);
  assert.match(f.sent[0][2].body, /Quyết định:/);
  assert.match(f.sent[0][2].body, /Việc cần làm:/);
  const retry = request();
  assert.deepEqual(await f.service.summarize('alice', 'call', retry), {
    messageId: 'summary-message',
  });
  assert.equal(f.generated.length, 1);
  assert.equal(f.sent.length, 1);
  retry.destroy();
});

test('invalid and oversized audio is rejected before sending to provider', async () => {
  const unsupported = request(bytes, 'audio/ogg;codecs=opus');
  const fUnsupported = fixture();
  await assert.rejects(
    fUnsupported.service.summarize('alice', 'call', unsupported),
    (e) => e.getStatus() === 415,
  );
  assert.equal(unsupported.readableDidRead, false);
  unsupported.destroy();

  const abortedStream = new Readable({
    read() {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      this.destroy(err);
    },
  });
  abortedStream.headers = { 'content-type': 'audio/webm;codecs=opus' };
  const fAborted = fixture();
  await assert.rejects(
    fAborted.service.summarize('alice', 'call', abortedStream),
    (e) => e.getStatus() === 408 && e.getResponse().code === 'UPLOAD_TIMEOUT',
  );

  for (const upload of [
    request(Buffer.from('invalid')),
    request(Buffer.alloc(0)),
    request(Buffer.alloc(8 * 1024 * 1024 + 1)),
  ]) {
    const f = fixture();
    await assert.rejects(f.service.summarize('alice', 'call', upload), (e) =>
      [400, 413].includes(e.getStatus()),
    );
    assert.equal(f.generated.length, 0);
  }
});

test('failed provider request releases the busy slot for retry', async () => {
  const f = fixture();
  const original = f.provider.summarizeCallAudio;
  f.provider.summarizeCallAudio = async () => {
    throw new Error('provider unavailable');
  };
  await assert.rejects(
    f.service.summarize('alice', 'call', request()),
    /provider unavailable/,
  );
  f.provider.summarizeCallAudio = original;
  await f.service.summarize('alice', 'call', request());
  assert.equal(f.sent.length, 1);
});

test('summary id is stable, a valid v4 UUID, and distinct between calls', () => {
  assert.equal(callSummaryRequestId('one'), callSummaryRequestId('one'));
  assert.notEqual(callSummaryRequestId('one'), callSummaryRequestId('two'));
  assert.match(
    callSummaryRequestId('one'),
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
});

test('repeated provider failures are limited to twenty paid attempts per hour', async () => {
  const f = fixture();
  let attempts = 0;
  f.provider.summarizeCallAudio = async () => {
    attempts++;
    throw new Error('provider unavailable');
  };
  for (let index = 0; index < 20; index++) {
    await assert.rejects(
      f.service.summarize('alice', 'call', request()),
      /provider unavailable/,
    );
  }
  await assert.rejects(
    f.service.summarize('alice', 'call', request()),
    (error) => error.getResponse().code === 'AI_QUOTA_EXCEEDED',
  );
  assert.equal(attempts, 20);
});

test('designated fallback web recorder may upload summary when Android initiated the call', async () => {
  const f = fixture({
    initiatorId: 'android-caller',
    summaryRecorderId: 'web-callee',
    summaryEnabled: true,
  });
  const unauthorized = request();
  await assert.rejects(
    f.service.summarize('android-caller', 'call', unauthorized),
    (e) => e.getStatus() === 404,
  );
  assert.equal(unauthorized.readableDidRead, false);
  unauthorized.destroy();

  const authorized = await f.service.summarize('web-callee', 'call', request());
  assert.equal(authorized.messageId, 'summary-message');
  assert.equal(f.generated.length, 1);
  assert.equal(f.sent[0][0], 'web-callee');
});
