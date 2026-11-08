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
export function rememberHistory(key: string, history: CachedHistory) {
  const verifiedAt = history.verifiedAt ?? histories.get(key)?.verifiedAt ?? 0;
  histories.delete(key);
  const messages = history.messages.slice(-50);
  histories.set(key, {
    verifiedAt,
    messages,
    older: history.messages.length > 50 ? messages[0]!.sequence : history.older,
    receipts: Object.fromEntries(
      messages.map((message) => [
        message.id,
        history.receipts[message.id] ?? {},
      ]),
    ),
  });
  if (histories.size > 20) histories.delete(histories.keys().next().value!);
}
export function clearHistoryCache() {
  generation++;
  pending.clear();
  histories.clear();
}
