import { useEffect, useState } from 'react';
import { Bell, BellOff, Pin, Search, Trash2 } from 'lucide-react';
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
  clearingHistory,
  searchActive,
  pinsActive,
  sharedMessages,
  onToggleSearch,
  onTogglePins,
  onToggleMute,
  onOpenInfo,
  onClearHistory,
  onViewAll,
}: {
  conversationId: string;
  heading: string | null;
  peer?: Peer;
  memberCount: number;
  presence: Record<string, Presence>;
  muted: boolean;
  clearingHistory?: boolean;
  searchActive?: boolean;
  pinsActive?: boolean;
  sharedMessages: Message[];
  onToggleSearch: () => void;
  onTogglePins: () => void;
  onToggleMute: () => void;
  onOpenInfo: () => void;
  onClearHistory: () => Promise<void>;
  onViewAll: (type: 'image' | 'file') => void;
}) {
  const [confirmClear, setConfirmClear] = useState(false);
  useEffect(() => {
    setConfirmClear(false);
  }, [conversationId]);
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
        <button
          type="button"
          aria-pressed={searchActive}
          onClick={onToggleSearch}
          title="Tìm trong cuộc trò chuyện"
        >
          <Search size={19} aria-hidden="true" />
          <span>Tìm kiếm</span>
        </button>
        <button
          type="button"
          aria-pressed={pinsActive}
          onClick={onTogglePins}
          title="Tin nhắn đã ghim"
        >
          <Pin size={19} aria-hidden="true" />
          <span>Đã ghim</span>
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
      <section className="summary-section">
        <h3>Quyền riêng tư & hỗ trợ</h3>
        <div className="summary-privacy-actions">
          {!confirmClear ? (
            <button
              type="button"
              className="summary-danger-trigger"
              disabled={clearingHistory}
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 size={15} aria-hidden="true" />
              <span>Xóa lịch sử trò chuyện</span>
            </button>
          ) : (
            <div className="summary-confirm-box" role="alert">
              <p>
                Xóa toàn bộ lịch sử trò chuyện trên tài khoản của bạn? Người
                khác vẫn giữ nguyên tin nhắn của họ.
              </p>
              <div className="summary-confirm-buttons">
                <button
                  type="button"
                  className="danger"
                  disabled={clearingHistory}
                  onClick={() =>
                    void onClearHistory().then(() => setConfirmClear(false))
                  }
                >
                  {clearingHistory ? 'Đang xóa…' : 'Xác nhận xóa'}
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={clearingHistory}
                  onClick={() => setConfirmClear(false)}
                >
                  Hủy
                </button>
              </div>
            </div>
          )}
          {peer && (
            <ReportButton
              target={{
                targetType: 'user',
                targetId: peer.id,
                label: `Báo cáo ${peer.displayName}`,
              }}
            />
          )}
        </div>
      </section>
    </aside>
  );
}
