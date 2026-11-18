import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCallMediaError,
  isOverconstrainedMediaError,
} from '../src/features/calls/call-media.ts';
import {
  computeCallElapsedSeconds,
  formatCallDuration,
  nextPipCorner,
  resolveStageVideoState,
} from '../src/features/calls/call-view-model.ts';
import { isEmbeddedInAppBrowser } from '../src/features/chat/location-helper.ts';

test('embedded browsers without mediaDevices instruct user to open Safari or Chrome', () => {
  const userAgent =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Zalo/24.0';
  const message = formatCallMediaError({
    missingDevices: ['microphone', 'camera'],
    callType: 'video',
    mediaSupported: false,
    secureContext: true,
    userAgent,
    embedded: isEmbeddedInAppBrowser(userAgent),
  });
  assert.match(message, /Safari.*Chrome/);
});

test('iPhone permission denial explains how to enable mic and camera cleanly', () => {
  const message = formatCallMediaError({
    failure: Object.assign(new Error('Permission denied'), {
      name: 'NotAllowedError',
    }),
    missingDevices: ['camera'],
    callType: 'video',
    mediaSupported: true,
    secureContext: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile/15E148 Safari/604.1',
  });
  assert.match(message, /không mở được camera/i);
  assert.match(message, /iPhone\/Safari/i);
});

test('hardware busy errors work even when wrapped in LiveKit Error rather than DOMException', () => {
  const message = formatCallMediaError({
    failure: Object.assign(new Error('Could not start video source'), {
      name: 'TrackStartError',
    }),
    callType: 'video',
    mediaSupported: true,
    secureContext: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0',
  });
  assert.match(message, /ứng dụng hoặc tab khác sử dụng/i);
});

test('isOverconstrainedMediaError identifies OverconstrainedError variants', () => {
  assert.equal(
    isOverconstrainedMediaError(
      Object.assign(new Error('constraint failed'), {
        name: 'OverconstrainedError',
      }),
    ),
    true,
  );
  assert.equal(isOverconstrainedMediaError(new Error('denied')), false);
});

test('computeCallElapsedSeconds stays zero while ringing and counts active time', () => {
  assert.equal(
    computeCallElapsedSeconds({
      status: 'ringing',
      startedAt: '2026-11-18T04:00:00.000Z',
      nowMs: Date.parse('2026-11-18T04:00:15.000Z'),
    }),
    0,
  );
  assert.equal(
    computeCallElapsedSeconds({
      status: 'active',
      startedAt: '2026-11-18T04:00:00.000Z',
      nowMs: Date.parse('2026-11-18T04:01:05.900Z'),
    }),
    65,
  );
  assert.equal(formatCallDuration(65), '01:05');
  assert.equal(formatCallDuration(3661), '01:01:01');
});

test('resolveStageVideoState handles solo preview, 1-1 swap, grid, and PiP corner cycle', () => {
  assert.deepEqual(
    resolveStageVideoState({
      callType: 'video',
      callStatus: 'ringing',
      hasLocalVideo: true,
      remoteVideoCount: 0,
    }),
    {
      layout: 'solo-preview',
      effectiveSwapped: false,
      showHeroOverlay: true,
      canAutoHideChrome: false,
    },
  );
  assert.deepEqual(
    resolveStageVideoState({
      callType: 'video',
      callStatus: 'active',
      hasLocalVideo: true,
      remoteVideoCount: 1,
      swapped: true,
    }),
    {
      layout: 'one-to-one',
      effectiveSwapped: true,
      showHeroOverlay: false,
      canAutoHideChrome: true,
    },
  );
  assert.equal(
    resolveStageVideoState({
      callType: 'video',
      callStatus: 'active',
      hasLocalVideo: true,
      remoteVideoCount: 1,
      remoteParticipantCount: 3,
    }).layout,
    'grid',
  );
  assert.equal(nextPipCorner('top-right'), 'bottom-right');
  assert.equal(nextPipCorner('top-left'), 'top-right');
});
