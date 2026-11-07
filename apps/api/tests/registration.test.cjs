const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const {
  RegistrationService,
} = require('../dist/modules/auth/registration.service');
const { User } = require('../dist/modules/database/entities/user.entity');

test('an existing account is rejected before a registration email is sent', async () => {
  let mailCalls = 0;
  const db = {
    getRepository(entity) {
      assert.equal(entity, User);
      return {
        exists: async ({ where }) => {
          assert.equal(where.email, 'me@example.com');
          return true;
        },
      };
    },
  };
  const mail = {
    assertConfigured() {
      mailCalls++;
    },
    async sendCode() {
      mailCalls++;
    },
  };
  const service = new RegistrationService(
    db,
    { getOrThrow: () => 'test-secret' },
    mail,
  );

  await assert.rejects(
    service.requestCode('me@example.com'),
    (error) =>
      error.getStatus() === 409 &&
      error.getResponse().code === 'EMAIL_ALREADY_REGISTERED',
  );
  assert.equal(mailCalls, 0);
});
