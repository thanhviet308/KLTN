export interface NoticeActor {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
}

export interface NoticePayload {
  title?: string;
  actorId?: string;
  actorName?: string;
  requesterId?: string;
  userId?: string;
  requestId?: string;
  callerId?: string;
  senderId?: string;
  conversationId?: string;
  callId?: string;
  messageId?: string;
}

export interface Notice {
  id: string;
  type: string;
  payload: NoticePayload;
  actor?: NoticeActor | null;
  createdAt: string;
  readAt: string | null;
}

export type NotificationDestination =
  | { tab: 'incoming'; requestId?: string; actorId?: string }
  | { tab: 'conversations'; recipientId?: string; conversationId?: string }
  | { tab: 'friends'; actorId?: string };

export interface FormattedNotice {
  actor?: NoticeActor;
  actorName?: string;
  body: string;
  hint?: string;
}

function resolveActorId(notice: Notice): string | undefined {
  const { actor, payload } = notice;
  const candidate =
    actor?.id ||
    payload.actorId ||
    payload.requesterId ||
    payload.userId ||
    payload.callerId ||
    payload.senderId;
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : undefined;
}

export function resolveNoticeActor(notice: Notice): NoticeActor | undefined {
  const actorName =
    notice.actor?.displayName?.trim() || notice.payload.actorName?.trim();
  if (!actorName) return undefined;
  return {
    id: resolveActorId(notice) ?? '',
    displayName: actorName,
    avatarUrl: notice.actor?.avatarUrl ?? null,
  };
}

export function formatNoticeContent(notice: Notice): FormattedNotice {
  const actor = resolveNoticeActor(notice);
  const actorName = actor?.displayName;
  switch (notice.type) {
    case 'friend_request':
      return actorName
        ? {
            actor,
            actorName,
            body: 'đã gửi cho bạn lời mời kết bạn.',
            hint: 'Nhấn để xem lời mời kết bạn',
          }
        : {
            body: notice.payload.title || 'Bạn có lời mời kết bạn mới.',
            hint: 'Nhấn để xem lời mời kết bạn',
          };
    case 'friend_accepted':
      return actorName
        ? {
            actor,
            actorName,
            body: 'đã chấp nhận lời mời kết bạn của bạn.',
            hint: 'Nhấn để nhắn tin',
          }
        : {
            body: notice.payload.title || 'Lời mời kết bạn đã được chấp nhận.',
            hint: 'Nhấn để xem danh sách bạn bè',
          };
    case 'call': {
      const isVideo = notice.payload.title?.toLowerCase().includes('video');
      return actorName
        ? {
            actor,
            actorName,
            body: isVideo
              ? 'đã gọi video nhỡ cho bạn.'
              : 'đã gọi thoại nhỡ cho bạn.',
            hint: 'Nhấn để mở cuộc trò chuyện',
          }
        : {
            body: notice.payload.title || 'Bạn có cuộc gọi nhỡ.',
            hint: 'Nhấn để mở cuộc trò chuyện',
          };
    }
    case 'message':
      return actorName
        ? {
            actor,
            actorName,
            body: 'đã nhắc đến bạn trong một cuộc trò chuyện.',
            hint: 'Nhấn để mở cuộc trò chuyện',
          }
        : {
            body: notice.payload.title || 'Bạn được nhắc đến trong một nhóm.',
            hint: 'Nhấn để mở cuộc trò chuyện',
          };
    case 'ai_completed':
    case 'ai_failed':
      return {
        actor,
        actorName,
        body: notice.payload.title || 'Trợ lý AI đã cập nhật tiến trình.',
        hint: 'Nhấn để mở cuộc trò chuyện',
      };
    default: {
      const rawTitle = notice.payload.title || 'Bạn có thông báo mới.';
      if (actorName && rawTitle.startsWith(`${actorName} `)) {
        return {
          actor,
          actorName,
          body: rawTitle.slice(actorName.length + 1),
        };
      }
      return {
        actor,
        actorName,
        body: rawTitle,
      };
    }
  }
}

export function resolveNoticeDestination(
  notice: Notice,
): NotificationDestination | null {
  const actorId = resolveActorId(notice);
  switch (notice.type) {
    case 'friend_request':
      return {
        tab: 'incoming',
        requestId: notice.payload.requestId,
        actorId,
      };
    case 'friend_accepted':
      return actorId
        ? { tab: 'conversations', recipientId: actorId }
        : { tab: 'friends' };
    case 'call':
    case 'message':
    case 'ai_completed':
    case 'ai_failed':
      return {
        tab: 'conversations',
        conversationId: notice.payload.conversationId,
      };
    default:
      return null;
  }
}

export function formatRelativeNoticeTime(
  iso: string,
  now = Date.now(),
): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '';
  const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSeconds < 60) return 'Vừa xong';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} phút trước`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} ngày trước`;
  return new Date(timestamp).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
