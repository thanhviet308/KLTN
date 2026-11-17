import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  AI_LANGUAGES,
  buildAiCacheKey,
  buildVoiceTranscribePayload,
  cacheAiResult,
  cachedAiEnabled,
  clearAiCache,
  getCachedAiResult,
  initialSelection,
  reduceVoiceTranscriptSuccess,
  resolveAiEnabled,
  sourceRevision,
  sourceVersion,
  textMessages,
  unreadTextMessages,
  UNREAD_SUMMARY_THRESHOLD,
} from '../src/features/ai/ai-model.ts';

const messages = Array.from({ length: 30 }, (_, index) => ({
  id: `message-${index}`,
  body: `Tin ${index}`,
  type: 'text',
  editedAt: null,
  createdAt: '2026-11-02T00:00:00.000Z',
}));
test('summary defaults to latest 20 texts while reply context stops at its target and translation selects only that target', () => {
  assert.deepEqual(
    initialSelection(messages, 'summary'),
    messages.slice(-20).map((item) => item.id),
  );
  assert.deepEqual(
    initialSelection(messages, 'replies', 'message-15'),
    messages.slice(6, 16).map((item) => item.id),
  );
  assert.deepEqual(initialSelection(messages, 'translate', 'message-15'), [
    'message-15',
  ]);
  assert.deepEqual(initialSelection(messages, 'replies', 'missing'), []);
});
test('media, blank and recalled messages never enter previews or default selections', () => {
  const inputs = [
    messages[0],
    { ...messages[1], type: 'file' },
    { ...messages[2], deletedAt: '2026-11-02' },
    { ...messages[3], body: ' ' },
  ];
  assert.deepEqual(textMessages(inputs), [messages[0]]);
});
test('unread summary selects only incoming text after the frozen read boundary', () => {
  const inputs = [
    { ...messages[0], senderId: 'peer', sequence: '8' },
    { ...messages[1], senderId: 'peer', sequence: '9' },
    { ...messages[2], senderId: 'me', sequence: '10' },
    { ...messages[3], senderId: 'peer', sequence: '11', type: 'file' },
    { ...messages[4], senderId: 'peer', sequence: '12' },
  ];
  assert.equal(UNREAD_SUMMARY_THRESHOLD, 5);
  assert.deepEqual(
    unreadTextMessages(inputs, 'me', '8').map((item) => item.id),
    [messages[1].id, messages[4].id],
  );
});
test('browser revisions match server SHA256 and invalidate results when message content changes', async () => {
  const original = messages[0];
  const digest = createHash('sha256')
    .update(sourceVersion(original))
    .digest('hex');
  assert.equal(await sourceRevision(original), digest);
  assert.notEqual(
    await sourceRevision({ ...original, body: 'Changed' }),
    digest,
  );
  assert.notEqual(
    await sourceRevision({ ...original, editedAt: '2026-11-02T01:00:00.000Z' }),
    digest,
  );
});

test('voice transcription helpers build strict payloads and merge incremental AI extensions', () => {
  assert.equal(AI_LANGUAGES.vi, 'Tiếng Việt');
  assert.equal(AI_LANGUAGES.en, 'Tiếng Anh');
  assert.deepEqual(buildVoiceTranscribePayload(), {});
  assert.deepEqual(
    buildVoiceTranscribePayload({
      translateTo: undefined,
      includeReplies: true,
    }),
    { includeReplies: true },
  );
  assert.deepEqual(
    buildVoiceTranscribePayload({ translateTo: 'en', tone: 'friendly' }),
    { translateTo: 'en', tone: 'friendly' },
  );

  const initial = reduceVoiceTranscriptSuccess(
    undefined,
    {
      transcript: 'Chiều nay 3 giờ họp nhóm nhé.',
      language: 'vi',
      translation: '',
      replies: [],
    },
    undefined,
  );
  assert.deepEqual(initial, {
    loading: false,
    transcript: 'Chiều nay 3 giờ họp nhóm nhé.',
    language: 'vi',
    translation: undefined,
    translatedLanguage: undefined,
    replies: undefined,
    error: undefined,
  });

  const translated = reduceVoiceTranscriptSuccess(
    initial,
    {
      transcript: 'Chiều nay 3 giờ họp nhóm nhé.',
      language: 'vi',
      translation: 'Team meeting at 3 PM this afternoon.',
      replies: [],
    },
    { translateTo: 'en' },
  );
  assert.equal(translated.translation, 'Team meeting at 3 PM this afternoon.');
  assert.equal(translated.translatedLanguage, 'en');

  const withReplies = reduceVoiceTranscriptSuccess(
    translated,
    {
      transcript: 'Chiều nay 3 giờ họp nhóm nhé.',
      language: 'vi',
      translation: '',
      replies: ['Ok, 3h mình có mặt'],
    },
    { includeReplies: true },
  );
  assert.equal(withReplies.translation, 'Team meeting at 3 PM this afternoon.');
  assert.equal(withReplies.translatedLanguage, 'en');
  assert.deepEqual(withReplies.replies, ['Ok, 3h mình có mặt']);
});

test('AI model helpers cache generated outputs by revision and deduplicate status checks', async () => {
  const key = buildAiCacheKey({
    conversationId: 'conv-1',
    kind: 'translate',
    sourceRevisions: ['rev-1'],
    language: 'vi',
  });
  const sample = {
    summary: '',
    decisions: [],
    tasks: [],
    replies: [],
    translation: 'Xin chào',
  };
  assert.equal(getCachedAiResult(key), undefined);
  cacheAiResult(key, sample);
  assert.deepEqual(getCachedAiResult(key), sample);

  let statusCalls = 0;
  const loader = async () => {
    statusCalls++;
    return { enabled: true };
  };
  const [firstCheck, secondCheck] = await Promise.all([
    resolveAiEnabled(loader),
    resolveAiEnabled(loader),
  ]);
  assert.equal(firstCheck, true);
  assert.equal(secondCheck, true);
  assert.equal(cachedAiEnabled(), true);
  assert.equal(statusCalls, 1);
  assert.equal(await resolveAiEnabled(loader), true);
  assert.equal(statusCalls, 1);

  const otherUserKey = buildAiCacheKey({
    userId: 'user-2',
    conversationId: 'conv-1',
    kind: 'translate',
    sourceRevisions: ['rev-1'],
    language: 'vi',
  });
  assert.notEqual(otherUserKey, key);
  assert.equal(getCachedAiResult(otherUserKey), undefined);

  clearAiCache();
  assert.equal(cachedAiEnabled(), undefined);
  assert.equal(getCachedAiResult(key), undefined);
});
