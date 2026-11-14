import { SessionsPanel } from '../workspace/WorkspacePanels';
import { useEffect, useRef, useState } from 'react';
import * as api from '../../lib/api';
import { Conversations } from '../conversations/Conversations';
import { AiChatbox } from '../ai/AiChatbox';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { ReportButton } from '../reports/ReportDialog';
import { Avatar } from '../../components/Avatar';
import { UiIcon } from '../../components/UiIcon';
import { presenceLabel, usePresence } from '../../hooks/usePresence';
import { installAudioUnlock } from '../../lib/notification-sounds';
import type { Peer, Page } from '../../lib/types';

type Tab =
  | 'conversations'
  | 'messageRequests'
  | 'friends'
  | 'incoming'
  | 'outgoing'
  | 'search'
  | 'profile';
interface Row {
  id: string;
  user: Peer;
  body?: string;
  createdAt?: string;
  direction?: 'incoming' | 'outgoing';
}
const primaryTabs: [Tab, string][] = [
  ['conversations', 'Đoạn chat'],
  ['friends', 'Bạn bè'],
];

const friendSubTabs: [
  Extract<Tab, 'friends' | 'incoming' | 'outgoing' | 'search'>,
  string,
  string,
][] = [
  ['friends', 'Tất cả bạn bè', 'Danh sách bạn bè đã kết nối'],
  ['incoming', 'Lời mời nhận', 'Lời mời kết bạn gửi đến bạn'],
  ['outgoing', 'Lời mời đã gửi', 'Lời mời bạn đã gửi đi'],
  ['search', 'Tìm bạn', 'Tìm kiếm và kết bạn mới'],
];

const isFriendsHubTab = (
  value: Tab,
): value is 'friends' | 'incoming' | 'outgoing' | 'search' =>
  value === 'friends' ||
  value === 'incoming' ||
  value === 'outgoing' ||
  value === 'search';

const tabs: [Tab, string][] = [
  ['conversations', 'Đoạn chat'],
  ['messageRequests', 'Tin nhắn chờ'],
  ['friends', 'Bạn bè'],
  ['incoming', 'Lời mời kết bạn'],
  ['outgoing', 'Lời mời đã gửi'],
  ['search', 'Tìm bạn'],
  ['profile', 'Tài khoản'],
];

export function Home({
  user,
  onUser,
  onLogout,
  onExpired,
  onAdmin,
}: {
  user: api.User;
  onUser: (user: api.User) => void;
  onLogout: () => Promise<void>;
  onExpired: () => void;
  onAdmin?: () => void;
}) {
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('conversations');
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [incomingCount, setIncomingCount] = useState(0);
  const presence = usePresence(user.id);
  const [accountOpen, setAccountOpen] = useState(false);
  const [profileSection, setProfileSection] = useState<
    'avatar' | 'name' | 'password' | 'details' | null
  >(null);
  function selectProfileSection(section: typeof profileSection) {
    setProfileSection(section);
    setError('');
    setNotice('');
    setName(user.displayName);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  }
  const accountArea = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!accountOpen) return;
    accountArea.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!accountArea.current?.contains(event.target as Node))
        setAccountOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [accountOpen]);
  const [chatRecipient, setChatRecipient] = useState<{
    id: string;
    key: number;
  }>();
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState(user.displayName);
  const [messageRequestTarget, setMessageRequestTarget] = useState<Row>();
  const [messageRequestBody, setMessageRequestBody] = useState('');
  const [confirm, setConfirm] = useState<Row>();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const generation = useRef(0);
  const tabCache = useRef(
    new Map<Tab, { rows: Row[]; cursor: string | null; loadedAt: number }>(),
  );
  const pendingLists = useRef(new Map<string, Promise<Page<Row | Peer>>>());
  const cacheRevision = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    setName(user.displayName);
  }, [user.displayName]);
  useEffect(() => installAudioUnlock(), []);
  useEffect(() => {
    let active = true;
    const fetchIncomingCount = () => {
      void api
        .authenticated<Page<Row>>(
          '/friend-requests?direction=incoming&limit=20',
        )
        .then((page) => {
          if (active) setIncomingCount(page.items.length);
        })
        .catch(() => {});
    };
    fetchIncomingCount();
    const timer = window.setInterval(fetchIncomingCount, 30000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user.id]);

  function fail(e: unknown) {
    if (e instanceof api.ApiError && e.status === 401) onExpired();
    else setError(api.errorMessage(e));
  }
  async function load(next?: string, search = submittedQuery) {
    const current = ++generation.current;
    const revision = cacheRevision.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (next) params.set('cursor', next);
      let path = '/friends';
      if (tab === 'messageRequests') {
        path = '/message-requests';
        params.set('direction', 'all');
      }
      if (tab === 'incoming' || tab === 'outgoing') {
        path = '/friend-requests';
        params.set('direction', tab);
      }
      if (tab === 'search') {
        path = '/users';
        params.set('query', search);
      }
      const requestPath = `${path}?${params}`;
      let request = pendingLists.current.get(requestPath);
      if (!request) {
        request = api.authenticated<Page<Row | Peer>>(requestPath);
        pendingLists.current.set(requestPath, request);
        const pending = request;
        void request
          .finally(() => {
            if (pendingLists.current.get(requestPath) === pending)
              pendingLists.current.delete(requestPath);
          })
          .catch(() => {});
      }
      const page = await request;
      if (!mounted.current || revision !== cacheRevision.current) return;
      const items: Row[] = page.items.map((item) =>
        'user' in item ? item : { id: item.id, user: item },
      );
      const previous = tabCache.current.get(tab)?.rows ?? [];
      const updated = next
        ? [
            ...previous,
            ...items.filter(
              (item) => !previous.some((old) => old.id === item.id),
            ),
          ]
        : items;
      tabCache.current.set(tab, {
        rows: updated,
        cursor: page.nextCursor,
        loadedAt: Date.now(),
      });
      if (current !== generation.current) return;
      setRows(updated);
      setCursor(page.nextCursor);
      if (tab === 'incoming') {
        setIncomingCount(updated.length);
      }
    } catch (e) {
      if (current === generation.current) fail(e);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    generation.current++;
    const cached = tabCache.current.get(tab);
    setRows(cached?.rows ?? []);
    setCursor(cached?.cursor ?? null);
    setError('');
    setNotice('');
    setConfirm(undefined);
    setMessageRequestTarget(undefined);
    setMessageRequestBody('');
    setSubmittedQuery('');
    if (
      tab !== 'search' &&
      tab !== 'profile' &&
      tab !== 'conversations' &&
      (!cached || Date.now() - cached.loadedAt >= 30000)
    )
      void load();
    else setLoading(false);
  }, [tab]);

  async function action(
    work: () => Promise<unknown>,
    message: string,
    reload = true,
  ) {
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (!mounted.current) return;
      cacheRevision.current++;
      pendingLists.current.clear();
      tabCache.current.clear();
      setNotice(message);
      setConfirm(undefined);
      if (reload) await load();
      return true;
    } catch (e) {
      if (mounted.current) fail(e);
      return false;
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="home-shell">
      {sessionsOpen && (
        <SessionsPanel
          onClose={() => setSessionsOpen(false)}
          onExpired={onExpired}
        />
      )}
      <header className="home-header">
        <a href="/" className="brand">
          <span className="brand-icon">P</span> PingPong
          <span className="brand-dot">.</span>
        </a>
        <nav className="home-nav" aria-label="Điều hướng PingPong">
          {primaryTabs.map(([key, label]) => {
            const isActive =
              key === 'friends' ? isFriendsHubTab(tab) : tab === key;
            const badgeCount =
              key === 'conversations'
                ? unreadCount
                : key === 'friends'
                  ? incomingCount
                  : 0;
            return (
              <button
                key={key}
                title={label}
                aria-label={label}
                aria-current={isActive ? 'page' : undefined}
                disabled={busy}
                onClick={() => setTab(key)}
              >
                <UiIcon name={key} />
                <span className="nav-label">{label}</span>
                {badgeCount > 0 && (
                  <span
                    className="nav-unread-badge"
                    aria-label={
                      key === 'conversations'
                        ? `${badgeCount} tin nhắn chưa đọc`
                        : `${badgeCount} lời mời kết bạn`
                    }
                  >
                    {badgeCount > 99 ? '99+' : badgeCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <NotificationCenter key={user.id} onExpired={onExpired} />
        <div
          className="account-control"
          ref={accountArea}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setAccountOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setAccountOpen(false);
              accountButton.current?.focus();
            }
            if (
              accountOpen &&
              (event.key === 'ArrowDown' || event.key === 'ArrowUp')
            ) {
              event.preventDefault();
              const options = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]',
                ),
              );
              const index = options.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              options[
                (index +
                  (event.key === 'ArrowDown' ? 1 : -1) +
                  options.length) %
                  options.length
              ]?.focus();
            }
          }}
        >
          <button
            ref={accountButton}
            type="button"
            className="account-toggle"
            aria-label={`Tài khoản của ${user.displayName}`}
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            onClick={() => setAccountOpen(!accountOpen)}
          >
            <span className="account-avatar">
              <Avatar peer={user} />
            </span>
            <span className="account-chevron" aria-hidden="true">
              ⌄
            </span>
          </button>
          {accountOpen && (
            <div className="account-menu" role="menu" aria-label="Tài khoản">
              <div className="account-menu-name">{user.displayName}</div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setAccountOpen(false);
                  setSessionsOpen(true);
                }}
              >
                Thiết bị đăng nhập
              </button>
              {onAdmin && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountOpen(false);
                    onAdmin();
                  }}
                >
                  <UiIcon name="profile" size={18} />
                  Quản lý admin
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setTab('profile');
                  selectProfileSection(null);
                  setAccountOpen(false);
                }}
              >
                <UiIcon name="profile" />
                Tài khoản của tôi
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setAccountOpen(false);
                  void action(onLogout, '', false);
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="M9 4H4v16h5M9 12h12m-4-4 4 4-4 4" />
                </svg>
                Đăng xuất
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="home-layout">
        <main
          className={`home-main${tab === 'conversations' ? ' chat-home' : ''}`}
        >
          {tab !== 'conversations' && (
            <div className="home-title">
              <div>
                <span className="eyebrow dark">
                  {isFriendsHubTab(tab)
                    ? 'DANH BẠ & KẾT NỐI'
                    : 'KHÔNG GIAN CỦA BẠN'}
                </span>
                <h1>
                  {isFriendsHubTab(tab)
                    ? 'Bạn bè'
                    : tabs.find(([key]) => key === tab)?.[1]}
                </h1>
              </div>
              {tab !== 'profile' && (tab !== 'search' || submittedQuery) && (
                <button
                  className="secondary"
                  disabled={loading || busy}
                  onClick={() => void load()}
                >
                  Tải lại
                </button>
              )}
            </div>
          )}
          {isFriendsHubTab(tab) && (
            <div
              className="friends-hub-nav"
              role="tablist"
              aria-label="Danh mục bạn bè"
            >
              {friendSubTabs.map(([subKey, subLabel, subHint]) => {
                const selected = tab === subKey;
                return (
                  <button
                    key={subKey}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={`friends-hub-tab${selected ? ' is-active' : ''}`}
                    disabled={busy}
                    onClick={() => setTab(subKey)}
                  >
                    <span className="friends-hub-tab-icon">
                      <UiIcon name={subKey} size={18} />
                    </span>
                    <span className="friends-hub-tab-copy">
                      <strong>
                        {subLabel}
                        {subKey === 'incoming' && incomingCount > 0 && (
                          <span className="friends-hub-badge">
                            {incomingCount > 99 ? '99+' : incomingCount}
                          </span>
                        )}
                      </strong>
                      <small>{subHint}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              {notice}
            </div>
          )}
          {error && (
            <div className="message error" role="alert">
              {error}
            </div>
          )}
          <div className="conversation-view" hidden={tab !== 'conversations'}>
            <Conversations
              presence={presence}
              user={user}
              onExpired={onExpired}
              active={tab === 'conversations'}
              recipient={chatRecipient}
              onUnreadCount={setUnreadCount}
              aiChatOpen={aiChatOpen}
              onToggleAiChat={() => setAiChatOpen((prev) => !prev)}
            />
          </div>
          {tab === 'conversations' ? null : tab === 'profile' ? (
            <section className="profile-panel">
              {profileSection === null ? (
                <div className="account-options">
                  <p className="intro">
                    Chọn thông tin bạn muốn xem hoặc thay đổi.
                  </p>
                  {(
                    [
                      [
                        'avatar',
                        'Ảnh đại diện',
                        'Thay đổi hoặc gỡ ảnh của bạn',
                      ],
                      [
                        'name',
                        'Tên hiển thị',
                        'Tên bạn bè nhìn thấy trên PingPong',
                      ],
                      [
                        'password',
                        'Đổi mật khẩu',
                        'Cập nhật mật khẩu đăng nhập',
                      ],
                      [
                        'details',
                        'Thông tin tài khoản',
                        'Email và ngày tham gia',
                      ],
                    ] as const
                  ).map(([key, title, description]) => (
                    <button
                      key={key}
                      type="button"
                      className="account-option"
                      disabled={busy}
                      onClick={() => selectProfileSection(key)}
                    >
                      <span>
                        <strong>{title}</strong>
                        <small>{description}</small>
                      </span>
                      <span aria-hidden="true">→</span>
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => selectProfileSection(null)}
                >
                  ← Quay lại tài khoản
                </button>
              )}
              {profileSection === 'avatar' && (
                <>
                  <h2>Ảnh đại diện</h2>
                  <span className="peer-avatar profile-photo">
                    <Avatar peer={user} />
                  </span>
                  <label>
                    Chọn ảnh (PNG, JPEG, WebP, tối đa 512 KB)
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={busy}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        if (file.size > 512 * 1024) {
                          setError('Ảnh cần nhỏ hơn 512 KB.');
                          return;
                        }
                        void action(
                          async () => {
                            const image = await new Promise<string>(
                              (resolve, reject) => {
                                const reader = new FileReader();
                                reader.onload = () =>
                                  resolve(String(reader.result));
                                reader.onerror = () =>
                                  reject(new Error('FILE_READ_FAILED'));
                                reader.readAsDataURL(file);
                              },
                            );
                            const result = await api.authenticated<{
                              user: api.User;
                            }>('/users/me/avatar', { image }, 'PATCH');
                            onUser(result.user);
                          },
                          'Đã đổi ảnh đại diện.',
                          false,
                        );
                      }}
                    />
                  </label>
                  {user.avatarUrl && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void action(
                          async () => {
                            const result = await api.authenticated<{
                              user: api.User;
                            }>('/users/me/avatar', undefined, 'DELETE');
                            onUser(result.user);
                          },
                          'Đã gỡ ảnh đại diện.',
                          false,
                        )
                      }
                    >
                      Gỡ ảnh
                    </button>
                  )}
                </>
              )}
              {profileSection === 'name' && (
                <>
                  <h2>Tên hiển thị</h2>
                  <p className="intro">
                    Tên hiển thị giúp bạn bè nhận ra bạn trên PingPong.
                  </p>
                  <form
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!name.trim() || name.trim().length > 100) {
                        setError('Tên hiển thị cần từ 1 đến 100 ký tự.');
                        return;
                      }
                      void action(
                        async () => {
                          const result = await api.authenticated<{
                            user: api.User;
                          }>(
                            '/users/me',
                            { displayName: name.trim() },
                            'PATCH',
                          );
                          onUser(result.user);
                        },
                        'Đã lưu tên hiển thị.',
                        false,
                      );
                    }}
                  >
                    <label>
                      Tên hiển thị
                      <input
                        value={name}
                        maxLength={100}
                        disabled={busy}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <button
                      className="primary"
                      disabled={busy || name.trim() === user.displayName}
                    >
                      Lưu thay đổi
                    </button>
                  </form>
                </>
              )}
              {profileSection === 'password' && (
                <>
                  <h2>Đổi mật khẩu</h2>
                  <p className="hint">
                    Sau khi đổi, bạn sẽ đăng xuất trên tất cả thiết bị.
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (newPassword !== confirmPassword) {
                        setError('Mật khẩu xác nhận chưa khớp.');
                        return;
                      }
                      void action(
                        async () => {
                          await api.authenticated('/auth/change-password', {
                            currentPassword,
                            newPassword,
                            confirmPassword,
                          });
                          setCurrentPassword('');
                          setNewPassword('');
                          setConfirmPassword('');
                          api.clearSession();
                          await onLogout();
                        },
                        '',
                        false,
                      );
                    }}
                  >
                    <label>
                      Mật khẩu hiện tại
                      <input
                        type="password"
                        autoComplete="current-password"
                        required
                        maxLength={128}
                        disabled={busy}
                        value={currentPassword}
                        onChange={(event) =>
                          setCurrentPassword(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Mật khẩu mới
                      <input
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        maxLength={128}
                        disabled={busy}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                      />
                    </label>
                    <label>
                      Xác nhận mật khẩu mới
                      <input
                        type="password"
                        autoComplete="new-password"
                        required
                        minLength={8}
                        maxLength={128}
                        disabled={busy}
                        value={confirmPassword}
                        onChange={(event) =>
                          setConfirmPassword(event.target.value)
                        }
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      Đổi mật khẩu
                    </button>
                  </form>
                </>
              )}
              {profileSection === 'details' && (
                <>
                  <h2>Thông tin tài khoản</h2>
                  <dl>
                    <div>
                      <dt>Email</dt>
                      <dd>{user.email}</dd>
                    </div>
                    <div>
                      <dt>Ngày tham gia</dt>
                      <dd>
                        {new Intl.DateTimeFormat('vi-VN').format(
                          new Date(user.createdAt),
                        )}
                      </dd>
                    </div>
                  </dl>
                </>
              )}
            </section>
          ) : (
            <>
              {tab === 'search' && (
                <form
                  className="search-form"
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    const value = query.trim();
                    if (value.length < 2 || value.length > 100) {
                      setError('Nhập tên hiển thị từ 2 đến 100 ký tự.');
                      return;
                    }
                    setSubmittedQuery(value);
                    setRows([]);
                    setNotice('');
                    void load(undefined, value);
                  }}
                >
                  <label htmlFor="find-user">Tìm theo tên hiển thị</label>
                  <div>
                    <input
                      id="find-user"
                      placeholder="Nhập tên hiển thị của bạn bè"
                      value={query}
                      maxLength={100}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <button className="primary" disabled={loading || busy}>
                      Tìm kiếm
                    </button>
                  </div>
                </form>
              )}
              {confirm && (
                <div className="confirm-panel" role="alert">
                  <p>
                    Hủy kết bạn với <strong>{confirm.user.displayName}</strong>?
                  </p>
                  <button
                    className="danger"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () =>
                          api.authenticated(
                            `/friends/${confirm.user.id}`,
                            undefined,
                            'DELETE',
                          ),
                        'Đã hủy kết bạn.',
                      )
                    }
                  >
                    Hủy kết bạn
                  </button>{' '}
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setConfirm(undefined)}
                  >
                    Giữ kết bạn
                  </button>
                </div>
              )}
              {messageRequestTarget && (
                <form
                  className="message-request-compose"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const body = messageRequestBody.trim();
                    if (!body) {
                      setError('Hãy nhập lời nhắn mở đầu.');
                      return;
                    }
                    void action(
                      () =>
                        api.authenticated('/message-requests', {
                          recipientId: messageRequestTarget.user.id,
                          body,
                        }),
                      `Đã gửi tin nhắn chờ tới ${messageRequestTarget.user.displayName}.`,
                      false,
                    ).then((succeeded) => {
                      if (mounted.current && succeeded) {
                        setMessageRequestTarget(undefined);
                        setMessageRequestBody('');
                      }
                    });
                  }}
                >
                  <div>
                    <strong>
                      Gửi tin nhắn chờ tới{' '}
                      {messageRequestTarget.user.displayName}
                    </strong>
                    <p>
                      Họ sẽ xem lời nhắn này trước khi quyết định chấp nhận.
                    </p>
                  </div>
                  <label htmlFor="message-request-body">Lời nhắn mở đầu</label>
                  <textarea
                    id="message-request-body"
                    autoFocus
                    maxLength={2000}
                    value={messageRequestBody}
                    onChange={(event) =>
                      setMessageRequestBody(event.target.value)
                    }
                    placeholder="Giới thiệu ngắn gọn lý do bạn muốn trò chuyện"
                  />
                  <small>{messageRequestBody.length}/2000 ký tự</small>
                  <div className="message-request-actions">
                    <button className="primary" disabled={busy}>
                      {busy ? 'Đang gửi…' : 'Gửi tin nhắn chờ'}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setMessageRequestTarget(undefined);
                        setMessageRequestBody('');
                      }}
                    >
                      Hủy
                    </button>
                  </div>
                </form>
              )}
              {loading && rows.length === 0 && (
                <p role="status" className="list-status">
                  Đang tải danh sách…
                </p>
              )}
              {!loading && !error && rows.length === 0 && (
                <div className="empty-state">
                  <span>✦</span>
                  <h2>
                    {tab === 'friends'
                      ? 'Bắt đầu một kết nối mới'
                      : tab === 'incoming'
                        ? 'Chưa có lời mời mới'
                        : tab === 'outgoing'
                          ? 'Chưa có lời mời đang chờ'
                          : tab === 'messageRequests'
                            ? 'Chưa có tin nhắn chờ'
                            : submittedQuery
                              ? 'Không tìm thấy người dùng'
                              : 'Tìm người bạn muốn kết nối'}
                  </h2>
                  <p>
                    {tab === 'friends'
                      ? 'Tìm bạn bè và gửi lời mời để kết nối trên PingPong.'
                      : tab === 'search'
                        ? 'Thử tìm bằng tên hiển thị đầy đủ.'
                        : tab === 'messageRequests'
                          ? 'Tin nhắn từ người chưa kết bạn sẽ xuất hiện tại đây.'
                          : 'Các lời mời đang chờ sẽ xuất hiện tại đây.'}
                  </p>
                  {tab === 'friends' && (
                    <button
                      className="secondary"
                      onClick={() => setTab('search')}
                    >
                      Tìm bạn
                    </button>
                  )}
                </div>
              )}
              <ul className="people-list">
                {rows.map((row) => (
                  <li key={row.id}>
                    <span
                      className="peer-avatar presence-avatar"
                      aria-hidden="true"
                    >
                      <Avatar peer={row.user} />
                      {tab === 'friends' && presence[row.user.id]?.online && (
                        <span className="presence-dot" />
                      )}
                    </span>
                    <div>
                      <strong>{row.user.displayName}</strong>
                      {tab === 'messageRequests' && row.body && (
                        <>
                          <p className="hint">
                            {row.direction === 'outgoing'
                              ? 'Bạn đã gửi'
                              : 'Đã gửi cho bạn'}
                          </p>
                          <p className="message-request-preview">{row.body}</p>
                        </>
                      )}
                      {tab === 'friends' && (
                        <p className="hint">
                          {presenceLabel(presence[row.user.id])}
                        </p>
                      )}
                    </div>
                    <div className="peer-actions">
                      {tab === 'search' ? (
                        <>
                          <button
                            className="secondary accept"
                            disabled={busy}
                            onClick={() => {
                              if (row.user.friendshipStatus === 'friends') {
                                setChatRecipient({
                                  id: row.user.id,
                                  key: Date.now(),
                                });
                                setTab('conversations');
                                return;
                              }
                              setMessageRequestTarget(row);
                              setMessageRequestBody('');
                              setError('');
                              setNotice('');
                            }}
                          >
                            Nhắn tin
                          </button>
                          <button
                            className="secondary"
                            disabled={
                              busy ||
                              row.user.friendshipStatus === 'friends' ||
                              row.user.friendshipStatus === 'outgoing'
                            }
                            onClick={() =>
                              row.user.friendshipStatus === 'incoming'
                                ? setTab('incoming')
                                : void action(
                                    async () => {
                                      await api.authenticated(
                                        '/friend-requests',
                                        {
                                          recipientId: row.user.id,
                                        },
                                      );
                                      setRows((previous) =>
                                        previous.map((item) =>
                                          item.user.id === row.user.id
                                            ? {
                                                ...item,
                                                user: {
                                                  ...item.user,
                                                  friendshipStatus: 'outgoing',
                                                },
                                              }
                                            : item,
                                        ),
                                      );
                                    },
                                    'Đã gửi lời mời kết bạn.',
                                    false,
                                  )
                            }
                          >
                            {row.user.friendshipStatus === 'friends'
                              ? 'Đã là bạn bè'
                              : row.user.friendshipStatus === 'incoming'
                                ? 'Xem lời mời'
                                : row.user.friendshipStatus === 'outgoing'
                                  ? 'Đã gửi lời mời'
                                  : 'Kết bạn'}
                          </button>
                        </>
                      ) : tab === 'friends' ? (
                        <>
                          <button
                            className="secondary accept"
                            disabled={busy}
                            onClick={() => {
                              setChatRecipient({
                                id: row.user.id,
                                key: Date.now(),
                              });
                              setTab('conversations');
                            }}
                          >
                            Nhắn tin
                          </button>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() => setConfirm(row)}
                          >
                            Hủy kết bạn
                          </button>
                        </>
                      ) : tab === 'messageRequests' ? (
                        <>
                          {row.direction !== 'outgoing' && (
                            <button
                              className="secondary accept"
                              disabled={busy}
                              onClick={() =>
                                void action(
                                  async () => {
                                    await api.authenticated(
                                      `/message-requests/${row.id}`,
                                      { action: 'accept' },
                                      'PATCH',
                                    );
                                    setChatRecipient({
                                      id: row.user.id,
                                      key: Date.now(),
                                    });
                                  },
                                  'Đã chấp nhận tin nhắn chờ.',
                                  false,
                                ).then((succeeded) => {
                                  if (mounted.current && succeeded)
                                    setTab('conversations');
                                })
                              }
                            >
                              Chấp nhận
                            </button>
                          )}
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void action(
                                () =>
                                  api.authenticated(
                                    `/message-requests/${row.id}`,
                                    {
                                      action:
                                        row.direction === 'outgoing'
                                          ? 'cancel'
                                          : 'reject',
                                    },
                                    'PATCH',
                                  ),
                                row.direction === 'outgoing'
                                  ? 'Đã thu hồi tin nhắn chờ.'
                                  : 'Đã từ chối tin nhắn chờ.',
                              )
                            }
                          >
                            {row.direction === 'outgoing'
                              ? 'Thu hồi'
                              : 'Từ chối'}
                          </button>
                        </>
                      ) : (
                        <>
                          {tab === 'incoming' && (
                            <button
                              className="secondary accept"
                              disabled={busy}
                              onClick={() =>
                                void action(
                                  () =>
                                    api.authenticated(
                                      `/friend-requests/${row.id}`,
                                      { action: 'accept' },
                                      'PATCH',
                                    ),
                                  'Đã chấp nhận lời mời kết bạn.',
                                )
                              }
                            >
                              Chấp nhận
                            </button>
                          )}
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void action(
                                () =>
                                  api.authenticated(
                                    `/friend-requests/${row.id}`,
                                    {
                                      action:
                                        tab === 'incoming'
                                          ? 'reject'
                                          : 'cancel',
                                    },
                                    'PATCH',
                                  ),
                                tab === 'incoming'
                                  ? 'Đã từ chối lời mời.'
                                  : 'Đã thu hồi lời mời.',
                              )
                            }
                          >
                            {tab === 'incoming' ? 'Từ chối' : 'Thu hồi'}
                          </button>
                        </>
                      )}
                      <ReportButton
                        compact
                        target={{
                          targetType: 'user',
                          targetId: row.user.id,
                          label: `Báo cáo ${row.user.displayName}`,
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              {cursor && (
                <button
                  className="secondary load-more"
                  disabled={loading || busy}
                  onClick={() => void load(cursor)}
                >
                  Xem thêm
                </button>
              )}
            </>
          )}
        </main>
      </div>
      <AiChatbox
        open={aiChatOpen}
        onClose={() => setAiChatOpen(false)}
        userName={user.displayName}
        onExpired={onExpired}
      />
    </div>
  );
}
