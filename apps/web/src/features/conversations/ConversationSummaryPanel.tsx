import { Bell, BellOff } from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import { UiIcon } from '../../components/UiIcon';
import { presenceLabel, type Presence } from '../../hooks/usePresence';
import { newestMessagesFirst, type Message } from '../../lib/chat-model';
import type { Peer } from '../../lib/types';
import { MessageMedia } from '../chat/ChatMedia';
import { ReportButton } from '../reports/ReportDialog';
import { SharedFileRow } from './SharedFileRow';

/** Live (non-deleted) shared messages of one type in a conversation. */
function sharedOfType(
  messages: Message[],
  conversationId: string,
  type: 'image' | 'file',
) {
  return newestMessagesFirst(
    messages.filter(
      (message) =>
        message.conversationId === conversationId &&
        message.type === type &&
        !message.deletedAt,
    ),
  );
}

export function ConversationSummaryPanel({
  conversationId,
  heading,
  peer,
  memberCount,
  presence,
  muted,
  sharedMessages,
  onCall,
  onToggleMute,
  onOpenInfo,
  onViewAll,
}: {
  conversationId: string;
  heading: string | null;
  peer?: Peer;
  memberCount: number;
  presence: Record<string, Presence>;
  muted: boolean;
  sharedMessages: Message[];
  onCall: (kind: 'audio' | 'video') => void;
  onToggleMute: () => void;
  onOpenInfo: () => void;
  onViewAll: (type: 'image' | 'file') => void;
}) {
  const images = sharedOfType(sharedMessages, conversationId, 'image');
  const files = sharedOfType(sharedMessages, conversationId, 'file');
  return (
    <aside className="chat-summary-panel" aria-label="Tóm tắt cuộc trò chuyện">
      <div className="summary-profile">
        <span className="summary-avatar">
          <Avatar
            peer={
              peer ?? { id: conversationId, displayName: heading ?? 'Nhóm' }
            }
          />
        </span>
        <h2>{heading}</h2>
        <p>
          {peer
            ? presenceLabel(presence[peer.id])
            : `${memberCount} thành viên`}
        </p>
      </div>
      <div className="summary-actions">
        <button type="button" onClick={() => onCall('audio')}>
          <UiIcon name="phone" />
          <span>Gọi thoại</span>
        </button>
        <button type="button" onClick={() => onCall('video')}>
          <UiIcon name="video" />
          <span>Gọi video</span>
        </button>
        <button
          type="button"
          aria-pressed={muted}
          onClick={onToggleMute}
          title="Bật hoặc tắt âm báo tin nhắn trên trình duyệt này"
        >
          {muted ? <BellOff size={20} /> : <Bell size={20} />}
          <span>{muted ? 'Bật thông báo' : 'Tắt thông báo'}</span>
        </button>
        <button type="button" onClick={onOpenInfo}>
          <UiIcon name="info" />
          <span>Thông tin</span>
        </button>
      </div>
      <section className="summary-section">
        {muted && (
          <p className="summary-empty" role="status">
            Đã tắt âm báo tin nhắn trên trình duyệt này.
          </p>
        )}
        <div className="summary-section-heading">
          <h3>Ảnh đã chia sẻ</h3>
          <button type="button" onClick={() => onViewAll('image')}>
            Xem tất cả
          </button>
        </div>
        <div className="summary-media-grid">
          {images.slice(0, 6).map((message) => (
            <MessageMedia key={message.id} message={message} />
          ))}
        </div>
        {images.length === 0 && (
          <p className="summary-empty">
            Chưa có ảnh trong các tin nhắn đã tải.
          </p>
        )}
      </section>
      <section className="summary-section">
        <div className="summary-section-heading">
          <h3>Tệp đã chia sẻ</h3>
          <button type="button" onClick={() => onViewAll('file')}>
            Xem tất cả
          </button>
        </div>
        {files.slice(0, 4).map((message) => (
          <SharedFileRow key={message.id} message={message} />
        ))}
        {files.length === 0 && (
          <p className="summary-empty">
            Chưa có tệp trong các tin nhắn đã tải.
          </p>
        )}
      </section>
      {peer && (
        <section className="summary-section">
          <h3>Quyền riêng tư & hỗ trợ</h3>
          <ReportButton
            target={{
              targetType: 'user',
              targetId: peer.id,
              label: `Báo cáo ${peer.displayName}`,
            }}
          />
        </section>
      )}
    </aside>
  );
}
