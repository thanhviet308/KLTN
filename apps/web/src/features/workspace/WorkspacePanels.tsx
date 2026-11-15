import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import * as api from '../../lib/api';
import { messageSummary, type Message } from '../../lib/chat-model';
import './workspace.css';

export function WorkspaceDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closing = useRef(false);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  function closeDialog() {
    if (closing.current) return;
    closing.current = true;
    // Release the native modal/backdrop as well as the React panel state.
    ref.current?.close();
    closeCallback.current();
  }
  useEffect(() => {
    const focus = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    closing.current = false;
    dialog?.showModal();
    return () => {
      closing.current = true;
      dialog?.close();
      // Restore focus after the modal has left the top layer and React has
      // removed its contents, rather than during the unmount itself.
      queueMicrotask(() => {
        if (focus?.isConnected) focus.focus({ preventScroll: true });
      });
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="workspace-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onClose={closeDialog}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" onClick={closeDialog} aria-label="Đóng">
          Đóng
        </button>
      </header>
      {children}
    </dialog>,
    document.body,
  );
}
export function SessionsPanel({
  onClose,
  onExpired,
}: {
  onClose: () => void;
  onExpired: () => void;
}) {
  const [items, setItems] = useState<
    {
      id: string;
      deviceName: string | null;
      current: boolean;
      createdAt: string;
      expiresAt: string;
    }[]
  >([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  async function load() {
    try {
      setItems(
        (await api.authenticated<{ items: typeof items }>('/auth/sessions'))
          .items,
      );
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function revoke(id: string, current: boolean) {
    setBusy(true);
    setError('');
    try {
      await api.authenticated(`/auth/sessions/${id}`, undefined, 'DELETE');
      if (current) onExpired();
      else await load();
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspaceDialog title="Thiết bị đang đăng nhập" onClose={onClose}>
      <p>Đăng xuất từ xa sẽ thu hồi quyền truy cập của phiên đã chọn.</p>
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Đang tải…</p>}
      {items.map((s) => (
        <article className="workspace-card" key={s.id}>
          <strong>
            {s.deviceName || 'Thiết bị chưa đặt tên'}{' '}
            {s.current && '· Phiên hiện tại'}
          </strong>
          <p>Đăng nhập: {new Date(s.createdAt).toLocaleString('vi-VN')}</p>
          <p>Hết hạn: {new Date(s.expiresAt).toLocaleString('vi-VN')}</p>
          <button disabled={busy} onClick={() => void revoke(s.id, s.current)}>
            Đăng xuất{s.current ? ' thiết bị này' : ' từ xa'}
          </button>
        </article>
      ))}
    </WorkspaceDialog>
  );
}
type SearchHit = Pick<
  Message,
  'id' | 'conversationId' | 'senderId' | 'body' | 'createdAt' | 'sequence'
>;
export function MessageSearch({
  conversationId,
  onClose,
}: {
  conversationId: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchHit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState('');
  const [context, setContext] = useState<Message>();
  async function search(next?: string) {
    if (busy || !query.trim()) return;
    setBusy(true);
    setError('');
    setContext(undefined);
    try {
      const params = new URLSearchParams({
        query: next ? searched : query.trim(),
        limit: '20',
        conversationId,
        ...(next ? { cursor: next } : {}),
      });
      const result = await api.authenticated<{
        items: SearchHit[];
        nextCursor: string | null;
      }>(`/messages/search?${params}`);
      setItems((old) => (next ? [...old, ...result.items] : result.items));
      setCursor(result.nextCursor);
      if (!next) setSearched(query.trim());
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspaceDialog title="Tìm trong cuộc trò chuyện" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label>
          Từ khóa trong cuộc trò chuyện này
          <input
            autoFocus
            value={query}
            maxLength={200}
            placeholder="Nhập từ khóa tin nhắn…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button disabled={busy || !query.trim()}>Tìm kiếm</button>
      </form>
      <p>
        Chỉ tìm các tin nhắn trong cuộc trò chuyện này (không phân biệt dấu).
      </p>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Đang tìm…</p>}
      {!busy && searched && !items.length && (
        <p>Không tìm thấy tin nhắn phù hợp trong cuộc trò chuyện này.</p>
      )}
      {items.map((m) => (
        <article className="workspace-card" key={m.id}>
          <p className="workspace-message">{m.body}</p>
          <time>{new Date(m.createdAt).toLocaleString('vi-VN')}</time>
          <div>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const el = document.querySelector<HTMLElement>(
                  `[data-message-id="${m.id}"]`,
                );
                if (el) {
                  onClose();
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                } else {
                  setBusy(true);
                  void api
                    .authenticated<{ message: Message }>(
                      `/conversations/${m.conversationId}/messages/${m.id}`,
                    )
                    .then((res) => setContext(res.message))
                    .catch((e) => setError(api.errorMessage(e)))
                    .finally(() => setBusy(false));
                }
              }}
            >
              Đi tới tin nhắn
            </button>
          </div>
        </article>
      ))}
      {context && (
        <section className="workspace-card" aria-label="Tin nhắn gốc">
          <strong>Tin nhắn gốc · #{context.sequence}</strong>
          <p className="workspace-message">
            {context.deletedAt ? 'Tin đã được thu hồi' : context.body}
          </p>
        </section>
      )}
      {cursor && (
        <button disabled={busy} onClick={() => void search(cursor)}>
          Xem thêm kết quả
        </button>
      )}
    </WorkspaceDialog>
  );
}
interface Poll {
  id: string;
  creatorId: string;
  question: string;
  options: { text: string; count: number }[];
  multiple: boolean;
  closedAt: string | null;
  selected: number[];
  voters: number;
}
function PollCard({
  poll,
  userId,
  onRefresh,
  base,
}: {
  poll: Poll;
  userId: string;
  onRefresh: () => Promise<void>;
  base: string;
}) {
  const [selected, setSelected] = useState(poll.selected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setSelected(poll.selected), [poll.selected]);
  async function act(close = false) {
    setBusy(true);
    setError('');
    try {
      await api.authenticated(
        `${base}/polls/${poll.id}/${close ? 'close' : 'vote'}`,
        close ? undefined : { options: selected },
        close ? 'POST' : 'PUT',
      );
      await onRefresh();
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="workspace-card">
      <h3>{poll.question}</h3>
      <p>
        {poll.multiple ? 'Chọn nhiều phương án' : 'Chọn một phương án'} ·{' '}
        {poll.voters} người bình chọn {poll.closedAt && '· Đã đóng'}
      </p>
      <fieldset disabled={busy || !!poll.closedAt}>
        <legend>Phương án bình chọn</legend>
        {poll.options.map((o, i) => (
          <label className="workspace-choice" key={i}>
            <input
              type="checkbox"
              checked={selected.includes(i)}
              onChange={() =>
                setSelected((old) =>
                  old.includes(i)
                    ? old.filter((v) => v !== i)
                    : poll.multiple
                      ? [...old, i]
                      : [i],
                )
              }
            />
            {o.text}
            <span>{o.count} phiếu</span>
          </label>
        ))}
      </fieldset>
      {!poll.closedAt && (
        <button disabled={busy} onClick={() => void act()}>
          {selected.length ? 'Lưu bình chọn' : 'Rút bình chọn'}
        </button>
      )}
      {!poll.closedAt && poll.creatorId === userId && (
        <button disabled={busy} onClick={() => void act(true)}>
          Đóng bình chọn
        </button>
      )}
      {error && <p role="alert">{error}</p>}
    </article>
  );
}
export function GroupTools({
  conversationId,
  isGroup = true,
  userId,
  onClose,
}: {
  conversationId: string;
  isGroup?: boolean;
  userId: string;
  onClose: () => void;
}) {
  const base = `/conversations/${conversationId}`;
  const [pins, setPins] = useState<Message[]>([]);
  const [polls, setPolls] = useState<Poll[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState('');
  const [multiple, setMultiple] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const key = useRef(crypto.randomUUID());
  async function load(next?: string) {
    try {
      const [p, result] = await Promise.all([
        api.authenticated<{ items: Message[] }>(`${base}/pins`),
        isGroup
          ? api.authenticated<{ items: Poll[]; nextCursor: string | null }>(
              `${base}/polls?limit=20${next ? `&cursor=${next}` : ''}`,
            )
          : Promise.resolve({ items: [] as Poll[], nextCursor: null }),
      ]);
      setPins(p.items);
      setPolls((old) => (next ? [...old, ...result.items] : result.items));
      setCursor(result.nextCursor);
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [conversationId, isGroup]);
  async function create() {
    setBusy(true);
    setError('');
    try {
      await api.authenticated(`${base}/polls`, {
        clientRequestId: key.current,
        question: question.trim(),
        options: options
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean),
        multiple,
      });
      key.current = crypto.randomUUID();
      setQuestion('');
      setOptions('');
      await load();
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <WorkspaceDialog
      title={isGroup ? 'Ghim & bình chọn' : 'Tin nhắn đã ghim'}
      onClose={onClose}
    >
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Đang tải…</p>}
      <h3>Tin nhắn đã ghim</h3>
      <p>
        {isGroup
          ? 'Mọi thành viên trong nhóm đều có thể ghim hoặc bỏ ghim tin nhắn.'
          : 'Cả hai người đều có thể ghim hoặc bỏ ghim tin nhắn.'}
      </p>
      {!loading && !pins.length && <p>Chưa có tin được ghim.</p>}
      <div className="pinned-dialog-list">
        {pins.map((m, idx) => (
          <article className="pinned-card" key={m.id}>
            <div className="pinned-card-header">
              <div className="pinned-card-author">
                <strong>Tin nhắn đã ghim</strong>
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
              <span className="pinned-card-index">#{idx + 1}</span>
            </div>
            <div className="pinned-card-body" style={{ cursor: 'default' }}>
              <p>
                {m.content?.fileName
                  ? `${messageSummary(m)} · ${m.content.fileName}`
                  : messageSummary(m)}
              </p>
            </div>
            <div className="pinned-card-footer">
              <button
                type="button"
                className="pinned-action-btn is-jump"
                disabled={busy}
                onClick={() => {
                  const el = document.querySelector<HTMLElement>(
                    `[data-message-id="${m.id}"]`,
                  );
                  if (el) {
                    onClose();
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    el.classList.add('pin-highlight');
                    window.setTimeout(
                      () => el.classList.remove('pin-highlight'),
                      2500,
                    );
                  }
                }}
              >
                <span>Đi tới tin nhắn</span>
              </button>
              <button
                type="button"
                className="pinned-action-btn is-unpin"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.authenticated(
                      `${base}/pins/${m.id}`,
                      undefined,
                      'DELETE',
                    );
                    window.dispatchEvent(
                      new CustomEvent('chat:pins', {
                        detail: conversationId,
                      }),
                    );
                    await load();
                  } catch (e) {
                    setError(api.errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <span>Bỏ ghim</span>
              </button>
            </div>
          </article>
        ))}
      </div>
      {isGroup && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <h3>Tạo bình chọn</h3>
            <label>
              Câu hỏi
              <input
                required
                maxLength={300}
                value={question}
                onChange={(e) => {
                  key.current = crypto.randomUUID();
                  setQuestion(e.target.value);
                }}
              />
            </label>
            <label>
              Phương án (2–10 dòng, mỗi dòng một phương án)
              <textarea
                required
                value={options}
                maxLength={1510}
                onChange={(e) => {
                  key.current = crypto.randomUUID();
                  setOptions(e.target.value);
                }}
              />
            </label>
            <label className="workspace-choice">
              <input
                type="checkbox"
                checked={multiple}
                onChange={(e) => {
                  key.current = crypto.randomUUID();
                  setMultiple(e.target.checked);
                }}
              />
              Cho phép chọn nhiều
            </label>
            <button disabled={busy}>Tạo bình chọn</button>
          </form>
          <button disabled={busy} onClick={() => void load()}>
            Cập nhật kết quả
          </button>
          {polls.map((p) => (
            <PollCard
              key={p.id}
              poll={p}
              userId={userId}
              base={base}
              onRefresh={() => load()}
            />
          ))}
          {cursor && (
            <button disabled={busy} onClick={() => void load(cursor)}>
              Xem thêm bình chọn
            </button>
          )}
        </>
      )}
    </WorkspaceDialog>
  );
}
