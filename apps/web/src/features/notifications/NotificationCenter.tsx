import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  CheckCheck,
  MessageCircle,
  PhoneMissed,
  Sparkles,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { Avatar } from '../../components/Avatar';
import * as api from '../../lib/api';
import {
  formatNoticeContent,
  formatRelativeNoticeTime,
  resolveNoticeActor,
  resolveNoticeDestination,
  type Notice,
  type NotificationDestination,
} from './notification-model';
import './notifications.css';

interface NoticeVisual {
  Icon: typeof Bell;
  tone: string;
}

const NOTICE_VISUALS: Record<string, NoticeVisual> = {
  friend_request: { Icon: UserPlus, tone: 'friend-request' },
  friend_accepted: { Icon: UserCheck, tone: 'friend-accepted' },
  call: { Icon: PhoneMissed, tone: 'call' },
  message: { Icon: MessageCircle, tone: 'message' },
};

function noticeVisual(type: string): NoticeVisual {
  if (type.startsWith('ai_')) return { Icon: Sparkles, tone: 'ai' };
  return NOTICE_VISUALS[type] ?? { Icon: Bell, tone: 'default' };
}

interface NoticePage {
  items: Notice[];
  nextCursor: string | null;
  unreadCount: number;
}

export function NotificationCenter({
  onExpired,
  onNavigate,
}: {
  onExpired: () => void;
  onNavigate?: (destination: NotificationDestination, notice: Notice) => void;
}) {
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
    const unreadHit = id
      ? items.some((item) => item.id === id && !item.readAt)
      : count > 0;
    const nowIso = new Date().toISOString();
    if (unreadHit) {
      setItems((previous) =>
        previous.map((item) =>
          !id || item.id === id
            ? { ...item, readAt: item.readAt ?? nowIso }
            : item,
        ),
      );
      setCount((previous) => (id ? Math.max(0, previous - 1) : 0));
    }
    setBusy(true);
    setError('');
    try {
      await api.authenticated(
        `/notifications/${id ? `${id}/read` : 'read-all'}`,
        undefined,
        'PATCH',
      );
      if (!alive.current) return;
      // Reload from the server so another device's changes are also reflected.
      await load();
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof api.ApiError && cause.status === 401)
        expired.current();
      else void load();
      setError('Chưa thể đánh dấu đã đọc. Vui lòng thử lại.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  function handleSelectNotice(
    item: Notice,
    destination: NotificationDestination | null,
  ) {
    if (!item.readAt) void markRead(item.id);
    if (!destination) return;
    setOpen(false);
    onNavigate?.(destination, item);
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
              const { Icon, tone } = noticeVisual(item.type);
              const actor = resolveNoticeActor(item);
              const formatted = formatNoticeContent(item);
              const destination = resolveNoticeDestination(item);
              return (
                <article
                  key={item.id}
                  className={`notification-item${item.readAt ? '' : ' is-unread'}${destination ? ' is-clickable' : ''}`}
                >
                  <button
                    type="button"
                    className="notification-main"
                    onClick={() => handleSelectNotice(item, destination)}
                  >
                    <span className="notification-visual">
                      {actor ? (
                        <span className="notification-avatar">
                          <Avatar peer={actor} />
                        </span>
                      ) : (
                        <span className={`notification-type is-${tone}`}>
                          <Icon size={20} aria-hidden="true" />
                        </span>
                      )}
                      {actor && (
                        <span
                          className={`notification-kind-badge is-${tone}`}
                          aria-hidden="true"
                        >
                          <Icon size={12} strokeWidth={2.4} />
                        </span>
                      )}
                    </span>
                    <span className="notification-content">
                      <span className="notification-message">
                        {formatted.actorName ? (
                          <>
                            <strong className="notification-actor">
                              {formatted.actorName}
                            </strong>{' '}
                            <span>{formatted.body}</span>
                          </>
                        ) : (
                          <strong>{formatted.body}</strong>
                        )}
                      </span>
                      {formatted.hint && (
                        <span className="notification-hint">
                          {formatted.hint}
                        </span>
                      )}
                      <time
                        dateTime={item.createdAt}
                        title={new Date(item.createdAt).toLocaleString('vi-VN')}
                      >
                        {formatRelativeNoticeTime(item.createdAt)}
                      </time>
                    </span>
                    {!item.readAt && (
                      <span
                        className="notification-dot"
                        aria-label="Chưa đọc"
                      />
                    )}
                  </button>
                  {!item.readAt && (
                    <div className="notification-item-footer">
                      <button
                        type="button"
                        className="notification-read-btn"
                        disabled={busy || loading}
                        onClick={() => void markRead(item.id)}
                      >
                        Đánh dấu đã đọc
                      </button>
                    </div>
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
