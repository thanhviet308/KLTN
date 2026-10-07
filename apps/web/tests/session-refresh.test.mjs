import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

test('an old 401 retries with an already renewed token without rotating again', async () => {
  const originalFetch = globalThis.fetch;
  let rotations = 0;
  let rejectOld;
  let started;
  const inFlight = new Promise((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/auth/login'))
      return Response.json({
        accessToken: 'old',
        expiresIn: 900,
        user: { id: 'user-1' },
      });
    if (url.endsWith('/auth/refresh')) {
      rotations++;
      return Response.json({
        accessToken: 'new',
        expiresIn: 900,
        user: { id: 'user-1' },
      });
    }
    if (options.headers.Authorization === 'Bearer old') {
      started();
      return new Promise((resolve) => {
        rejectOld = () =>
          resolve(
            Response.json({ code: 'INVALID_ACCESS_TOKEN' }, { status: 401 }),
          );
      });
    }
    assert.equal(options.headers.Authorization, 'Bearer new');
    return Response.json({ ok: true });
  };
  try {
    const api = await client('late-401');
    await api.login('test@example.com', 'unused');
    const result = api.authenticated('/friends');
    await inFlight;
    await api.refresh();
    rejectOld();
    assert.deepEqual(await result, { ok: true });
    assert.equal(rotations, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function client(key) {
  const source = (
    await readFile(new URL('../src/api.ts', import.meta.url), 'utf8')
  )
    .replace(
      "import { BACKEND_ORIGIN } from './config';",
      "const BACKEND_ORIGIN = '';",
    )
    .replace('import.meta.env.DEV', 'true');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${key}`
  );
}

test('tabs serialize cookie rotation and callers in a tab share one refresh', async () => {
  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    'navigator',
  );
  let queue = Promise.resolve();
  let running = 0;
  let maximum = 0;
  let rotations = 0;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      locks: {
        request: (_name, callback) => {
          const result = queue.then(callback);
          queue = result.catch(() => {});
          return result;
        },
      },
    },
  });
  globalThis.fetch = async () => {
    running++;
    rotations++;
    maximum = Math.max(maximum, running);
    await new Promise((resolve) => setTimeout(resolve, 10));
    running--;
    return Response.json({
      accessToken: `token-${rotations}`,
      expiresIn: 900,
      user: { id: 'user-1' },
    });
  };
  try {
    const [tabA, tabB] = await Promise.all([client('tab-a'), client('tab-b')]);
    await Promise.all([tabA.refresh(), tabA.refresh(), tabB.refresh()]);
    assert.equal(rotations, 2);
    assert.equal(maximum, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalNavigator)
      Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});
