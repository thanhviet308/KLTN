import type { Message } from '../../lib/chat-model';

export type AiKind = 'summary' | 'replies' | 'translate';
export const UNREAD_SUMMARY_THRESHOLD = 5;

export const AI_LANGUAGES = {
  vi: 'Tiếng Việt',
  en: 'Tiếng Anh',
  ja: 'Tiếng Nhật',
  ko: 'Tiếng Hàn',
  zh: 'Tiếng Trung',
  fr: 'Tiếng Pháp',
} as const;

export type AiLanguageCode = keyof typeof AI_LANGUAGES;

export interface AiResult {
  summary: string;
  decisions: string[];
  tasks: string[];
  replies: string[];
  translation: string;
}

export interface AiTranscriptResult {
  transcript: string;
  language: string;
  translation: string;
  replies: string[];
}

export interface VoiceTranscribeOptions {
  translateTo?: AiLanguageCode;
  includeReplies?: boolean;
  tone?: 'concise' | 'friendly' | 'formal';
}

export interface VoiceTranscriptState {
  loading: boolean;
  transcript?: string;
  language?: string;
  translation?: string;
  translatedLanguage?: AiLanguageCode;
  replies?: string[];
  error?: string;
}

export function buildVoiceTranscribePayload(
  options?: VoiceTranscribeOptions,
): VoiceTranscribeOptions {
  const payload: VoiceTranscribeOptions = {};
  if (options?.translateTo) payload.translateTo = options.translateTo;
  if (options?.includeReplies) payload.includeReplies = true;
  if (options?.tone) payload.tone = options.tone;
  return payload;
}

export function reduceVoiceTranscriptSuccess(
  previous: VoiceTranscriptState | undefined,
  result: AiTranscriptResult,
  options?: VoiceTranscribeOptions,
): VoiceTranscriptState {
  return {
    loading: false,
    transcript: result.transcript,
    language: result.language,
    translation: result.translation || previous?.translation,
    translatedLanguage: result.translation
      ? options?.translateTo
      : previous?.translatedLanguage,
    replies: result.replies.length ? result.replies : previous?.replies,
    error: undefined,
  };
}
export function textMessages(messages: Message[]) {
  return messages.filter(
    (item) =>
      (!item.type || item.type === 'text') &&
      !item.deletedAt &&
      !!item.body?.trim(),
  );
}

export function unreadTextMessages(
  messages: Message[],
  userId: string,
  lastReadSequence: string | null,
) {
  const boundary = BigInt(lastReadSequence ?? '0');
  return textMessages(messages).filter(
    (message) =>
      message.senderId !== userId && BigInt(message.sequence) > boundary,
  );
}
export function sourceVersion(message: Message) {
  return JSON.stringify([
    message.id,
    message.editedAt ?? null,
    message.body ?? '',
  ]);
}
export async function sourceRevision(message: Message) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(sourceVersion(message)),
  );
  return Array.from(new Uint8Array(bytes), (value) =>
    value.toString(16).padStart(2, '0'),
  ).join('');
}
export function initialSelection(
  messages: Message[],
  kind: AiKind,
  targetId?: string,
) {
  const texts = textMessages(messages);
  if (kind === 'summary') return texts.slice(-20).map((item) => item.id);
  const index = texts.findIndex((item) => item.id === targetId);
  if (index < 0) return [];
  return (
    kind === 'translate'
      ? [texts[index]]
      : texts.slice(Math.max(0, index - 9), index + 1)
  ).map((item) => item.id);
}
