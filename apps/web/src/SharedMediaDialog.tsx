import { useEffect, useRef, useState } from 'react';
import * as api from './api';
import type { History, Message } from './chat-model';
import { MessageMedia } from './ChatMedia';
import { SharedFileRow } from './SharedFileRow';

export function SharedMediaDialog({
  conversationId,
  type,
  onClose,
}: {
  conversationId: string;
  type: 'image' | 'file';
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const alive = useRef(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  async function load(before?: string) {
    setBusy(true);
    setError('');
    try {
      const page = await api.authenticated<History>(
        `/conversations/${conversationId}/messages?direction=backward&limit=50${before ? `&cursor=${encodeURIComponent(before)}` : ''}`,
      );
      if (!alive.current) return;
      setMessages((previous) => [
        ...new Map(
          [...previous, ...page.items].map((message) => [message.id, message]),
        ).values(),
      ]);
      setCursor(page.nextCursor);
    } catch (error) {
      if (alive.current) setError(api.errorMessage(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  const matching = messages.filter(
    (message) => message.type === type && !message.deletedAt,
  );
  return (
    <dialog
      ref={dialog}
      className="shared-media-dialog"
      aria-labelledby="shared-media-heading"
      onCancel={onClose}
      onClose={onClose}
    >
      <header>
        <h2 id="shared-media-heading">
          {type === 'image' ? 'Ảnh đã chia sẻ' : 'Tệp đã chia sẻ'}
        </h2>
        <button type="button" onClick={onClose} aria-label="Đóng danh sách">
          ×
        </button>
      </header>
      <div
        className={
          type === 'image' ? 'shared-gallery-grid' : 'shared-file-list'
        }
      >
        {matching.map((message) =>
          type === 'file' ? (
            <SharedFileRow key={message.id} message={message} />
          ) : (
            <MessageMedia key={message.id} message={message} />
          ),
        )}
      </div>
      {!busy && matching.length === 0 && (
        <p>
          {cursor
            ? 'Chưa có trong phần lịch sử này. Bạn có thể tải thêm.'
            : 'Chưa có nội dung được chia sẻ.'}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Đang tải…</p>}
      {!busy && (cursor || error) && (
        <button
          type="button"
          className="secondary"
          onClick={() => void load(cursor ?? undefined)}
        >
          {error ? 'Thử lại' : 'Tải thêm lịch sử'}
        </button>
      )}
    </dialog>
  );
}
