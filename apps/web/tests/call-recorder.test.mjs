import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(
  new URL('../src/features/calls/call-recorder.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { CallRecorder } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('recorder mixes local and remote tracks, follows track changes, and stops exactly once', async (t) => {
  const nodes = [];
  let mediaRecorder;
  let closed = 0;
  const local = { readyState: 'live' };
  const remote = { readyState: 'live' };
  let activeTracks = [local, remote];
  const room = {
    getAllLiveAudioTracks: () => activeTracks,
  };
  t.mock.method(globalThis, 'setTimeout', () => 1);
  t.mock.method(globalThis, 'clearTimeout', () => {});
  const originals = Object.fromEntries(
    ['AudioContext', 'MediaStream', 'MediaRecorder'].map((name) => [
      name,
      globalThis[name],
    ]),
  );
  t.after(() => {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  });
  globalThis.MediaStream = class {
    constructor(tracks) {
      this.tracks = tracks;
    }
  };
  globalThis.AudioContext = class {
    state = 'running';
    createMediaStreamDestination() {
      return { stream: { getTracks: () => [{ stop() {} }] } };
    }
    createMediaStreamSource(stream) {
      const node = {
        track: stream.tracks[0],
        disconnected: false,
        connect() {},
        disconnect() {
          this.disconnected = true;
        },
      };
      nodes.push(node);
      return node;
    }
    async resume() {}
    async close() {
      closed++;
    }
  };
  globalThis.MediaRecorder = class {
    static isTypeSupported() {
      return true;
    }
    constructor(_stream, options) {
      this.mimeType = options.mimeType;
      mediaRecorder = this;
    }
    start() {
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      queueMicrotask(() => {
        this.ondataavailable({ data: new Blob(['final audio']) });
        this.onstop();
      });
    }
  };
  const recorder = new CallRecorder(room, assert.fail);
  assert.deepEqual(
    nodes.map((node) => node.track),
    [local, remote],
  );
  activeTracks = [local];
  recorder.sync();
  assert.equal(nodes[1].disconnected, true);
  const first = recorder.stop();
  assert.equal(first, recorder.stop());
  assert.equal(await (await first).text(), 'final audio');
  assert.equal(mediaRecorder.state, 'inactive');
  assert.equal(closed, 1);

  const interrupted = new CallRecorder(room, assert.fail);
  interrupted.invalidate('connection lost');
  await assert.rejects(interrupted.stop(), /connection lost/);
});
