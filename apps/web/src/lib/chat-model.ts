export type ReplyTargetType =
  'text' | 'image' | 'file' | 'voice' | 'location' | 'call' | 'deleted';

export interface ReplySummary {
  messageId?: string;
  senderId?: string;
  legacySenderName?: string;
  type: ReplyTargetType;
  excerpt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  sequence: string;
  body: string | null;
  type?: 'text' | 'image' | 'file' | 'voice' | 'location' | 'call';
  content?: {
    mentions?: string[];
    forwarded?: boolean;
    attachmentId?: string;
    fileName?: string;
    mimeType?: string;
    size?: number;
    latitude?: number;
    longitude?: number;
    callId?: string;
    callType?: 'audio' | 'video';
    callStatus?: 'ended' | 'rejected' | 'missed' | 'cancelled';
    durationSeconds?: number;
    replyTo?: {
      messageId: string;
      senderId: string;
      type: ReplyTargetType;
      excerpt: string;
    };
  } | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  spam?: {
    suspicious: boolean;
    score: number;
    model: string;
  } | null;
  createdAt: string;
}
export interface Receipt {
  messageId: string;
  userId: string;
  deliveredAt: string | null;
  readAt: string | null;
}
export interface History {
  items: Message[];
  nextCursor: string | null;
  highWatermark: string;
}
export function newestMessagesFirst(messages: Message[]) {
  return [...messages].sort((a, b) =>
    BigInt(a.sequence) > BigInt(b.sequence)
      ? -1
      : BigInt(a.sequence) < BigInt(b.sequence)
        ? 1
        : 0,
  );
}
export function mergeMessages(previous: Message[], incoming: Message[]) {
  const entries = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) {
    const existing = entries.get(message.id);
    // A delayed history response must not undo an edit or restore a deleted message.
    if (existing?.deletedAt && !message.deletedAt) continue;
    const version = (item: Message) =>
      Date.parse(item.deletedAt ?? item.editedAt ?? item.createdAt);
    if (existing && version(existing) > version(message)) continue;
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
export function mergeReceipt(
  previous: Receipt | undefined,
  next: Receipt,
): Receipt {
  return {
    ...next,
    deliveredAt: previous?.deliveredAt ?? next.deliveredAt,
    readAt: previous?.readAt ?? next.readAt,
  };
}

export function parseGameInviteBody(body: string | null | undefined): {
  gameType: string;
  gameId?: string;
  text: string;
} | null {
  if (!body) return null;
  const match =
    /^🎮\s*\[GAME_INVITE:([a-z0-9_]+)(?::([a-f0-9-]+))?\]\s*(.*)$/i.exec(
      body.trim(),
    );
  if (!match) return null;
  return {
    gameType: match[1]!,
    gameId: match[2],
    text: match[3] || 'Đã gửi lời mời chơi trò chơi',
  };
}

const LEGACY_QUOTE_PATTERN =
  /^> ([^:\n]{1,100}): ?([^\n]*(?:\n> [^\n]*)*)\n\n([\s\S]+)$/;

export function extractMessageReply(
  message: Pick<Message, 'body' | 'deletedAt' | 'content'>,
): { reply?: ReplySummary; body: string | null } {
  if (message.deletedAt) return { body: message.body };
  if (message.content?.replyTo) {
    return {
      reply: message.content.replyTo,
      body: message.body,
    };
  }
  if (message.body) {
    const match = LEGACY_QUOTE_PATTERN.exec(message.body);
    if (match) {
      const legacySenderName = match[1]!.trim();
      const rawQuote = match[2]!.replace(/\n> /g, '\n').trim();
      const cleanBody = match[3]!;
      return {
        reply: {
          legacySenderName,
          type: 'text',
          excerpt: rawQuote || 'Tin nhắn đã trích dẫn',
        },
        body: cleanBody,
      };
    }
  }
  return { body: message.body };
}

export function buildReplyDraftSummary(
  target: Pick<
    Message,
    'id' | 'senderId' | 'deletedAt' | 'body' | 'type' | 'content'
  >,
): ReplySummary {
  const type: ReplyTargetType = target.deletedAt
    ? 'deleted'
    : (target.type ?? 'text');
  const cleanSummary = messageSummary(target).replace(/\s+/g, ' ').trim();
  const excerpt =
    cleanSummary.length > 140
      ? `${cleanSummary.slice(0, 139)}…`
      : cleanSummary || 'Tin nhắn';
  return {
    messageId: target.id,
    senderId: target.senderId,
    type,
    excerpt,
  };
}

export function messageSummary(
  message: Pick<Message, 'deletedAt' | 'body' | 'type' | 'content'>,
) {
  if (message.deletedAt) return 'Tin nhắn đã thu hồi';
  const cleanBody = extractMessageReply(message).body;
  if (cleanBody) {
    const gameInvite = parseGameInviteBody(cleanBody);
    if (gameInvite) return `🎮 ${gameInvite.text}`;
    return cleanBody;
  }
  if (message.type === 'location') return 'Vị trí được chia sẻ';
  if (message.type === 'voice') return 'Tin nhắn thoại';
  if (message.type === 'call') {
    const video = message.content?.callType === 'video';
    const status = message.content?.callStatus;
    if (status === 'missed')
      return `Cuộc gọi ${video ? 'video' : 'thoại'} bị nhỡ`;
    if (status === 'rejected')
      return `Cuộc gọi ${video ? 'video' : 'thoại'} bị từ chối`;
    if (status === 'cancelled')
      return `Cuộc gọi ${video ? 'video' : 'thoại'} đã hủy`;
    return `Cuộc gọi ${video ? 'video' : 'thoại'}`;
  }
  return (
    message.content?.fileName ??
    (message.type === 'image' ? 'Ảnh' : 'Tệp đính kèm')
  );
}
