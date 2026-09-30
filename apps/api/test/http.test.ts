import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { Body, Controller, Get, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString, MaxLength } from 'class-validator';
import { configureApp } from '../src/configure-app';
import { validateEnvironment } from '../src/config/environment';
import { HealthModule } from '../src/modules/health/health.module';

class ExampleDto {
  @IsString()
  @MaxLength(20)
  name!: string;
}

@Controller('_test')
class TestController {
  @Get('error')
  fail(): never {
    throw new Error('secret-database-password');
  }

  @Post('validate')
  validate(@Body() body: ExampleDto): ExampleDto {
    return body;
  }
}

let app: INestApplication;
let base: string;

before(async () => {
  const module = await Test.createTestingModule({
    imports: [HealthModule],
    controllers: [TestController],
  }).compile();
  app = module.createNestApplication({ logger: false, bodyParser: false });
  configureApp(app, validateEnvironment({ NODE_ENV: 'test' }));
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

after(async () => {
  await app?.close();
});

test('liveness exposes no dependency information and adds security headers', async () => {
  const response = await fetch(`${base}/api/v1/health/live`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.match(response.headers.get('x-request-id')!, /^[0-9a-f-]{36}$/);
});

test('unknown routes return consistent errors and server-generated request IDs', async () => {
  const response = await fetch(`${base}/missing`, {
    headers: { 'x-request-id': 'untrusted' },
  });
  assert.equal(response.status, 404);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.code, 'HTTP_404');
  assert.equal(body.requestId, response.headers.get('x-request-id'));
  assert.notEqual(body.requestId, 'untrusted');
});

test('unexpected errors do not disclose internal messages', async () => {
  const response = await fetch(`${base}/api/v1/_test/error`);
  assert.equal(response.status, 500);
  const body = (await response.json()) as Record<string, unknown>;
  assert.equal(body.message, 'Internal server error');
  assert.ok(!JSON.stringify(body).includes('secret-database-password'));
});

test('DTO validation rejects extra fields and wrong types', async () => {
  for (const body of [{ name: 'Viet', role: 'admin' }, { name: 42 }]) {
    const response = await fetch(`${base}/api/v1/_test/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.equal(
      ((await response.json()) as { code: string }).code,
      'HTTP_400',
    );
  }
  const response = await fetch(`${base}/api/v1/_test/validate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Viet' }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { name: 'Viet' });
});

test('CORS grants the configured browser origin, not arbitrary origins', async () => {
  for (const origin of ['http://localhost:5173', 'https://untrusted.example']) {
    const response = await fetch(`${base}/api/v1/health/live`, {
      headers: { origin },
    });
    assert.equal(
      response.headers.get('access-control-allow-origin'),
      'http://localhost:5173',
    );
    assert.equal(
      response.headers.get('access-control-allow-credentials'),
      'true',
    );
  }
});

test('malformed JSON and oversized bodies have structured client errors', async () => {
  for (const [body, status] of [
    ['{', 400],
    [JSON.stringify({ name: 'x'.repeat(1024 * 1024) }), 413],
  ] as const) {
    const response = await fetch(`${base}/api/v1/_test/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(response.status, status);
    const error = (await response.json()) as {
      code: string;
      requestId: string;
    };
    assert.equal(error.code, `HTTP_${status}`);
    assert.equal(error.requestId, response.headers.get('x-request-id'));
  }
});
