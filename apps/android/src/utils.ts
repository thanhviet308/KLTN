import * as api from './api';

export function conversationName(item: api.Conversation) {
  return item.type === 'direct'
    ? (item.peer?.displayName ?? 'Trò chuyện')
    : (item.title ?? 'Nhóm');
}

export function initials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .slice(-2)
    .map(part => part[0])
    .join('')
    .toUpperCase();
}

export function shortTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function mergeMessages(current: api.Message[], incoming: api.Message[]) {
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) {
    const existing = byId.get(message.id);
    if (existing?.deletedAt && !message.deletedAt) continue;
    const version = (item: api.Message) =>
      Date.parse(item.deletedAt ?? item.editedAt ?? item.createdAt);
    if (existing && version(existing) > version(message)) continue;
    if (
      existing?.content?.summaryAvailable &&
      !message.content?.summaryAvailable &&
      !message.deletedAt
    )
      continue;
    byId.set(message.id, message);
  }
  return [...byId.values()].sort((left, right) =>
    BigInt(left.sequence) < BigInt(right.sequence)
      ? -1
      : BigInt(left.sequence) > BigInt(right.sequence)
        ? 1
        : 0,
  );
}

export type ReplyTargetType =
  'text' | 'image' | 'file' | 'voice' | 'location' | 'call' | 'deleted';

export interface ReplySummary {
  messageId?: string;
  senderId?: string;
  legacySenderName?: string;
  type: ReplyTargetType;
  excerpt: string;
}

const LEGACY_QUOTE_PATTERN =
  /^> ([^:\n]{1,100}): ?([^\n]*(?:\n> [^\n]*)*)\n\n([\s\S]+)$/;

export function extractMessageReply(
  message: Pick<api.Message, 'body' | 'deletedAt' | 'content'>,
): { reply?: ReplySummary; body: string | null } {
  if (message.deletedAt) return { body: message.body };
  if (message.content?.replyTo) {
    return { reply: message.content.replyTo, body: message.body };
  }
  if (message.body) {
    const match = LEGACY_QUOTE_PATTERN.exec(message.body);
    if (match) {
      return {
        reply: {
          legacySenderName: match[1]!.trim(),
          type: 'text',
          excerpt:
            match[2]!.replace(/\n> /g, '\n').trim() || 'Tin nhắn đã trích dẫn',
        },
        body: match[3]!,
      };
    }
  }
  return { body: message.body };
}

export function unwrapReplyPreviewBody(body?: string | null): string | null {
  if (!body) return body ?? null;
  const match = LEGACY_QUOTE_PATTERN.exec(body);
  return match ? match[3]! : body;
}

export function clientMessageId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, token => {
    const random = Math.floor(Math.random() * 16);
    return (token === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}
