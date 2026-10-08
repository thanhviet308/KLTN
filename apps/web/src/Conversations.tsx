import { useEffect, useRef, useState } from 'react';
import * as api from './api';
import { RelativeTime } from './RelativeTime';
import { Chat } from './Chat';
import { cachedHistory, loadRecentHistory } from './chat-history-cache';
import type { History } from './chat-model';

type Role = 'owner' | 'admin' | 'member';
interface Peer {
  id: string;
  displayName: string;
}
interface Member {
  id: string;
  user: Peer;
  role: Role;
}
interface Conversation {
  unreadCount?: number;
  lastMessage?: {
    id: string;
    senderId: string;
    senderName?: string;
    sequence: string;
    type?: string;
    body: string | null;
    createdAt: string;
    deletedAt?: string | null;
  } | null;
  peer?: Peer | null;
  id: string;
  type: 'direct' | 'group';
  title: string | null;
  membership: { role: Role; lastReadSequence: string };
  lastMessageSequence: string;
  createdAt: string;
  updatedAt?: string;
}
interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
const roles: Record<Role, string> = {
  owner: 'Chủ nhóm',
  admin: 'Quản trị viên',
  member: 'Thành viên',
};

export function Conversations({
  user,
  onExpired,
  active = true,
  recipient,
}: {
  user: api.User;
  onExpired: () => void;
  active?: boolean;
  recipient?: { id: string; key: number };
}) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [directNames, setDirectNames] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation>();
  const [members, setMembers] = useState<Member[]>([]);
  const [friends, setFriends] = useState<Peer[]>([]);
  const [creating, setCreating] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [filter, setFilter] = useState('');
  const [friendFilter, setFriendFilter] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [type, setType] = useState<'direct' | 'group'>('direct');
  const [title, setTitle] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [invite, setInvite] = useState('');
  const [rename, setRename] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<{
    text: string;
    path: string;
    body?: unknown;
    method: string;
    leave?: boolean;
  }>();
  const requestKey = useRef<{ fingerprint: string; id: string } | undefined>(
    undefined,
  );
  const live = useRef(true);
  const readVersion = useRef(0);
  const listVersion = useRef(0);
  const listRequests = useRef(0);
  const handledRecipient = useRef<number | undefined>(undefined);
  function preload(id: string) {
    const key = `${user.id}:${id}`;
    if (cachedHistory(key)) return;
    void loadRecentHistory(key, () =>
      api.authenticated<History>(
        `/conversations/${id}/messages?direction=backward&limit=50`,
      ),
    ).catch(() => {});
  }
  function fail(e: unknown) {
    if (e instanceof api.ApiError && e.status === 401) onExpired();
    else setError(api.errorMessage(e));
  }
  async function all<T>(path: string): Promise<T[]> {
    const result: T[] = [];
    let next: string | null = null;
    do {
      const page: Page<T> = await api.authenticated(
        `${path}?limit=50${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
      );
      result.push(...page.items);
      next = page.nextCursor;
    } while (next);
    return result;
  }
  async function list(next?: string, background = false) {
    if (background && listRequests.current) return;
    listRequests.current++;
    try {
      const version = ++listVersion.current;
      const page = await api.authenticated<Page<Conversation>>(
        `/conversations?limit=20${next ? `&cursor=${next}` : ''}`,
      );
      const names = page.items
        .filter((item) => item.type === 'direct')
        .map((item) => {
          return [
            item.id,
            item.peer?.displayName ?? 'Trò chuyện riêng',
          ] as const;
        });
      if (!live.current || version !== listVersion.current) return;
      setDirectNames((previous) => ({
        ...previous,
        ...Object.fromEntries(names),
      }));
      setItems((previous) =>
        next || background
          ? [
              ...previous.map(
                (old) => page.items.find((item) => item.id === old.id) ?? old,
              ),
              ...page.items.filter(
                (item) => !previous.some((old) => old.id === item.id),
              ),
            ]
          : page.items,
      );
      if (!background) setCursor(page.nextCursor);
      setListLoading(false);
      if (!background && !next)
        page.items.slice(0, 2).forEach((item) => preload(item.id));
    } finally {
      listRequests.current--;
    }
  }
  async function detail(id: string) {
    const version = ++readVersion.current;
    const [result, people] = await Promise.all([
      api.authenticated<{ conversation: Conversation }>(`/conversations/${id}`),
      all<Member>(`/conversations/${id}/members`),
    ]);
    if (!live.current || version !== readVersion.current) return;
    setSelected(result.conversation);
    setMembers(people);
    setRename(result.conversation.title ?? '');
  }
  async function run(work: () => Promise<void>, success = '') {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      if (live.current) setNotice(success);
    } catch (e) {
      if (!live.current) return;
      fail(e);
      if (e instanceof api.ApiError && e.status === 404) {
        setSelected(undefined);
        setMembers([]);
        void list().catch(fail);
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      readVersion.current++;
      listVersion.current++;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    void list().catch((error) => {
      setListLoading(false);
      fail(error);
    });
    const refresh = () => {
      if (document.visibilityState === 'visible') void list().catch(fail);
    };
    window.addEventListener('focus', refresh);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible')
        void list(undefined, true).catch(fail);
    }, 30000);
    return () => {
      window.removeEventListener('focus', refresh);
      clearInterval(interval);
    };
  }, [active]);
  useEffect(() => {
    if (!recipient || busy || handledRecipient.current === recipient.key)
      return;
    handledRecipient.current = recipient.key;
    void startDirect(recipient.id);
  }, [recipient?.key, busy]);
  const isGroup = selected?.type === 'group';
  const owner = isGroup && selected.membership.role === 'owner';
  const manager = isGroup && selected.membership.role !== 'member';
  const heading = selected
    ? selected.type === 'group'
      ? selected.title
      : (members.find((member) => member.user.id !== user.id)?.user
          .displayName ?? 'Trò chuyện riêng')
    : 'Hội thoại';
  async function loadFriends() {
    const rows = await all<{ user: Peer }>('/friends');
    if (live.current) setFriends(rows.map((row) => row.user));
  }
  async function create() {
    if (type === 'group' && (!title.trim() || title.trim().length > 200)) {
      setError('Tên nhóm cần từ 1 đến 200 ký tự.');
      return;
    }
    if (!chosen.length || (type === 'group' && chosen.length > 49)) {
      setError(
        type === 'direct'
          ? 'Chọn một người bạn để tạo hội thoại.'
          : 'Chọn từ 1 đến 49 người bạn.',
      );
      return;
    }
    await run(async () => {
      const fingerprint = JSON.stringify({
        title: title.trim(),
        memberIds: [...chosen].sort(),
      });
      if (!requestKey.current || requestKey.current.fingerprint !== fingerprint)
        requestKey.current = { fingerprint, id: crypto.randomUUID() };
      const body =
        type === 'direct'
          ? { type, recipientId: chosen[0] }
          : {
              type,
              title: title.trim(),
              memberIds: chosen,
              clientRequestId: requestKey.current.id,
            };
      const result = await api.authenticated<{ conversation: Conversation }>(
        '/conversations',
        body,
      );
      setCreating(false);
      await Promise.all([list(), detail(result.conversation.id)]);
      requestKey.current = undefined;
    });
  }
  async function startDirect(recipientId: string) {
    await run(async () => {
      const result = await api.authenticated<{ conversation: Conversation }>(
        '/conversations',
        { type: 'direct', recipientId },
      );
      setCreating(false);
      setShowInfo(false);
      setConfirmation(undefined);
      await Promise.all([detail(result.conversation.id), list()]);
    });
  }
  function compose(kind: 'direct' | 'group') {
    setType(kind);
    setCreating(true);
    setSelected(undefined);
    setShowInfo(false);
    setChosen([]);
    setFriendFilter('');
    setTitle('');
    setConfirmation(undefined);
    requestKey.current = undefined;
    void run(loadFriends);
  }
  return (
    <section
      className={`conversations messenger-layout${selected || creating ? ' has-thread' : ''}`}
      aria-busy={busy}
    >
      <aside className="thread-sidebar" aria-label="Danh sách trò chuyện">
        <div className="thread-sidebar-heading">
          <h2>Đoạn chat</h2>
          <button
            className="secondary accept"
            disabled={busy}
            onClick={() => compose('direct')}
          >
            Nhắn mới
          </button>
        </div>
        <input
          aria-label="Tìm cuộc trò chuyện"
          placeholder="Tìm cuộc trò chuyện"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="thread-tools">
          <button
            className="retry"
            disabled={busy}
            onClick={() => compose('group')}
          >
            Tạo nhóm
          </button>
          <button
            className="retry"
            disabled={busy}
            onClick={() => void run(() => list())}
          >
            Tải lại
          </button>
        </div>
        <ul className="thread-list">
          {items
            .slice()
            .sort((a, b) => {
              const time = (item: Conversation) =>
                Date.parse(
                  item.updatedAt ??
                    item.lastMessage?.createdAt ??
                    item.createdAt,
                );
              return time(b) - time(a) || b.id.localeCompare(a.id);
            })
            .filter((item) =>
              (item.title ?? directNames[item.id] ?? 'Trò chuyện riêng')
                .toLocaleLowerCase('vi')
                .includes(filter.toLocaleLowerCase('vi')),
            )
            .map((item) => (
              <li key={item.id}>
                <button
                  className={`${selected?.id === item.id ? 'selected' : ''}${item.unreadCount ? ' unread' : ''}`}
                  disabled={busy}
                  aria-current={selected?.id === item.id ? 'true' : undefined}
                  onMouseEnter={() => preload(item.id)}
                  onFocus={() => preload(item.id)}
                  onClick={() => {
                    setSelected(item);
                    setMembers(
                      item.peer
                        ? [
                            { id: user.id, user, role: 'member' },
                            {
                              id: item.peer.id,
                              user: item.peer,
                              role: 'member',
                            },
                          ]
                        : [],
                    );
                    setCreating(false);
                    setShowInfo(false);
                    setConfirmation(undefined);
                    // Direct rows already contain the peer and membership.
                    if (item.type === 'group') void detail(item.id).catch(fail);
                  }}
                >
                  <span className="peer-avatar">
                    {Array.from(
                      item.title ?? directNames[item.id] ?? 'H',
                    )[0]?.toUpperCase()}
                  </span>
                  <span className="thread-summary">
                    <strong>
                      {item.title ?? directNames[item.id] ?? 'Trò chuyện riêng'}
                    </strong>
                    <div className="thread-preview-row">
                      <small>
                        {item.lastMessage
                          ? `${item.lastMessage.senderId === user.id ? 'Bạn: ' : item.type === 'group' ? `${item.lastMessage.senderName ?? 'Thành viên'}: ` : ''}${item.lastMessage.deletedAt ? 'Tin nhắn đã thu hồi' : item.lastMessage.body || (item.lastMessage.type === 'image' ? 'Đã gửi ảnh' : 'Đã gửi tệp')}`
                          : 'Hãy gửi lời chào 👋'}
                      </small>
                      {item.lastMessage && (
                        <>
                          <span
                            className="thread-preview-dot"
                            aria-hidden="true"
                          >
                            ·
                          </span>
                          <RelativeTime
                            className="thread-time"
                            value={item.lastMessage.createdAt}
                          />
                        </>
                      )}
                    </div>
                  </span>
                  {!!item.unreadCount && (
                    <span
                      className="unread-badge"
                      aria-label={`${item.unreadCount} tin nhắn chưa đọc`}
                    >
                      {item.unreadCount > 99 ? '99+' : item.unreadCount}
                    </span>
                  )}
                </button>
              </li>
            ))}
        </ul>
        {listLoading && !items.length && (
          <p className="list-status" role="status">
            Đang tải đoạn chat…
          </p>
        )}
        {!listLoading && !busy && !error && !items.length && (
          <p className="list-status">
            Chưa có đoạn chat. Chọn “Nhắn mới” để bắt đầu.
          </p>
        )}
        {cursor && (
          <button
            className="secondary load-more"
            disabled={busy}
            onClick={() => void run(() => list(cursor))}
          >
            Xem thêm
          </button>
        )}
      </aside>
      <div className="thread-content">
        <div className="conversation-toolbar">
          <h2>
            {creating
              ? type === 'direct'
                ? 'Tin nhắn mới'
                : 'Tạo nhóm'
              : selected
                ? heading
                : 'PingPong'}
          </h2>
          <div className="peer-actions">
            {selected && (
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  readVersion.current++;
                  setSelected(undefined);
                  setConfirmation(undefined);
                  setError('');
                  setNotice('');
                }}
              >
                Quay lại
              </button>
            )}
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await list();
                  if (selected) await detail(selected.id);
                })
              }
            >
              Tải lại
            </button>
            {selected && (
              <button
                className="secondary"
                disabled={busy}
                aria-expanded={showInfo}
                onClick={() => setShowInfo(!showInfo)}
              >
                Thông tin
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="message success" role="status">
            {notice}
          </div>
        )}
        {busy && (
          <p className="list-status" role="status">
            Đang cập nhật…
          </p>
        )}
        {creating && !selected && (
          <form
            className="conversation-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <fieldset disabled={busy}>
              {type === 'group' && (
                <label>
                  Tên nhóm
                  <input
                    value={title}
                    maxLength={200}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
              )}
              <p className="hint">
                {type === 'direct'
                  ? 'Chọn một người trong danh sách bạn bè.'
                  : `Chọn thành viên · ${chosen.length}/49`}
              </p>
              {!friends.length && (
                <p className="intro">
                  Bạn cần kết bạn trước khi tạo hội thoại.
                </p>
              )}
              <div className="friend-picker">
                <input
                  aria-label="Tìm người nhận"
                  placeholder="Tìm bạn theo tên…"
                  value={friendFilter}
                  onChange={(event) => setFriendFilter(event.target.value)}
                />
                {friends
                  .filter((peer) =>
                    peer.displayName
                      .toLocaleLowerCase('vi')
                      .includes(friendFilter.toLocaleLowerCase('vi').trim()),
                  )
                  .map((peer) =>
                    type === 'direct' ? (
                      <button
                        className="compose-peer"
                        type="button"
                        key={peer.id}
                        onClick={() => void startDirect(peer.id)}
                      >
                        <span className="peer-avatar">
                          {Array.from(peer.displayName)[0]?.toUpperCase()}
                        </span>
                        {peer.displayName}
                        <span>→</span>
                      </button>
                    ) : (
                      <label key={peer.id}>
                        <input
                          type="checkbox"
                          name="conversation-peer"
                          checked={chosen.includes(peer.id)}
                          disabled={
                            type === 'group' &&
                            chosen.length >= 49 &&
                            !chosen.includes(peer.id)
                          }
                          onChange={() =>
                            setChosen((previous) =>
                              previous.includes(peer.id)
                                ? previous.filter((id) => id !== peer.id)
                                : [...previous, peer.id],
                            )
                          }
                        />
                        {peer.displayName}
                      </label>
                    ),
                  )}
              </div>
              {type === 'group' && (
                <button className="primary" disabled={!friends.length}>
                  Tạo nhóm
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => setCreating(false)}
              >
                Hủy
              </button>
            </fieldset>
          </form>
        )}
        {!selected && !creating && (
          <div className="chat-placeholder">
            <span className="chat-symbol">✉</span>
            <h2>Những cuộc trò chuyện của bạn</h2>
            <p>Chọn một đoạn chat hoặc nhắn mới cho một người bạn.</p>
            <button
              className="secondary accept"
              disabled={busy}
              onClick={() => compose('direct')}
            >
              Nhắn mới
            </button>
          </div>
        )}
        {selected && !showInfo && (
          <Chat
            key={selected.id}
            conversationId={selected.id}
            user={user}
            peers={members.map((member) => member.user)}
            active={active}
            onReadSequence={(sequence) =>
              setItems((previous) =>
                previous.map((item) =>
                  item.id === selected.id &&
                  BigInt(sequence) >
                    BigInt(item.membership.lastReadSequence ?? '0')
                    ? {
                        ...item,
                        membership: {
                          ...item.membership,
                          lastReadSequence: sequence,
                        },
                        unreadCount:
                          item.lastMessage &&
                          BigInt(sequence) >= BigInt(item.lastMessage.sequence)
                            ? 0
                            : item.unreadCount,
                      }
                    : item,
                ),
              )
            }
            onLatestMessage={(message) =>
              setItems((previous) =>
                previous.map((item) =>
                  item.id === message.conversationId &&
                  (!item.lastMessage ||
                    BigInt(message.sequence) >=
                      BigInt(item.lastMessage.sequence))
                    ? {
                        ...item,
                        updatedAt:
                          Date.parse(message.createdAt) >
                          Date.parse(item.updatedAt ?? item.createdAt)
                            ? message.createdAt
                            : item.updatedAt,
                        lastMessage: {
                          ...message,
                          body: message.body?.slice(0, 200) ?? null,
                          senderName: members.find(
                            (member) => member.user.id === message.senderId,
                          )?.user.displayName,
                        },
                      }
                    : item,
                ),
              )
            }
            onExpired={onExpired}
          />
        )}
        {selected && showInfo && (
          <>
            <p className="intro">
              {isGroup
                ? `${members.length}/50 thành viên · ${roles[selected.membership.role]}`
                : 'Trò chuyện riêng'}{' '}
            </p>
            {manager && (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!rename.trim() || rename.trim().length > 200) {
                    setError('Tên nhóm cần từ 1 đến 200 ký tự.');
                    return;
                  }
                  void run(async () => {
                    await api.authenticated(
                      `/conversations/${selected.id}`,
                      { title: rename.trim() },
                      'PATCH',
                    );
                    await detail(selected.id);
                    await list();
                  }, 'Đã đổi tên nhóm.');
                }}
              >
                <label>
                  Tên nhóm
                  <input
                    value={rename}
                    maxLength={200}
                    disabled={busy}
                    onChange={(e) => setRename(e.target.value)}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={busy || rename.trim() === selected.title}
                >
                  Lưu tên nhóm
                </button>
              </form>
            )}
            <h3>Thành viên</h3>
            {confirmation && (
              <div className="confirm-panel" role="alert">
                <p>{confirmation.text}</p>
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      try {
                        await api.authenticated(
                          confirmation.path,
                          confirmation.body,
                          confirmation.method,
                        );
                      } catch (e) {
                        if (
                          confirmation.leave &&
                          e instanceof api.ApiError &&
                          e.status === 404
                        ) {
                          /* Already left. */
                        } else {
                          if (!confirmation.leave)
                            await detail(selected.id).catch(() => {});
                          throw e;
                        }
                      }
                      setConfirmation(undefined);
                      if (confirmation.leave) {
                        setSelected(undefined);
                        setMembers([]);
                      } else await detail(selected.id);
                      await list();
                    }, 'Đã cập nhật hội thoại.')
                  }
                >
                  Xác nhận
                </button>{' '}
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => setConfirmation(undefined)}
                >
                  Hủy
                </button>
              </div>
            )}
            <ul className="people-list">
              {members.map((member) => (
                <li key={member.id}>
                  <span className="peer-avatar">
                    {Array.from(member.user.displayName)[0]?.toUpperCase()}
                  </span>
                  <div>
                    <strong>
                      {member.user.displayName}
                      {member.user.id === user.id ? ' (bạn)' : ''}
                    </strong>
                    <p className="hint">
                      {isGroup ? roles[member.role] : 'Thành viên'}
                    </p>
                  </div>
                  <div className="peer-actions">
                    {owner && member.user.id !== user.id && (
                      <>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              text: `${member.role === 'admin' ? 'Gỡ quyền quản trị của' : 'Cấp quyền quản trị cho'} ${member.user.displayName}?`,
                              path: `/conversations/${selected.id}/members/${member.user.id}`,
                              method: 'PATCH',
                              body: {
                                role:
                                  member.role === 'admin' ? 'member' : 'admin',
                              },
                            })
                          }
                        >
                          {member.role === 'admin'
                            ? 'Gỡ quản trị'
                            : 'Cấp quản trị'}
                        </button>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              text: `Chuyển quyền chủ nhóm cho ${member.user.displayName}? Bạn sẽ trở thành quản trị viên.`,
                              path: `/conversations/${selected.id}/transfer-ownership`,
                              method: 'POST',
                              body: { userId: member.user.id },
                            })
                          }
                        >
                          Chuyển chủ nhóm
                        </button>
                      </>
                    )}
                    {manager &&
                      member.user.id !== user.id &&
                      (owner
                        ? member.role !== 'owner'
                        : member.role === 'member') && (
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() =>
                            setConfirmation({
                              text: `Xóa ${member.user.displayName} khỏi nhóm?`,
                              path: `/conversations/${selected.id}/members/${member.user.id}`,
                              method: 'DELETE',
                            })
                          }
                        >
                          Xóa khỏi nhóm
                        </button>
                      )}
                  </div>
                </li>
              ))}
            </ul>
            {manager && (
              <div className="invite-panel">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void run(loadFriends)}
                >
                  Chọn bạn để mời
                </button>
                {friends.length > 0 && (
                  <form
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!invite) {
                        setError('Chọn người bạn muốn mời.');
                        return;
                      }
                      void run(async () => {
                        await api.authenticated(
                          `/conversations/${selected.id}/members`,
                          { userId: invite },
                        );
                        setInvite('');
                        await detail(selected.id);
                      }, 'Đã thêm thành viên.');
                    }}
                  >
                    <label>
                      Mời thành viên
                      <select
                        value={invite}
                        disabled={busy}
                        onChange={(e) => setInvite(e.target.value)}
                      >
                        <option value="">Chọn một người bạn</option>
                        {friends
                          .filter(
                            (peer) =>
                              !members.some(
                                (member) => member.user.id === peer.id,
                              ),
                          )
                          .map((peer) => (
                            <option key={peer.id} value={peer.id}>
                              {peer.displayName}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      className="secondary"
                      disabled={busy || members.length >= 50}
                    >
                      Thêm vào nhóm
                    </button>
                  </form>
                )}
              </div>
            )}
            {isGroup &&
              (owner ? (
                <p className="hint">
                  Chuyển quyền chủ nhóm cho một thành viên trước khi rời nhóm.
                </p>
              ) : (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    setConfirmation({
                      text: 'Rời nhóm này? Bạn sẽ không còn truy cập được hội thoại.',
                      path: `/conversations/${selected.id}/members/${user.id}`,
                      method: 'DELETE',
                      leave: true,
                    })
                  }
                >
                  Rời nhóm
                </button>
              ))}
          </>
        )}
      </div>
    </section>
  );
}
