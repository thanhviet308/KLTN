import assert from 'node:assert/strict';
import test from 'node:test';
import { voiceTimeline } from '../src/features/chat/voice-timeline.ts';

test('missing WebM metadata does not fill the seek bar after one second', () => {
  for (const duration of [0, Infinity, NaN, -1]) {
    const timeline = voiceTimeline(41, duration);
    assert.equal(timeline.known, false);
    assert.equal(timeline.value, 0);
    assert.equal(timeline.elapsed, 41);
  }
});

test('resolved duration restores the real playback ratio', () => {
  const timeline = voiceTimeline(41, 60);
  assert.equal(timeline.known, true);
  assert.equal(timeline.value / timeline.max, 41 / 60);
});

test('seeking, ending and replay use the same duration scale', () => {
  assert.equal(voiceTimeline(15, 60).value, 15);
  assert.equal(voiceTimeline(60.01, 60).value, 60);
  assert.equal(voiceTimeline(0, 60).value, 0);
  assert.equal(voiceTimeline(NaN, 60).value, 0);
});
