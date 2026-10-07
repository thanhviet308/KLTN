import { useEffect, useRef, useState } from 'react';
import * as api from './api';
import { Conversations } from './Conversations';

type Tab =
  'conversations' | 'friends' | 'incoming' | 'outgoing' | 'search' | 'profile';
interface Peer {
  id: string;
  displayName: string;
}
interface Row {
  id: string;
  user: Peer;
}
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
const tabs: [Tab, string][] = [
  ['conversations', 'Đoạn chat'],
  ['friends', 'Bạn bè'],
  ['incoming', 'Lời mời nhận'],
  ['outgoing', 'Lời mời đã gửi'],
  ['search', 'Tìm bạn'],
  ['profile', 'Tài khoản'],
];

export function Home({
  user,
  onUser,
  onLogout,
  onExpired,
}: {
  user: api.User;
  onUser: (user: api.User) => void;
  onLogout: () => Promise<void>;
  onExpired: () => void;
}) {
  const [tab, setTab] = useState<Tab>('conversations');
  const [rows, setRows] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState(user.displayName);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<Row>();
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
      generation.current++;
    },
    [],
  );
  useEffect(() => {
    setName(user.displayName);
  }, [user.displayName]);

  function fail(e: unknown) {
    if (e instanceof api.ApiError && e.status === 401) onExpired();
    else setError(api.errorMessage(e));
  }
  async function load(next?: string, search = submittedQuery) {
    const current = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: '20' });
      if (next) params.set('cursor', next);
      let path = '/friends';
      if (tab === 'incoming' || tab === 'outgoing') {
        path = '/friend-requests';
        params.set('direction', tab);
      }
      if (tab === 'search') {
        path = '/users';
        params.set('query', search);
      }
      const page = await api.authenticated<Page<Row | Peer>>(
        `${path}?${params}`,
      );
      if (current !== generation.current) return;
      const items: Row[] = page.items.map((item) =>
        'user' in item ? item : { id: item.id, user: item },
      );
      setRows((previous) =>
        next
          ? [
              ...previous,
              ...items.filter(
                (item) => !previous.some((old) => old.id === item.id),
              ),
            ]
          : items,
      );
      setCursor(page.nextCursor);
    } catch (e) {
      if (current === generation.current) fail(e);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    generation.current++;
    setRows([]);
    setCursor(null);
    setError('');
    setNotice('');
    setConfirm(undefined);
    setSubmittedQuery('');
    if (tab !== 'search' && tab !== 'profile' && tab !== 'conversations')
      void load();
    else setLoading(false);
  }, [tab]);

  async function action(
    work: () => Promise<unknown>,
    message: string,
    reload = true,
  ) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (!mounted.current) return;
      setNotice(message);
      setConfirm(undefined);
      if (reload) await load();
    } catch (e) {
      if (mounted.current) fail(e);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="home-shell">
      <header className="home-header">
        <a href="/" className="brand">
          <span className="brand-icon">P</span> PingPong
          <span className="brand-dot">.</span>
        </a>
        <span className="home-greeting">Chào {user.displayName}</span>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void action(onLogout, '', false)}
        >
          Đăng xuất
        </button>
      </header>
      <div className="home-layout">
        <nav className="home-nav" aria-label="Điều hướng PingPong">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              aria-current={tab === key ? 'page' : undefined}
              disabled={busy}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
        <main
          className={`home-main${tab === 'conversations' ? ' chat-home' : ''}`}
        >
          {tab !== 'conversations' && (
            <div className="home-title">
              <div>
                <span className="eyebrow dark">KHÔNG GIAN CỦA BẠN</span>
                <h1>{tabs.find(([key]) => key === tab)?.[1]}</h1>
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
          {tab === 'conversations' ? (
            <Conversations user={user} onExpired={onExpired} />
          ) : tab === 'profile' ? (
            <section className="profile-panel">
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
                      }>('/users/me', { displayName: name.trim() }, 'PATCH');
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
              {loading && (
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
                          : submittedQuery
                            ? 'Không tìm thấy người dùng'
                            : 'Tìm người bạn muốn kết nối'}
                  </h2>
                  <p>
                    {tab === 'friends'
                      ? 'Tìm bạn bè và gửi lời mời để kết nối trên PingPong.'
                      : tab === 'search'
                        ? 'Thử tìm bằng tên hiển thị đầy đủ.'
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
                    <span className="peer-avatar" aria-hidden="true">
                      {Array.from(row.user.displayName)[0]?.toUpperCase()}
                    </span>
                    <strong>{row.user.displayName}</strong>
                    <div className="peer-actions">
                      {tab === 'search' ? (
                        <button
                          className="secondary"
                          disabled={busy || sent.has(row.user.id)}
                          onClick={() =>
                            void action(
                              async () => {
                                await api.authenticated('/friend-requests', {
                                  recipientId: row.user.id,
                                });
                                setSent((previous) =>
                                  new Set(previous).add(row.user.id),
                                );
                              },
                              'Đã gửi lời mời kết bạn.',
                              false,
                            )
                          }
                        >
                          {sent.has(row.user.id) ? 'Đã gửi lời mời' : 'Kết bạn'}
                        </button>
                      ) : tab === 'friends' ? (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => setConfirm(row)}
                        >
                          Hủy kết bạn
                        </button>
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
    </div>
  );
}
