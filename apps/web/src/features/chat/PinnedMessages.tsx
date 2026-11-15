import { useEffect, useState } from 'react';
import {
  Pin,
  PinOff,
  List,
  X,
  CornerDownRight,
  Image as ImageIcon,
  FileText,
  Mic,
  MapPin,
  Gamepad2,
} from 'lucide-react';
import {
  messageSummary,
  parseGameInviteBody,
  type Message,
} from '../../lib/chat-model';
import { WorkspaceDialog } from '../workspace/WorkspacePanels';
import './pinned-messages.css';

function pinPreviewText(message: Message) {
  if (message.deletedAt) return 'Tin nhắn đã thu hồi';
  if (message.type === 'image')
    return message.content?.fileName
      ? `Hình ảnh · ${message.content.fileName}`
      : 'Hình ảnh đính kèm';
  if (message.type === 'file')
    return message.content?.fileName
      ? `Tệp đính kèm · ${message.content.fileName}`
      : 'Tệp đính kèm';
  if (message.type === 'voice') return 'Tin nhắn thoại';
  if (message.type === 'location') return 'Vị trí được chia sẻ';
  return messageSummary(message);
}

function PinTypeBadge({ message }: { message: Message }) {
  if (message.type === 'image')
    return (
      <span className="pinned-type-chip">
        <ImageIcon size={12} aria-hidden="true" /> Ảnh
      </span>
    );
  if (message.type === 'file')
    return (
      <span className="pinned-type-chip">
        <FileText size={12} aria-hidden="true" /> Tệp
      </span>
    );
  if (message.type === 'voice')
    return (
      <span className="pinned-type-chip">
        <Mic size={12} aria-hidden="true" /> Thoại
      </span>
    );
  if (message.type === 'location')
    return (
      <span className="pinned-type-chip">
        <MapPin size={12} aria-hidden="true" /> Vị trí
      </span>
    );
  if (parseGameInviteBody(message.body))
    return (
      <span className="pinned-type-chip">
        <Gamepad2 size={12} aria-hidden="true" /> Trò chơi
      </span>
    );
  return null;
}

export function PinnedMessages({
  pins,
  names,
  onJump,
  onUnpin,
}: {
  pins: Message[];
  names: (id: string) => string;
  onJump: (message: Message) => Promise<void>;
  onUnpin: (message: Message) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (activeIndex >= pins.length) setActiveIndex(0);
    if (!pins.length && open) setOpen(false);
  }, [activeIndex, open, pins.length]);

  async function jump(message: Message, closeDialog = false) {
    setBusy(true);
    try {
      await onJump(message);
      if (closeDialog) setOpen(false);
      else if (pins.length > 1)
        setActiveIndex((prev) => (prev + 1) % pins.length);
    } finally {
      setBusy(false);
    }
  }

  async function handleUnpin(message: Message) {
    setBusy(true);
    try {
      await onUnpin(message);
    } finally {
      setBusy(false);
    }
  }

  if (!pins.length) return null;
  const safeIndex = activeIndex < pins.length ? activeIndex : 0;
  const current = pins[safeIndex]!;

  return (
    <>
      <div className="pinned-bar" aria-label="Tin nhắn đã ghim">
        <div className="pinned-bar-leading" aria-hidden="true">
          <span className="pinned-bar-badge">
            <Pin size={15} />
          </span>
          {pins.length > 1 && (
            <div className="pinned-bar-steps">
              {pins.map((item, idx) => (
                <span
                  key={item.id}
                  className={`pinned-bar-step${idx === safeIndex ? ' is-active' : ''}`}
                />
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="pinned-preview"
          disabled={busy}
          onClick={() => void jump(current, false)}
        >
          <div className="pinned-preview-meta">
            <span className="pinned-kicker">
              Tin đã ghim
              {pins.length > 1 ? ` (${safeIndex + 1}/${pins.length})` : ''}
            </span>
            <span className="pinned-dot" aria-hidden="true">
              ·
            </span>
            <strong className="pinned-sender">{names(current.senderId)}</strong>
            <PinTypeBadge message={current} />
          </div>
          <span className="pinned-preview-body">
            {busy ? 'Đang tìm tin nhắn…' : pinPreviewText(current)}
          </span>
        </button>
        <div className="pinned-bar-actions">
          <button
            type="button"
            className="pinned-list-btn"
            title="Xem danh sách tin đã ghim"
            aria-label={`Xem ${pins.length} tin nhắn đã ghim`}
            onClick={() => setOpen(true)}
          >
            <List size={15} aria-hidden="true" />
            <span>{pins.length > 1 ? `${pins.length} ghim` : 'Chi tiết'}</span>
          </button>
          {pins.length === 1 && (
            <button
              type="button"
              className="pinned-quick-unpin"
              disabled={busy}
              title="Bỏ ghim tin nhắn này"
              aria-label="Bỏ ghim tin nhắn"
              onClick={() => void handleUnpin(current)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {open && (
        <WorkspaceDialog
          title={`Tin nhắn đã ghim (${pins.length})`}
          onClose={() => setOpen(false)}
        >
          <div className="pinned-dialog-list">
            {pins.map((m, index) => {
              const sender = names(m.senderId);
              return (
                <article className="pinned-card" key={m.id}>
                  <div className="pinned-card-header">
                    <span className="pinned-card-avatar" aria-hidden="true">
                      {sender.trim().charAt(0).toUpperCase() || 'U'}
                    </span>
                    <div className="pinned-card-author">
                      <strong>{sender}</strong>
                      <time dateTime={m.createdAt}>
                        {new Date(m.createdAt).toLocaleString('vi-VN', {
                          hour: '2-digit',
                          minute: '2-digit',
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </time>
                    </div>
                    <span className="pinned-card-index">#{index + 1}</span>
                  </div>
                  <button
                    type="button"
                    className="pinned-card-body"
                    disabled={busy}
                    onClick={() => void jump(m, true)}
                  >
                    <PinTypeBadge message={m} />
                    <p>{pinPreviewText(m)}</p>
                  </button>
                  <div className="pinned-card-footer">
                    <button
                      type="button"
                      className="pinned-action-btn is-jump"
                      disabled={busy}
                      onClick={() => void jump(m, true)}
                    >
                      <CornerDownRight size={14} aria-hidden="true" />
                      <span>Đi tới tin nhắn</span>
                    </button>
                    <button
                      type="button"
                      className="pinned-action-btn is-unpin"
                      disabled={busy}
                      title="Bỏ ghim"
                      aria-label="Bỏ ghim tin nhắn"
                      onClick={() => void handleUnpin(m)}
                    >
                      <PinOff size={14} aria-hidden="true" />
                      <span>Bỏ ghim</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </WorkspaceDialog>
      )}
    </>
  );
}
