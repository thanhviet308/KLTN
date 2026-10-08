import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as api from './api';
import type { Message } from './chat-model';

export function MessageActions({
  message,
  mine,
  onUpdate,
  onReply,
}: {
  message: Message;
  mine: boolean;
  onUpdate: (message: Message) => void;
  onReply: (message: Message) => void;
}) {
  const [mode, setMode] = useState<'forward' | 'edit' | 'recall'>();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [version, setVersion] = useState<string | null>(null);
  const [targets, setTargets] = useState<{ id: string; title: string }[]>([]);
  const [target, setTarget] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());
  const closeButton = useRef<HTMLButtonElement>(null);
  async function loadTargets(next?: string) {
    const page = await api.authenticated<{
      items: { id: string; title: string | null; type: string }[];
      nextCursor: string | null;
    }>(`/conversations?limit=50${next ? `&cursor=${next}` : ''}`);
    const rows = await Promise.all(
      page.items
        .filter((item) => item.id !== message.conversationId)
        .map(async (item) => {
          if (item.title) return { id: item.id, title: item.title };
          const members = await api.authenticated<{
            items: { user: { displayName: string } }[];
          }>(`/conversations/${item.id}/members?limit=2`);
          return {
            id: item.id,
            title: members.items
              .map((member) => member.user.displayName)
              .join(' & '),
          };
        }),
    );
    setTargets((previous) => (next ? [...previous, ...rows] : rows));
    setCursor(page.nextCursor);
  }
  async function open(action: 'forward' | 'edit' | 'recall') {
    setMode(action);
    setReady(false);
    setError('');
    setBusy(true);
    setTarget('');
    keys.current.clear();
    setTimeout(() => closeButton.current?.focus(), 0);
    try {
      const result = await api.authenticated<{ message: Message }>(
        `/conversations/${message.conversationId}/messages/${message.id}`,
      );
      onUpdate(result.message);
      if (result.message.deletedAt)
        throw new Error('Tin nhắn đã được thu hồi.');
      setText(result.message.body ?? '');
      setVersion(result.message.editedAt ?? null);
      if (action === 'forward') {
        setTargets([]);
        await loadTargets();
      }
      setReady(true);
    } catch (e) {
      setError(
        e instanceof api.ApiError
          ? api.errorMessage(e)
          : 'Tin nhắn không còn khả dụng.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (busy || !ready) return;
    if (mode === 'forward' && !target) {
      setError('Chọn cuộc trò chuyện muốn chuyển tiếp.');
      return;
    }
    if (mode === 'edit' && (!text.trim() || text.length > 10000)) {
      setError('Tin nhắn cần từ 1 đến 10.000 ký tự.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (mode === 'forward') {
        const key = keys.current.get(target) ?? crypto.randomUUID();
        keys.current.set(target, key);
        await api.authenticated(`/conversations/${target}/messages`, {
          body: text,
          clientMessageId: key,
        });
      } else {
        const result = await api.authenticated<{ message: Message }>(
          `/conversations/${message.conversationId}/messages/${message.id}`,
          mode === 'edit'
            ? { body: text, expectedEditedAt: version }
            : undefined,
          mode === 'edit' ? 'PATCH' : 'DELETE',
        );
        onUpdate(result.message);
      }
      setMode(undefined);
    } catch (e) {
      if (e instanceof api.ApiError && e.code === 'MESSAGE_EDIT_CONFLICT') {
        setError(
          'Tin đã được sửa ở nơi khác. Đóng và mở lại để xem phiên bản mới.',
        );
      } else setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (message.deletedAt || (message.type && message.type !== 'text'))
    return null;
  return (
    <>
      <div className="message-tools">
        <button
          type="button"
          data-tooltip="Trả lời tin nhắn"
          aria-label="Trả lời tin nhắn"
          onClick={() => onReply(message)}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m9 4-6 6 6 6M3 10h9c6 0 9 4 9 10" />
          </svg>
        </button>
        <button
          type="button"
          data-tooltip="Chuyển tiếp tin nhắn"
          aria-label="Chuyển tiếp tin nhắn"
          onClick={() => void open('forward')}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="m14 4 7 7-7 7V13C7 13 4 16 3 20c0-9 4-13 11-13Z" />
          </svg>
        </button>
        {mine && (
          <>
            <button
              type="button"
              data-tooltip="Sửa tin nhắn"
              aria-label="Sửa tin nhắn"
              onClick={() => void open('edit')}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m16 3 5 5-13 13H3v-5Z" />
              </svg>
            </button>
            <button
              type="button"
              data-tooltip="Thu hồi tin nhắn"
              aria-label="Thu hồi tin nhắn"
              onClick={() => void open('recall')}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
              </svg>
            </button>
          </>
        )}
      </div>
      {mode &&
        createPortal(
          <div
            className="message-modal-backdrop"
            onClick={(e) => {
              if (e.target === e.currentTarget && !busy) setMode(undefined);
            }}
          >
            <section
              className="message-action-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={
                mode === 'forward'
                  ? 'Chuyển tiếp tin nhắn'
                  : mode === 'edit'
                    ? 'Sửa tin nhắn'
                    : 'Thu hồi tin nhắn'
              }
              onKeyDown={(e) => {
                if (e.key === 'Escape' && !busy) setMode(undefined);
                if (e.key === 'Tab') {
                  const elements = [
                    ...e.currentTarget.querySelectorAll<HTMLElement>(
                      'button:not(:disabled), textarea, select',
                    ),
                  ];
                  const first = elements[0],
                    last = elements.at(-1);
                  if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                  } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                  }
                }
              }}
            >
              <button
                ref={closeButton}
                className="retry modal-close"
                disabled={busy}
                onClick={() => setMode(undefined)}
              >
                Đóng
              </button>
              <h2>
                {mode === 'forward'
                  ? 'Chuyển tiếp tin nhắn'
                  : mode === 'edit'
                    ? 'Sửa tin nhắn'
                    : 'Thu hồi tin nhắn?'}
              </h2>
              {error && (
                <p className="message error" role="alert">
                  {error}
                </p>
              )}
              {mode === 'recall' ? (
                <p>
                  Tin này sẽ được thay bằng “Tin nhắn đã thu hồi” với mọi người.
                </p>
              ) : mode === 'edit' ? (
                <textarea
                  aria-label="Nội dung sửa"
                  value={text}
                  maxLength={10000}
                  disabled={busy}
                  onChange={(e) => setText(e.target.value)}
                />
              ) : (
                <>
                  <p className="forward-preview">{text}</p>
                  <label>
                    Chọn cuộc trò chuyện
                    <select
                      disabled={busy}
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                    >
                      <option value="">Chọn nơi gửi</option>
                      {targets.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {cursor && (
                    <button
                      className="retry"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true);
                        void loadTargets(cursor)
                          .catch((e) => setError(api.errorMessage(e)))
                          .finally(() => setBusy(false));
                      }}
                    >
                      Xem thêm
                    </button>
                  )}
                  <p className="hint">Nội dung sẽ được gửi dưới tên của bạn.</p>
                </>
              )}
              <button
                className="primary"
                disabled={busy || !ready || (mode === 'forward' && !target)}
                onClick={() => void submit()}
              >
                {busy
                  ? 'Đang xử lý…'
                  : mode === 'forward'
                    ? 'Chuyển tiếp'
                    : mode === 'edit'
                      ? 'Lưu thay đổi'
                      : 'Thu hồi'}
              </button>
            </section>
          </div>,
          document.body,
        )}
    </>
  );
}
