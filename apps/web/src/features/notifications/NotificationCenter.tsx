import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  CheckCheck,
  PhoneMissed,
  Sparkles,
  UserPlus,
  X,
} from 'lucide-react';
import * as api from '../../lib/api';
import './notifications.css';

interface Notice {
  id: string;
  type: string;
  payload: { title?: string };
  createdAt: string;
  readAt: string | null;
}
interface NoticePage {
  items: Notice[];
  nextCursor: string | null;
  unreadCount: number;
}

export function NotificationCenter({ onExpired }: { onExpired: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notice[]>([]);
  const [count, setCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filter, setFilter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const area = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  const expired = useRef(onExpired);
  expired.current = onExpired;
  const load = useCallback(async (next?: string) => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    try {
      const page = await api.authenticated<NoticePage>(
        `/notifications?limit=20${next ? `&cursor=${next}` : ''}`,
      );
      if (!alive.current) return;
      setItems((previous) =>
        next
          ? [
              ...previous,
              ...page.items.filter(
                (item) => !previous.some((old) => old.id === item.id),
              ),
            ]
          : page.items,
      );
      setCount(page.unreadCount);
      setCursor(page.nextCursor);
      setError('');
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof api.ApiError && cause.status === 401)
        expired.current();
      setError('Không thể tải thông báo. Vui lòng thử lại.');
    } finally {
      pending.current = false;
      if (alive.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  useEffect(() => {
    // Keep the badge fresh without resetting a list the user is reading.
    const refresh = () => {
      if (!open && document.visibilityState === 'visible') void load();
    };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [load, open]);
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    void load();
    const dismiss = (event: PointerEvent) => {
      if (!area.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, load]);

  async function markRead(id?: string) {
    setBusy(true);
    setError('');
    try {
      await api.authenticated(
        `/notifications/${id ? `${id}/read` : 'read-all'}`,
        undefined,
        'PATCH',
      );
      if (!alive.current) return;
      setItems((previous) =>
        previous.map((item) =>
          !id || item.id === id
            ? { ...item, readAt: item.readAt ?? new Date().toISOString() }
            : item,
        ),
      );
      // Reload from the server so another device's changes are also reflected.
      await load();
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof api.ApiError && cause.status === 401)
        expired.current();
      setError('Chưa thể đánh dấu đã đọc. Vui lòng thử lại.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const visible = filter ? items.filter((item) => !item.readAt) : items;
  return (
    <div
      className="notification-center"
      ref={area}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        className="notification-bell"
        ref={trigger}
        aria-label={`Thông báo, ${count} chưa đọc`}
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={22} aria-hidden="true" />
        {count > 0 && (
          <span className="notification-badge">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <section
          id="notification-panel"
          className="notification-panel"
          aria-label="Trung tâm thông báo"
        >
          <div className="notification-heading">
            <div>
              <h2>Thông báo</h2>
              <p>{count} thông báo chưa đọc</p>
            </div>
            <button
              ref={close}
              aria-label="Đóng thông báo"
              onClick={() => {
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <X size={20} />
            </button>
          </div>
          <div className="notification-toolbar">
            <button aria-pressed={!filter} onClick={() => setFilter(false)}>
              Tất cả
            </button>
            <button aria-pressed={filter} onClick={() => setFilter(true)}>
              Chưa đọc
            </button>
            <button
              disabled={busy || loading || !count}
              title="Đánh dấu tất cả đã đọc"
              aria-label="Đánh dấu tất cả đã đọc"
              onClick={() => void markRead()}
            >
              <CheckCheck size={20} />
            </button>
          </div>
          {error && (
            <div className="notification-error" role="alert">
              {error}{' '}
              <button disabled={loading} onClick={() => void load()}>
                Thử lại
              </button>
            </div>
          )}
          <div className="notification-list" aria-busy={loading}>
            {!loading && !error && !visible.length && (
              <div className="notification-empty">
                <Bell size={30} aria-hidden="true" />
                <strong>
                  {filter
                    ? 'Bạn đã đọc hết thông báo đã tải'
                    : 'Chưa có thông báo'}
                </strong>
                <p>
                  Lời mời kết bạn, cuộc gọi nhỡ và kết quả AI sẽ xuất hiện ở
                  đây.
                </p>
              </div>
            )}
            {visible.map((item) => {
              const Icon = item.type.startsWith('friend')
                ? UserPlus
                : item.type === 'call'
                  ? PhoneMissed
                  : item.type.startsWith('ai_')
                    ? Sparkles
                    : Bell;
              return (
                <article
                  key={item.id}
                  className={`notification-item${item.readAt ? '' : ' is-unread'}`}
                >
                  <span className="notification-type">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <div>
                    <strong>
                      {item.payload.title ?? 'Bạn có thông báo mới'}
                    </strong>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString('vi-VN')}
                    </time>
                    {item.readAt ? (
                      <span className="notification-read-label">Đã đọc</span>
                    ) : (
                      <button
                        disabled={busy || loading}
                        onClick={() => void markRead(item.id)}
                      >
                        Đánh dấu đã đọc
                      </button>
                    )}
                  </div>
                  {!item.readAt && (
                    <span className="notification-dot" aria-label="Chưa đọc" />
                  )}
                </article>
              );
            })}
            {loading && (
              <p className="notification-status" role="status">
                Đang tải thông báo…
              </p>
            )}
            {cursor && (
              <button
                className="notification-more"
                disabled={loading || busy}
                onClick={() => void load(cursor)}
              >
                Xem thông báo cũ hơn
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
