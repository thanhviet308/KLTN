import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWorkspaceViewportAction } from '../src/lib/viewport.ts';

test('auth and scrollable non-workspace pages never lock --app-h or reset window scroll', () => {
  assert.deepEqual(
    resolveWorkspaceViewportAction({
      isWorkspaceShell: false,
      innerWidth: 390,
      visualHeight: 460,
      offsetTop: 120,
    }),
    { mode: 'clear' },
  );
});

test('mobile workspace shell syncs fixed viewport height and resets positive visual offset', () => {
  assert.deepEqual(
    resolveWorkspaceViewportAction({
      isWorkspaceShell: true,
      innerWidth: 390,
      visualHeight: 468.4,
      offsetTop: 24,
    }),
    { mode: 'fixed', heightPx: 468, resetWindowScroll: true },
  );
  assert.deepEqual(
    resolveWorkspaceViewportAction({
      isWorkspaceShell: true,
      innerWidth: 390,
      visualHeight: 468.4,
      offsetTop: 0.5,
    }),
    { mode: 'fixed', heightPx: 468, resetWindowScroll: false },
  );
});

test('desktop viewports clear mobile --app-h override even inside workspace shell', () => {
  assert.deepEqual(
    resolveWorkspaceViewportAction({
      isWorkspaceShell: true,
      innerWidth: 1280,
      visualHeight: 800,
      offsetTop: 0,
    }),
    { mode: 'clear' },
  );
});
