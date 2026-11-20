import * as api from './api';

export function conversationName(item: api.Conversation) {
  if (item.title) return item.title;
  if (item.type === 'direct') {
    if (item.peer && item.nicknames?.[item.peer.id]) {
      return item.nicknames[item.peer.id];
    }
    return item.peer?.displayName ?? 'Trò chuyện riêng';
  }
  return 'Nhóm';
}

export function initials(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || '?';
}

export function shortTime(value: string) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function dividerTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return shortTime(value);
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(date);
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

export const GAME_CATALOG: Record<
  string,
  { name: string; subtitle: string; badge: string; groupOnly?: boolean }
> = {
  caro: {
    name: 'Cờ Caro 5 nước',
    subtitle: 'Đấu trí 1v1 trên bàn cờ 15×15',
    badge: '1v1 · Chiến thuật',
  },
  chess: {
    name: 'Cờ Vua Quốc Tế',
    subtitle: 'Đấu trí chiến thuật 64 ô kinh điển',
    badge: '1v1 · Kinh điển',
  },
  xiangqi: {
    name: 'Cờ Tướng',
    subtitle: 'Tranh tài điều binh khiển tướng qua sông',
    badge: '1v1 · Trí tuệ',
  },
  othello: {
    name: 'Cờ Lật (Othello)',
    subtitle: 'Lật cờ chiếm góc trên bàn 8×8',
    badge: '1v1 · Tốc độ',
  },
  connect4: {
    name: 'Thả Cờ 4 Hàng',
    subtitle: 'Thả quân nối 4 ô liên tiếp',
    badge: '1v1 · Nhanh gọn',
  },
  wordchain: {
    name: 'Đấu Trường Nối Từ',
    subtitle: 'Phản xạ ngôn từ cùng cả nhóm',
    badge: 'Nhóm · Vui nhộn',
    groupOnly: true,
  },
  quiz: {
    name: 'Đấu Trí Đố Vui',
    subtitle: 'Trả lời nhanh câu hỏi kiến thức',
    badge: 'Nhóm · Tranh hạng',
    groupOnly: true,
  },
  treasure: {
    name: 'Săn Kho Báu Nhóm',
    subtitle: 'Mở ô bí ẩn tìm kho báu vàng',
    badge: 'Nhóm · May mắn',
    groupOnly: true,
  },
};

export function messageSummary(
  message: Pick<api.Message, 'deletedAt' | 'body' | 'type' | 'content'>,
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

export function threadPreviewText(
  item: api.Conversation,
  currentUserId: string,
) {
  if (!item.lastMessage) return 'Hãy gửi lời chào 👋';
  const prefix =
    item.lastMessage.senderId === currentUserId
      ? 'Bạn: '
      : item.type === 'group'
        ? `${item.nicknames?.[item.lastMessage.senderId] ?? item.lastMessage.senderName ?? 'Thành viên'}: `
        : '';
  return `${prefix}${messageSummary({
    deletedAt: item.lastMessage.deletedAt,
    body: item.lastMessage.body,
    type: item.lastMessage.type ?? 'text',
    content: item.lastMessage.content,
  })}`;
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
