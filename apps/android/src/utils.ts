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
  memory_match: {
    name: 'Lật Hình Trí Nhớ',
    subtitle: 'Trí nhớ & Quan sát',
    badge: '4×4 · Lật thẻ bài',
  },
  treasure_hunt: {
    name: 'Săn Kho Báu Né Bom',
    subtitle: 'Phiêu lưu & Dò mìn',
    badge: '6×6 · Đào kho báu',
  },
  rps_showdown: {
    name: 'Oẳn Tù Tì Đại Chiến',
    subtitle: 'Đấu tâm lý 5 hiệp',
    badge: 'BO5 · Phản xạ & Tâm lý',
  },
  pirate_roulette: {
    name: 'Hải Tặc Đâm Thùng',
    subtitle: 'Tiệc tùng & Hồi hộp',
    badge: '20 khe · Thử vận may',
  },
  sudoku_duel: {
    name: 'Giải Mã Sudoku Đôi',
    subtitle: 'Giải đố & Logic số',
    badge: '4×4 · Đấu trí logic',
  },
  xiangqi: {
    name: 'Cờ tướng',
    subtitle: 'Kỳ đạo phương Đông',
    badge: '10×9 · Cờ truyền thống',
  },
  chess: {
    name: 'Cờ vua',
    subtitle: 'Trí tuệ quốc tế',
    badge: '8×8 · Cờ quốc tế',
  },
  caro: {
    name: 'Caro 5 quân',
    subtitle: 'Chiến thuật cổ điển',
    badge: '15×15 · Xếp 5 quân',
  },
  othello: {
    name: 'Cờ lật Othello',
    subtitle: 'Kẹp & lật quân',
    badge: '8×8 · Lật cờ',
  },
  checkers: {
    name: 'Cờ đam',
    subtitle: 'Nhảy chéo bắt quân',
    badge: '8×8 · Nhảy chéo',
  },
  co_ganh: {
    name: 'Cờ gánh',
    subtitle: 'Dân gian Việt Nam',
    badge: '5×5 · Dân gian',
  },
  connect_four: {
    name: 'Bốn quân liên tiếp',
    subtitle: 'Thả đĩa xếp hàng',
    badge: '6×7 · Thả đĩa',
  },
  connect4: {
    name: 'Bốn quân liên tiếp',
    subtitle: 'Thả đĩa xếp hàng',
    badge: '6×7 · Thả đĩa',
  },
  tic_tac_toe: {
    name: 'Cờ 3×3',
    subtitle: 'Đối kháng siêu tốc',
    badge: '3×3 · Siêu tốc',
  },
  group_bomb_pass: {
    name: 'Chuyền Bom Hẹn Giờ',
    subtitle: 'Tiệc tùng nhóm · Cắt dây bom',
    badge: 'Nhóm · 16 dây ngòi nổ',
    groupOnly: true,
  },
  group_truth_dare: {
    name: 'Sự Thật Hay Thử Thách',
    subtitle: 'Khuấy động phòng chat nhóm',
    badge: 'Nhóm · Truth or Dare',
    groupOnly: true,
  },
  group_lucky_wheel: {
    name: 'Đua Nhân Phẩm Nhóm',
    subtitle: 'Thử vận may tập thể',
    badge: 'Nhóm · 16 Rương bí ẩn',
    groupOnly: true,
  },
  group_spy_hunt: {
    name: 'Truy Tìm Gián Điệp',
    subtitle: 'Suy luận & Tình báo nhóm',
    badge: 'Nhóm · Căn cứ 5×5',
    groupOnly: true,
  },
  group_heist_vault: {
    name: 'Phi Vụ Phá Két Sắt',
    subtitle: 'Giải mã 4 vòng khóa số',
    badge: 'Nhóm · 4 Khóa mật mã',
    groupOnly: true,
  },
  group_quiz_arena: {
    name: 'Đấu Trường Đố Vui Nhóm',
    subtitle: 'Trắc nghiệm tốc độ 5 hiệp',
    badge: 'Nhóm · 5 Câu hỏi nhanh',
    groupOnly: true,
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
