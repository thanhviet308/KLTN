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
      "import { clearHistoryCache } from './chat-history-cache';",
      'const clearHistoryCache = () => {};',
    )
    .replace(
      "import { BACKEND_ORIGIN } from './config';",
      "const BACKEND_ORIGIN = '';",
    )
    // The fetch mock resolves explicitly; retaining production timeout signals
    // would keep the Node test worker alive after every successful request.
    .replace('signal: AbortSignal.timeout(15000),', 'signal: undefined,')
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

test('chat files share one download, survive reopen, and clear on account switch', async () => {
  const originalFetch = globalThis.fetch;
  let downloads = 0;
  let userId = 'first';
  globalThis.fetch = async (url) => {
    if (url.endsWith('/auth/login'))
      return Response.json({
        accessToken: userId,
        expiresIn: 900,
        user: { id: userId },
      });
    downloads++;
    return new Response(`private image for ${userId}`);
  };
  try {
    const api = await client('file-cache');
    await api.login('first@example.com', 'unused');
    const [chat, sidebar] = await Promise.all([
      api.chatFile('conversation', 'image'),
      api.chatFile('conversation', 'image'),
    ]);
    assert.equal(chat, sidebar);
    assert.equal(await api.chatFile('conversation', 'image'), chat);
    assert.equal(downloads, 1);
    userId = 'second';
    await api.login('second@example.com', 'unused');
    assert.equal(
      await (await api.chatFile('conversation', 'image')).text(),
      'private image for second',
    );
    assert.equal(downloads, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('background requests are paced and foreground actions pass the backlog', async () => {
  const originalFetch = globalThis.fetch;
  const starts = [];
  globalThis.fetch = async (url) => {
    if (url.endsWith('/auth/login'))
      return Response.json({
        accessToken: 'token',
        expiresIn: 900,
        user: { id: 'first' },
      });
    starts.push({ url, at: Date.now() });
    return Response.json({ ok: true });
  };
  try {
    const api = await client('request-pacing');
    await api.login('test@example.com', 'unused');
    await Promise.all([
      api.authenticated('/conversations/c/messages/m/reactions'),
      api.authenticated('/conversations/c/messages/m/receipts'),
      api.authenticated('/conversations/c/messages', { body: 'hello' }),
    ]);
    assert.ok(starts[0].url.endsWith('/messages'));
    for (let i = 1; i < starts.length; i++)
      assert.ok(starts[i].at - starts[i - 1].at >= 200);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a proxy 429 pauses queued requests and is not reported as a network failure', async () => {
  const originalFetch = globalThis.fetch;
  let limitedAt;
  let nextAt;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/auth/login'))
      return Response.json({
        accessToken: 'token',
        expiresIn: 900,
        user: { id: 'first' },
      });
    if (url.endsWith('/limited')) {
      limitedAt = Date.now();
      return new Response('Too many requests', {
        status: 429,
        headers: { 'Retry-After': '1' },
      });
    }
    nextAt = Date.now();
    return Response.json({ ok: true });
  };
  try {
    const api = await client('rate-limit');
    await api.login('test@example.com', 'unused');
    await Promise.all([
      assert.rejects(
        api.authenticated('/limited'),
        (error) => error.status === 429 && error.code === 'RATE_LIMITED',
      ),
      api.authenticated('/next'),
    ]);
    assert.ok(nextAt - limitedAt >= 900);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a file response from a cleared session cannot repopulate the cache', async () => {
  const originalFetch = globalThis.fetch;
  let finishDownload;
  let started;
  const downloading = new Promise((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async (url) => {
    if (url.endsWith('/auth/login'))
      return Response.json({
        accessToken: 'token',
        expiresIn: 900,
        user: { id: 'first' },
      });
    started();
    return new Promise((resolve) => {
      finishDownload = resolve;
    });
  };
  try {
    const api = await client('cleared-file-session');
    await api.login('test@example.com', 'unused');
    const result = api.chatFile('conversation', 'image');
    const rejected = assert.rejects(
      result,
      (error) => error.code === 'SESSION_CHANGED',
    );
    await downloading;
    api.clearSession();
    finishDownload(new Response('private image'));
    await rejected;
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test('a transient first upload failure retries once with the same message id', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    if (url.endsWith('/auth/login'))
      return Response.json({
        accessToken: 'token',
        expiresIn: 900,
        user: { id: 'user-1' },
      });
    urls.push(url);
    return urls.length === 1
      ? Response.json({ code: 'INTERNAL_SERVER_ERROR' }, { status: 500 })
      : Response.json({ message: { id: 'message-1' } });
  };
  try {
    const api = await client('upload-retry');
    await api.login('test@example.com', 'unused');
    const result = await api.uploadChatFile(
      'conversation-1',
      'client-message-1',
      new Blob(['image']),
      'image',
    );
    assert.equal(result.message.id, 'message-1');
    assert.equal(urls.length, 2);
    assert.equal(urls[0], urls[1]);
    assert.match(urls[0], /clientMessageId=client-message-1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
