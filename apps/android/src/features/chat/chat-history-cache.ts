import ReactNativeBlobUtil from 'react-native-blob-util';
import * as api from '../../api';
import { mergeMessages } from '../../utils';

export type HistoryPage = api.Page<api.Message> & { highWatermark: string };

interface CachedHistory {
  messages: api.Message[];
  older: string | null;
  verifiedAt: number;
  highWatermark: string;
  clearedAfter: bigint;
}

const HISTORY_CACHE_TTL_MS = 10 * 60 * 1000;
const FRESH_HISTORY_TTL_MS = 60 * 1000;
const MAX_CACHED_CONVERSATIONS = 30;
const MAX_CACHED_MEDIA_FILES = 60;

export class ChatHistoryCache {
  private readonly entries = new Map<string, CachedHistory>();
  private readonly pending = new Map<string, Promise<HistoryPage>>();
  private readonly mediaPaths = new Map<string, string>();

  get(id: string) {
    const entry = this.entries.get(id);
    return entry && Date.now() - entry.verifiedAt < HISTORY_CACHE_TTL_MS
      ? entry
      : undefined;
  }

  getMediaPath(messageId: string) {
    return this.mediaPaths.get(messageId);
  }

  setMediaPath(messageId: string, path: string) {
    this.mediaPaths.delete(messageId);
    this.mediaPaths.set(messageId, path);
    if (this.mediaPaths.size > MAX_CACHED_MEDIA_FILES) {
      const oldestKey = this.mediaPaths.keys().next().value;
      if (oldestKey !== undefined) {
        const oldPath = this.mediaPaths.get(oldestKey);
        this.mediaPaths.delete(oldestKey);
        if (oldPath) {
          ReactNativeBlobUtil.fs
            .unlink(oldPath.replace(/^file:\/\//, ''))
            .catch(() => undefined);
        }
      }
    }
  }

  deleteMediaPath(messageId: string) {
    const existing = this.mediaPaths.get(messageId);
    this.mediaPaths.delete(messageId);
    if (existing) {
      ReactNativeBlobUtil.fs
        .unlink(existing.replace(/^file:\/\//, ''))
        .catch(() => undefined);
    }
  }

  remember(id: string, entry: CachedHistory) {
    const messages = entry.messages.slice(-50);
    this.entries.delete(id);
    this.entries.set(id, {
      ...entry,
      messages,
      older:
        entry.messages.length > messages.length
          ? messages[0].sequence
          : entry.older,
    });
    if (this.entries.size > MAX_CACHED_CONVERSATIONS) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  invalidate(id: string) {
    this.entries.delete(id);
    this.pending.delete(id);
  }

  loadRecent(id: string, clearedAfter: bigint) {
    const pending = this.pending.get(id);
    if (pending) return pending;
    const request = api
      .authenticated<HistoryPage>(
        `/conversations/${id}/messages?direction=backward&limit=50`,
      )
      .then(page => {
        if (this.pending.get(id) === request) {
          this.remember(id, {
            messages: mergeMessages([], page.items),
            older: page.nextCursor,
            verifiedAt: Date.now(),
            highWatermark: page.highWatermark,
            clearedAfter,
          });
        }
        return page;
      })
      .finally(() => {
        if (this.pending.get(id) === request) this.pending.delete(id);
      });
    this.pending.set(id, request);
    return request;
  }
}

export function isFreshHistory(
  entry: CachedHistory | undefined,
  conversation: api.Conversation,
) {
  return (
    !!entry &&
    Date.now() - entry.verifiedAt < FRESH_HISTORY_TTL_MS &&
    entry.highWatermark === conversation.lastMessageSequence &&
    entry.clearedAfter ===
      BigInt(conversation.membership.clearedAfterSequence ?? '0')
  );
}
