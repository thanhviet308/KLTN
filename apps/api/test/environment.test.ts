import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validateEnvironment } from '../src/config/environment';

test('development has usable local defaults', () => {
  assert.deepEqual(validateEnvironment({}), {
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: 3000,
    WEB_ORIGIN: 'http://localhost:5173',
  });
});

test('rejects invalid ports before listening', () => {
  for (const PORT of ['', '0', '-1', '65536', '3000abc', '3.5', '1e3']) {
    assert.throws(() => validateEnvironment({ PORT }), /PORT/);
  }
  assert.equal(validateEnvironment({ PORT: '4000' }).PORT, 4000);
});

test('requires explicit HTTPS browser origin in production', () => {
  assert.throws(
    () => validateEnvironment({ NODE_ENV: 'production' }),
    /WEB_ORIGIN/,
  );
  for (const WEB_ORIGIN of [
    '*',
    'http://example.com',
    'https://example.com/path',
    'https://user:pass@example.com',
  ]) {
    assert.throws(
      () => validateEnvironment({ NODE_ENV: 'production', WEB_ORIGIN }),
      /WEB_ORIGIN/,
    );
  }
  assert.equal(
    validateEnvironment({
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://chat.example.com',
    }).WEB_ORIGIN,
    'https://chat.example.com',
  );
});

test('rejects invalid environment names and empty hosts', () => {
  assert.throws(() => validateEnvironment({ NODE_ENV: 'prod' }), /NODE_ENV/);
  assert.throws(() => validateEnvironment({ HOST: ' ' }), /HOST/);
});
