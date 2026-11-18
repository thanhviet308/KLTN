const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
require('reflect-metadata');
const {
  CallSummaryService,
  callSummaryRequestId,
} = require('../dist/modules/calls/call-summary.service');
const {
  isEncryptedMessageBytes,
} = require('../dist/modules/database/message-encryption');
const { Call } = require('../dist/modules/database/entities/call.entity');
const {
  ConversationMember,
} = require('../dist/modules/database/entities/conversation-member.entity');
const {
  ConversationMemberPeriod,
} = require('../dist/modules/database/entities/conversation-member-period.entity');
const { Message } = require('../dist/modules/database/entities/message.entity');
const {
  ChatFilesService,
} = require('../dist/modules/messages/chat-files.service');

const bytes = Buffer.concat([
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
  Buffer.from('webm test audio'),
]);

function request(audio = bytes, mime = 'audio/webm;codecs=opus') {
  const stream = Readable.from([audio]);
  stream.headers = { 'content-type': mime };
  return stream;
}

async function createFixture(overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'pingpong-call-summary-'));
  const previousDir = process.env.CHAT_FILES_DIR;
  process.env.CHAT_FILES_DIR = dir;
  const files = new ChatFilesService();
  if (previousDir === undefined) delete process.env.CHAT_FILES_DIR;
  else process.env.CHAT_FILES_DIR = previousDir;

  const createdAt = new Date('2026-11-18T00:00:00.000Z');
  const call = {
    id: 'call',
    initiatorId: 'alice',
    conversationId: 'chat',
    status: 'ended',
    summaryEnabled: true,
    summaryRecorderId: null,
    summaryAudioKey: null,
    summaryAudioMime: null,
    summaryPayload: null,
    ...overrides,
  };
  const callMessage = {
    id: 'call-msg',
    conversationId: call.conversationId,
    senderId: call.initiatorId,
    clientMessageId: call.id,
    sequence: '10',
    type: 'call',
    body: null,
    content: {
      callId: call.id,
      callType: 'video',
      callStatus: 'ended',
      durationSeconds: 87,
    },
    createdAt,
    editedAt: null,
    deletedAt: null,
  };
  const members = new Map([
    [
      'alice',
      { conversationId: 'chat', userId: 'alice', clearedAfterSequence: '0' },
    ],
    [
      'bob',
      { conversationId: 'chat', userId: 'bob', clearedAfterSequence: '0' },
    ],
  ]);
  const periods = new Map([
    [
      'alice',
      [
        {
          conversationId: 'chat',
          userId: 'alice',
          joinedAt: new Date(0),
          leftAt: null,
        },
      ],
    ],
    [
      'bob',
      [
        {
          conversationId: 'chat',
          userId: 'bob',
          joinedAt: new Date(0),
          leftAt: null,
        },
      ],
    ],
  ]);

  const generated = [];
  const published = [];

  const getRepository = (entity) => {
    if (entity === Call) {
      return {
        findOneBy: async ({ id }) => (id === call.id ? call : null),
        findOne: async ({ where }) => (where.id === call.id ? call : null),
        save: async (next) => Object.assign(call, next),
      };
    }
    if (entity === ConversationMemberPeriod) {
      return {
        findOneBy: async ({ userId }) =>
          (periods.get(userId) ?? []).find((p) => p.leftAt === null) ?? null,
        find: async ({ where }) => periods.get(where.userId) ?? [],
      };
    }
    if (entity === ConversationMember) {
      return {
        findOneBy: async ({ userId }) => members.get(userId) ?? null,
      };
    }
    if (entity === Message) {
      return {
        findOneBy: async () => (callMessage.deletedAt ? null : callMessage),
        save: async (next) => Object.assign(callMessage, next),
      };
    }
    throw new Error(`Unexpected entity: ${entity.name}`);
  };

  const db = {
    getRepository,
    transaction: async (fn) => fn({ getRepository }),
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
  const events = {
    publish: (event) => published.push(event),
  };

  return {
    service: new CallSummaryService(db, provider, files, events),
    files,
    call,
    callMessage,
    members,
    periods,
    generated,
    published,
    provider,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

test('only the designated recorder may upload audio, and upload never invokes AI automatically', async (t) => {
  const f = await createFixture();
  t.after(f.cleanup);

  const unauthorized = request();
  await assert.rejects(
    f.service.uploadRecording('bob', 'call', unauthorized),
    (e) => e.getStatus() === 404,
  );
  assert.equal(unauthorized.readableDidRead, false);
  unauthorized.destroy();

  const saved = await f.service.uploadRecording('alice', 'call', request());
  assert.equal(saved.summaryAvailable, true);
  assert.equal(f.callMessage.content.summaryAvailable, true);
  assert.equal(f.published.length, 1);
  assert.equal(f.published[0].name, 'message:updated');
  assert.equal(f.generated.length, 0);
});

test('designated fallback web recorder may upload audio when Android initiated the call', async (t) => {
  const f = await createFixture({
    initiatorId: 'android-caller',
    summaryRecorderId: 'bob',
    summaryEnabled: true,
  });
  t.after(f.cleanup);

  const unauthorized = request();
  await assert.rejects(
    f.service.uploadRecording('android-caller', 'call', unauthorized),
    (e) => e.getStatus() === 404,
  );
  assert.equal(unauthorized.readableDidRead, false);
  unauthorized.destroy();

  const authorized = await f.service.uploadRecording('bob', 'call', request());
  assert.equal(authorized.summaryAvailable, true);
  assert.equal(f.generated.length, 0);
});

test('active, missed and non-enabled calls cannot upload recordings or summarize', async (t) => {
  for (const overrides of [
    { status: 'active' },
    { status: 'missed' },
    { summaryEnabled: false },
  ]) {
    const f = await createFixture(overrides);
    t.after(f.cleanup);
    const upload = request();
    await assert.rejects(
      f.service.uploadRecording('alice', 'call', upload),
      (e) => e.getStatus() === 409,
    );
    await assert.rejects(
      f.service.summarize('alice', 'call'),
      (e) => e.getStatus() === 409,
    );
    assert.equal(f.generated.length, 0);
    upload.destroy();
  }
});

test('any authorized member can request summary on demand and repeat clicks reuse cache without calling AI twice', async (t) => {
  const f = await createFixture();
  t.after(f.cleanup);

  await f.service.uploadRecording('alice', 'call', request());
  assert.equal(f.generated.length, 0);

  const bobView = await f.service.summarize('bob', 'call');
  assert.deepEqual(bobView.result, {
    summary: 'Thảo luận giao diện.',
    decisions: ['Dùng màu xanh.'],
    tasks: ['Hoàn thành giao diện.'],
  });
  assert.equal(f.generated.length, 1);
  assert.deepEqual(f.generated[0], [bytes, 'audio/webm']);

  const aliceView = await f.service.summarize('alice', 'call');
  assert.deepEqual(aliceView.result, bobView.result);
  assert.equal(f.generated.length, 1);

  // Outsider or member who cleared history past the call cannot access summary.
  await assert.rejects(
    f.service.summarize('stranger', 'call'),
    (e) => e.getStatus() === 404,
  );
  f.members.set('bob', {
    conversationId: 'chat',
    userId: 'bob',
    clearedAfterSequence: '10',
  });
  await assert.rejects(
    f.service.summarize('bob', 'call'),
    (e) => e.getStatus() === 404,
  );
});

test('invalid and oversized audio is rejected before saving', async (t) => {
  const f = await createFixture();
  t.after(f.cleanup);

  const unsupported = request(bytes, 'audio/ogg;codecs=opus');
  await assert.rejects(
    f.service.uploadRecording('alice', 'call', unsupported),
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
  await assert.rejects(
    f.service.uploadRecording('alice', 'call', abortedStream),
    (e) => e.getStatus() === 408 && e.getResponse().code === 'UPLOAD_TIMEOUT',
  );

  for (const upload of [
    request(Buffer.from('invalid')),
    request(Buffer.alloc(0)),
    request(Buffer.alloc(8 * 1024 * 1024 + 1)),
  ]) {
    await assert.rejects(
      f.service.uploadRecording('alice', 'call', upload),
      (e) => [400, 413].includes(e.getStatus()),
    );
  }
  assert.equal(f.call.summaryAudioKey, null);
});

test('failed provider request releases the busy slot for retry and respects hourly quota', async (t) => {
  const f = await createFixture();
  t.after(f.cleanup);
  await f.service.uploadRecording('alice', 'call', request());

  let attempts = 0;
  f.provider.summarizeCallAudio = async () => {
    attempts++;
    throw new Error('provider unavailable');
  };
  for (let index = 0; index < 20; index++) {
    await assert.rejects(
      f.service.summarize('alice', 'call'),
      /provider unavailable/,
    );
  }
  await assert.rejects(
    f.service.summarize('alice', 'call'),
    (error) => error.getResponse().code === 'AI_QUOTA_EXCEEDED',
  );
  assert.equal(attempts, 20);
});

test('summary id is stable, a valid v4 UUID, and distinct between calls', () => {
  assert.equal(callSummaryRequestId('one'), callSummaryRequestId('one'));
  assert.notEqual(callSummaryRequestId('one'), callSummaryRequestId('two'));
  assert.match(
    callSummaryRequestId('one'),
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
});

test('call recording audio is encrypted at rest on disk and decrypted in memory when summarizing', async (t) => {
  const prevKeys = process.env.MESSAGE_ENCRYPTION_KEYS;
  process.env.MESSAGE_ENCRYPTION_KEYS = `1:${'33'.repeat(32)}`;
  const f = await createFixture();
  t.after(async () => {
    if (prevKeys === undefined) delete process.env.MESSAGE_ENCRYPTION_KEYS;
    else process.env.MESSAGE_ENCRYPTION_KEYS = prevKeys;
    await f.cleanup();
  });

  await f.service.uploadRecording('alice', 'call', request());
  const rawOnDisk = await readFile(f.files.path(f.call.summaryAudioKey));
  assert.ok(isEncryptedMessageBytes(rawOnDisk));
  assert.ok(!rawOnDisk.includes(Buffer.from('webm test audio')));

  const res = await f.service.summarize('bob', 'call');
  assert.equal(res.result.summary, 'Thảo luận giao diện.');
  assert.equal(f.generated.length, 1);
  assert.deepEqual(f.generated[0], [bytes, 'audio/webm']);
});
