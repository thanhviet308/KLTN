import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function sounds() {
  const source = await readFile(
    new URL('../src/notification-sounds.ts', import.meta.url),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}#${crypto.randomUUID()}`
  );
}

test('message sound plays two short tones', async () => {
  const originalWindow = globalThis.window;
  let starts = 0;
  globalThis.window = fakeWindow(() => starts++);
  try {
    const audio = await sounds();
    await audio.playMessageSound();
    assert.equal(starts, 2);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('incoming ringtone stops its repeating timer', async () => {
  const originalWindow = globalThis.window;
  let starts = 0;
  let repeat;
  let cleared = false;
  const browser = fakeWindow(() => starts++);
  browser.setInterval = (callback) => {
    repeat = callback;
    return 7;
  };
  browser.clearInterval = (id) => {
    assert.equal(id, 7);
    cleared = true;
  };
  globalThis.window = browser;
  try {
    const audio = await sounds();
    const stop = audio.startIncomingCallRingtone();
    await Promise.resolve();
    assert.equal(starts, 3);
    repeat();
    await Promise.resolve();
    assert.equal(starts, 6);
    stop();
    assert.equal(cleared, true);
    repeat();
    await Promise.resolve();
    assert.equal(starts, 6);
  } finally {
    globalThis.window = originalWindow;
  }
});

function fakeWindow(onStart) {
  class FakeAudioContext {
    state = 'running';
    currentTime = 0;
    destination = {};
    createOscillator() {
      return {
        type: 'sine',
        frequency: { setValueAtTime() {} },
        connect() {
          return this;
        },
        start: onStart,
        stop() {},
      };
    }
    createGain() {
      return {
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {},
        },
        connect() {
          return this;
        },
      };
    }
    async resume() {}
  }
  return {
    AudioContext: FakeAudioContext,
    addEventListener() {},
    removeEventListener() {},
    setInterval,
    clearInterval,
  };
}
