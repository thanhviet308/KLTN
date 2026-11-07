const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const {
  PasswordResetService,
} = require('../dist/modules/auth/password-reset.service');
const {
  PasswordReset,
} = require('../dist/modules/database/entities/password-reset.entity');
const { User } = require('../dist/modules/database/entities/user.entity');
const { Session } = require('../dist/modules/database/entities/session.entity');
const { ResetPasswordDto } = require('../dist/modules/auth/auth.dto');
const { validate } = require('class-validator');

function fixture(status = 'active') {
  const records = new Map();
  const sent = [];
  const notices = [];
  const updates = [];
  let user =
    status === 'unknown'
      ? null
      : {
          id: 'user-1',
          email: 'me@example.com',
          status,
          passwordHash: 'old-password-hash',
        };
  const repository = {
    findOneOrFail: async ({ where }) => records.get(where.email),
    update: async (where, changes) => {
      const record = records.get(
        typeof where === 'string' ? where : where.email,
      );
      if (
        !record ||
        (where.challengeId && record.challengeId !== where.challengeId)
      )
        return { affected: 0 };
      Object.assign(record, changes);
      return { affected: 1 };
    },
    createQueryBuilder: () => {
      let values, parameters;
      const builder = {
        insert: () => builder,
        values: (value) => {
          values = value;
          return builder;
        },
        orIgnore: () => builder,
        execute: async () => {
          if (!records.has(values.email))
            records.set(values.email, {
              ...values,
              consumedAt: null,
              delivered: false,
              userId: null,
              credentialHash: null,
            });
        },
        addSelect: () => builder,
        setLock: () => builder,
        where: (_sql, params) => {
          parameters = params;
          return builder;
        },
        getOne: async () =>
          [...records.values()].find(
            (record) => record.challengeId === parameters.challengeId,
          ),
      };
      return builder;
    },
  };
  const manager = {
    getRepository: (entity) => {
      if (entity === PasswordReset) return repository;
      if (entity === User) {
        let parameters;
        const builder = {
          addSelect: () => builder,
          setLock: () => builder,
          where: (_sql, params) => {
            parameters = params;
            return builder;
          },
          getOne: async () =>
            user &&
            (parameters.email === user.email || parameters.userId === user.id)
              ? { ...user }
              : null,
        };
        return {
          createQueryBuilder: () => builder,
          update: async (id, value) => {
            assert.equal(id, user.id);
            updates.push({ entity: 'user', value });
            Object.assign(user, value);
          },
        };
      }
      if (entity === Session) {
        const builder = {
          where: () => builder,
          orderBy: () => builder,
          setLock: () => builder,
          getMany: async () => [],
        };
        return {
          createQueryBuilder: () => builder,
          update: async (where, value) => {
            updates.push({ entity: 'sessions', where, value });
          },
        };
      }
      throw new Error('Unexpected entity');
    },
  };
  let queue = Promise.resolve();
  const db = {
    getRepository: manager.getRepository,
    transaction: (work) => {
      const result = queue.then(() => work(manager));
      queue = result.catch(() => undefined);
      return result;
    },
  };
  const mail = {
    assertConfigured: () => {},
    sendCode: async (email, code, purpose) => {
      sent.push({ email, code, purpose });
    },
    sendPasswordResetNotice: async (email) => {
      notices.push(email);
    },
  };
  let hashes = 0;
  const service = new PasswordResetService(
    db,
    { getOrThrow: () => 'test-secret' },
    {
      hash: async (password) => {
        hashes++;
        return `hashed:${password}`;
      },
    },
    mail,
  );
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  return {
    service,
    sent,
    records,
    notices,
    updates,
    mail,
    flush,
    get user() {
      return user;
    },
    get hashes() {
      return hashes;
    },
    setUser: (next) => {
      user = next;
    },
    async request() {
      const result = await service.requestCode('  ME@example.com  ');
      await flush();
      return result;
    },
  };
}
const input = (challenge, code) => ({
  challengeId: challenge.challengeId,
  code,
  newPassword: 'new-password-123',
  confirmPassword: 'new-password-123',
});
const invalidCode = (error) =>
  error.getResponse().code === 'INVALID_PASSWORD_RESET_CODE';

test('requests use identical response shape for active, blocked and unknown accounts; codes stay hashed and purpose-bound', async () => {
  for (const status of ['active', 'blocked', 'unknown']) {
    const f = fixture(status);
    const result = await f.request();
    assert.deepEqual(Object.keys(result).sort(), [
      'challengeId',
      'expiresAt',
      'resendAfterSeconds',
    ]);
    assert.match(result.challengeId, /^[\da-f-]{36}$/);
    assert.equal(result.resendAfterSeconds, 60);
    const record = f.records.get('me@example.com');
    assert.match(record.codeHash, /^[a-f0-9]{64}$/);
    assert.equal(f.sent.length, status === 'active' ? 1 : 0);
    if (status === 'active') {
      assert.match(f.sent[0].code, /^\d{6}$/);
      assert.equal(f.sent[0].purpose, 'password-reset');
      assert.equal(record.delivered, true);
    }
  }
});

test('successful reset consumes the code, replaces password, revokes all sessions and sends a notice; replay is rejected', async () => {
  const f = fixture();
  const result = await f.request();
  await f.service.reset(input(result, f.sent[0].code));
  assert.equal(f.user.passwordHash, 'hashed:new-password-123');
  assert.equal(f.updates[1].entity, 'sessions');
  assert.equal(f.updates[1].where.userId, 'user-1');
  assert.ok(f.updates[1].value.revokedAt instanceof Date);
  assert.ok(f.records.get('me@example.com').consumedAt instanceof Date);
  assert.deepEqual(f.notices, ['me@example.com']);
  await assert.rejects(
    f.service.reset(input(result, f.sent[0].code)),
    invalidCode,
  );
  assert.equal(f.hashes, 1);
});

test('five wrong codes persist attempts without locking the account or changing sessions', async () => {
  const f = fixture();
  const result = await f.request();
  const wrong = f.sent[0].code === '000000' ? '999999' : '000000';
  for (let attempt = 0; attempt < 5; attempt++) {
    await assert.rejects(f.service.reset(input(result, wrong)), invalidCode);
    assert.equal(f.records.get('me@example.com').attempts, attempt + 1);
  }
  await assert.rejects(
    f.service.reset(input(result, f.sent[0].code)),
    invalidCode,
  );
  assert.equal(f.user.status, 'active');
  assert.equal(f.hashes, 0);
  assert.equal(f.updates.length, 0);
});

test('expired, undelivered, blocked or changed-credential challenges never reset a password', async () => {
  for (const change of [
    (f) => {
      f.records.get('me@example.com').expiresAt = new Date(0);
    },
    (f) => {
      f.records.get('me@example.com').delivered = false;
    },
    (f) => {
      f.user.status = 'blocked';
    },
    (f) => {
      f.user.passwordHash = 'changed-in-another-session';
    },
    (f) => {
      f.user.email = 'new@example.com';
    },
  ]) {
    const f = fixture();
    const result = await f.request();
    change(f);
    await assert.rejects(
      f.service.reset(input(result, f.sent[0].code)),
      invalidCode,
    );
    assert.equal(f.updates.length, 0);
    assert.equal(f.hashes, 0);
  }
});

test('resend limits apply equally to existing and unknown accounts and replace prior challenges', async () => {
  for (const status of ['active', 'unknown']) {
    const f = fixture(status);
    const original = await f.request();
    await assert.rejects(
      f.request(),
      (error) => error.getResponse().code === 'VERIFICATION_COOLDOWN',
    );
    for (let send = 1; send < 5; send++) {
      f.records.get('me@example.com').sentAt = new Date(Date.now() - 61000);
      await f.request();
    }
    f.records.get('me@example.com').sentAt = new Date(Date.now() - 61000);
    await assert.rejects(
      f.request(),
      (error) => error.getResponse().code === 'VERIFICATION_SEND_LIMIT',
    );
    await assert.rejects(
      f.service.reset(input(original, f.sent[0]?.code ?? '000000')),
      invalidCode,
    );
  }
});

test('concurrent submissions consume a valid code only once', async () => {
  const f = fixture();
  const result = await f.request();
  const results = await Promise.allSettled([
    f.service.reset(input(result, f.sent[0].code)),
    f.service.reset(input(result, f.sent[0].code)),
  ]);
  assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(f.hashes, 1);
});

test('mismatched confirmation never consumes a valid challenge and DTO rejects short passwords and malformed codes', async () => {
  const f = fixture();
  const result = await f.request();
  await assert.rejects(
    f.service.reset({
      ...input(result, f.sent[0].code),
      confirmPassword: 'different',
    }),
    (error) => error.getResponse().code === 'PASSWORD_CONFIRMATION_MISMATCH',
  );
  assert.equal(f.records.get('me@example.com').consumedAt, null);
  const errors = await validate(
    Object.assign(new ResetPasswordDto(), {
      challengeId: 'not-a-uuid',
      code: 'abc',
      newPassword: 'short',
      confirmPassword: 'short',
    }),
  );
  assert.equal(errors.length, 4);
});
