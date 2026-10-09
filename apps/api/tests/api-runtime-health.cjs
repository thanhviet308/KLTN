// Run via compose exec inside the actual staging NestJS container.
// Never accept a configurable production URL or production database.
const assert = require('node:assert/strict');
assert.equal(process.env.NODE_ENV, 'test');
const database = new URL(process.env.DATABASE_URL);
assert.equal(database.hostname, 'staging-db');
assert.equal(database.pathname, '/pingpong_staging');
assert.equal(database.username, 'pingpong_staging');
const base = 'http://127.0.0.1:3000/api/v1';
async function main() {
  for (const route of ['/health/live', '/health/ready']) {
    const response = await fetch(base + route, {
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200, route);
    assert.deepEqual(await response.json(), { status: 'ok' });
    console.log(`${route}: 200 OK`);
  }
  const anonymous = await fetch(base + '/users/me', {
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(anonymous.status, 401);
  const invalid = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Client': 'android' },
    body: JSON.stringify({ email: 'invalid', password: '' }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(invalid.status, 400);
  console.log('Actual NestJS startup, database readiness and HTTP guards OK');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
