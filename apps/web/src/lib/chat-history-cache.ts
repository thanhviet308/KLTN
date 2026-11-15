import type { History, Message, Receipt } from './chat-model';

export interface CachedHistory {
  verifiedAt?: number;
  messages: Message[];
  older: string | null;
  receipts: Record<string, Record<string, Receipt>>;
}
const histories = new Map<string, CachedHistory>();
const pending = new Map<string, Promise<History>>();
let generation = 0;
export function loadRecentHistory(
  key: string,
  fetchHistory: () => Promise<History>,
) {
  const existing = pending.get(key);
  if (existing) return existing;
  const current = generation;
  const request = fetchHistory()
    .then((page) => {
      if (current === generation)
        rememberHistory(key, {
          verifiedAt: Date.now(),
          messages: page.items,
          older: page.nextCursor,
          receipts: cachedHistory(key)?.receipts ?? {},
        });
      return page;
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key);
    });
  pending.set(key, request);
  return request;
}
export function cachedHistory(key: string) {
  return histories.get(key);
}
function messageVersion(item: Message) {
  return Date.parse(item.deletedAt ?? item.editedAt ?? item.createdAt);
}

// Normalize descending / backward API pages into ascending timeline order so
// opening a preloaded conversation never flashes older messages before flipping.
function sortAscending(messages: Message[]) {
  const entries = new Map<string, Message>();
  for (const message of messages) {
    const existing = entries.get(message.id);
    if (existing?.deletedAt && !message.deletedAt) continue;
    if (existing && messageVersion(existing) > messageVersion(message))
      continue;
    entries.set(message.id, message);
  }
  return [...entries.values()].sort((a, b) =>
    BigInt(a.sequence) < BigInt(b.sequence)
      ? -1
      : BigInt(a.sequence) > BigInt(b.sequence)
        ? 1
        : 0,
  );
}

export function rememberHistory(key: string, history: CachedHistory) {
  const verifiedAt = history.verifiedAt ?? histories.get(key)?.verifiedAt ?? 0;
  histories.delete(key);
  const ordered = sortAscending(history.messages);
  const messages = ordered.slice(-50);
  histories.set(key, {
    verifiedAt,
    messages,
    older: ordered.length > 50 ? messages[0]!.sequence : history.older,
    receipts: Object.fromEntries(
      messages.map((message) => [
        message.id,
        history.receipts[message.id] ?? {},
      ]),
    ),
  });
  if (histories.size > 20) histories.delete(histories.keys().next().value!);
}

export function applyCachedMessage(key: string, message: Message) {
  const existing = histories.get(key);
  if (!existing) return;
  rememberHistory(key, {
    verifiedAt: Date.now(),
    messages: [...existing.messages, message],
    older: existing.older,
    receipts: existing.receipts,
  });
}
export function clearHistoryCache() {
  generation++;
  pending.clear();
  histories.clear();
}
