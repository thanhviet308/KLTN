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
const MAX_AI_RESULT_CACHE = 120;
const aiResultCache = new Map<string, AiResult>();
let cachedEnabled: boolean | undefined;
let pendingStatus: Promise<boolean> | undefined;
let statusGeneration = 0;

export function cachedAiEnabled(): boolean | undefined {
  return cachedEnabled;
}

export function clearAiCache() {
  statusGeneration++;
  cachedEnabled = undefined;
  pendingStatus = undefined;
  aiResultCache.clear();
}

export async function resolveAiEnabled(
  loader: () => Promise<{ enabled: boolean }>,
): Promise<boolean> {
  if (cachedEnabled === true) return true;
  if (!pendingStatus) {
    const currentGen = statusGeneration;
    const request = loader()
      .then((res) => {
        if (currentGen === statusGeneration && res.enabled)
          cachedEnabled = true;
        return res.enabled;
      })
      .finally(() => {
        if (pendingStatus === request) pendingStatus = undefined;
      });
    pendingStatus = request;
  }
  return pendingStatus;
}

export function buildAiCacheKey(params: {
  userId?: string;
  conversationId: string;
  kind: AiKind;
  sourceRevisions: string[];
  targetId?: string;
  tone?: string;
  language?: string;
}) {
  return JSON.stringify([
    params.userId ?? '',
    params.conversationId,
    params.kind,
    params.sourceRevisions,
    params.targetId ?? '',
    params.kind === 'replies' ? (params.tone ?? 'concise') : '',
    params.kind === 'translate' ? (params.language ?? 'vi') : '',
  ]);
}

export function getCachedAiResult(key: string): AiResult | undefined {
  return aiResultCache.get(key);
}

export function cacheAiResult(key: string, value: AiResult) {
  if (!aiResultCache.has(key) && aiResultCache.size >= MAX_AI_RESULT_CACHE) {
    const oldest = aiResultCache.keys().next().value;
    if (oldest !== undefined) aiResultCache.delete(oldest);
  }
  aiResultCache.set(key, value);
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
