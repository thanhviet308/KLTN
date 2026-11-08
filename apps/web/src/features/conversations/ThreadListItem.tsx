import { Avatar } from '../../components/Avatar';
import { messageSummary } from '../../lib/chat-model';
import {
  presenceBadge,
  presenceLabel,
  type Presence,
} from '../../hooks/usePresence';
import { conversationTitle, type Conversation } from './types';

export function ThreadListItem({
  item,
  currentUserId,
  selected,
  busy,
  directNames,
  presence,
  onPreload,
  onSelect,
}: {
  item: Conversation;
  currentUserId: string;
  selected: boolean;
  busy: boolean;
  directNames: Record<string, string>;
  presence: Record<string, Presence>;
  onPreload: () => void;
  onSelect: () => void;
}) {
  const peerPresence = item.peer ? presence[item.peer.id] : undefined;
  const title = conversationTitle(item, directNames);
  return (
    <li>
      <button
        className={`${selected ? 'selected' : ''}${item.unreadCount ? ' unread' : ''}`}
        disabled={busy}
        aria-current={selected ? 'true' : undefined}
        onMouseEnter={onPreload}
        onFocus={onPreload}
        onClick={onSelect}
      >
        <span className="peer-avatar presence-avatar">
          {peerPresence?.online && (
            <span className="presence-dot" aria-label="Đang hoạt động" />
          )}
          <Avatar
            peer={
              item.peer ?? {
                displayName: item.title ?? directNames[item.id] ?? 'H',
              }
            }
          />
          {item.peer && presenceBadge(peerPresence) && (
            <span
              className="presence-last-active"
              title={presenceLabel(peerPresence)}
              aria-label={presenceLabel(peerPresence)}
            >
              {presenceBadge(peerPresence)}
            </span>
          )}
        </span>
        <span className="thread-summary">
          <strong>{title}</strong>
          <div className="thread-preview-row">
            <small>
              {item.lastMessage
                ? `${item.lastMessage.senderId === currentUserId ? 'Bạn: ' : item.type === 'group' ? `${item.lastMessage.senderName ?? 'Thành viên'}: ` : ''}${messageSummary(item.lastMessage)}`
                : 'Hãy gửi lời chào 👋'}
            </small>
          </div>
        </span>
        {!!item.unreadCount && (
          <span
            className="unread-badge"
            aria-label={`${item.unreadCount} tin nhắn chưa đọc`}
          >
            {item.unreadCount > 99 ? '99+' : item.unreadCount}
          </span>
        )}
      </button>
    </li>
  );
}
