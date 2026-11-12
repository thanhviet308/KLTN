import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import * as api from '../../lib/api';
import { Chat } from '../chat/Chat';
import { Avatar } from '../../components/Avatar';
import { UiIcon } from '../../components/UiIcon';
import { presenceLabel, type Presence } from '../../hooks/usePresence';
import { cachedHistory, loadRecentHistory } from '../../lib/chat-history-cache';
import {
  messageSummary,
  newestMessagesFirst,
  type History,
  type Message,
} from '../../lib/chat-model';
import { CallExperience, type StartCall } from '../calls/CallExperience';
import { playMessageSound } from '../../lib/notification-sounds';
import { MessageMedia } from '../chat/ChatMedia';
import { SharedMediaDialog } from './SharedMediaDialog';
import { SharedFileRow } from './SharedFileRow';
import { Bell, BellOff, Sparkles } from 'lucide-react';
import type { Peer, Page } from '../../lib/types';
import {
  roles,
  visibleConversations,
  type Conversation,
  type ConversationCategory,
  type Member,
} from './types';
import { ActiveFriends, type FriendNote } from './ActiveFriends';
import { ConversationSummaryPanel } from './ConversationSummaryPanel';
import { ComposeForm } from './ComposeForm';
import { ThreadListItem } from './ThreadListItem';

export function Conversations({
  user,
  onExpired,
  active = true,
  recipient,
  presence = {},
  onUnreadCount,
  aiChatOpen = false,
  onToggleAiChat,
}: {
  user: api.User;
  onExpired: () => void;
  active?: boolean;
  recipient?: { id: string; key: number };
  presence?: Record<string, Presence>;
  onUnreadCount?: (count: number) => void;
  aiChatOpen?: boolean;
  onToggleAiChat?: () => void;
}) {
  const [items, setItems] = useState<Conversation[]>([]);
  const [directNames, setDirectNames] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Conversation>();
  const [members, setMembers] = useState<Member[]>([]);
  const [sharedMessages, setSharedMessages] = useState<Message[]>([]);
  const [incomingNotice, setIncomingNotice] = useState<Message>();
  useEffect(() => {
    if (!incomingNotice) return;
    const timer = window.setTimeout(() => setIncomingNotice(undefined), 5000);
    return () => window.clearTimeout(timer);
  }, [incomingNotice]);
  const [mediaView, setMediaView] = useState<{
    id: string;
    type: 'image' | 'file';
  }>();
  const [muted, setMuted] = useState<Record<string, boolean>>(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem(`chat-muted:${user.id}`) ?? '{}',
      );
      return stored && typeof stored === 'object' && !Array.isArray(stored)
        ? stored
        : {};
    } catch {
      return {};
    }
  });
  const mutedRef = useRef(muted);
  function toggleMute(id: string) {
    const next = { ...mutedRef.current, [id]: !mutedRef.current[id] };
    mutedRef.current = next;
    setMuted(next);
    try {
      localStorage.setItem(`chat-muted:${user.id}`, JSON.stringify(next));
    } catch {
      /* Keep working in memory when storage is unavailable. */
    }
  }
  const [friends, setFriends] = useState<Peer[]>([]);
  const [notes, setNotes] = useState<FriendNote[]>([]);
  const [messageRequests, setMessageRequests] = useState<
    {
      id: string;
      user: Peer;
      body?: string;
      createdAt?: string;
      direction?: 'incoming' | 'outgoing';
    }[]
  >([]);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [friendsUnavailable, setFriendsUnavailable] = useState(false);
  const onlineFriends = friends
    .filter((peer) => presence[peer.id]?.online)
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));
  const [creating, setCreating] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [filter, setFilter] = useState('');
  const [category, setCategory] = useState<ConversationCategory | 'requests'>(
    'all',
  );
  const [friendFilter, setFriendFilter] = useState('');
  const matchingFriends = friends.filter((peer) =>
    peer.displayName
      .toLocaleLowerCase('vi')
      .includes(friendFilter.toLocaleLowerCase('vi').trim()),
  );
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
  const callStart = useRef<StartCall | undefined>(undefined);
  const inboxSocket = useRef<Socket | undefined>(undefined);
  const conversationIds = useRef<string[]>([]);
  const selectedId = useRef<string | undefined>(undefined);
  const viewActive = useRef(active);
  conversationIds.current = items.slice(0, 50).map((item) => item.id);
  selectedId.current = selected?.id;
  viewActive.current = active;
  const totalUnread = items.reduce(
    (total, item) => total + (item.unreadCount ?? 0),
    0,
  );
  useEffect(() => {
    onUnreadCount?.(totalUnread);
  }, [onUnreadCount, totalUnread]);
  const registerCallStart = useCallback((start: StartCall | undefined) => {
    callStart.current = start;
  }, []);
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
    setSelected({
      ...result.conversation,
      peer:
        result.conversation.type === 'direct'
          ? (people.find((member) => member.user.id !== user.id)?.user ?? null)
          : null,
    });
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
    let stopped = false;
    let currentToken = '';
    const client = io(`${api.API_ORIGIN}/chat`, {
      transports: ['websocket'],
      autoConnect: false,
      auth: (done) => {
        void api.accessToken().then(
          (accessToken) => {
            if (!stopped) {
              currentToken = accessToken;
              done({ accessToken });
            }
          },
          () => done({}),
        );
      },
    });
    inboxSocket.current = client;
    const subscribe = () => {
      if (!client.connected) return;
      for (const conversationId of conversationIds.current)
        client.emit('conversation:subscribe', { conversationId });
    };
    client.on('connect', subscribe);
    client.on('message:created', (message: Message) => {
      if (stopped) return;
      const mine = message.senderId === user.id;
      const visibleConversation =
        viewActive.current &&
        selectedId.current === message.conversationId &&
        document.visibilityState === 'visible' &&
        document.hasFocus();
      setItems((previous) => {
        if (!previous.some((item) => item.id === message.conversationId))
          return previous;
        return previous
          .map((item) =>
            item.id === message.conversationId
              ? {
                  ...item,
                  updatedAt: message.createdAt,
                  lastMessage: {
                    ...message,
                    body: message.body?.slice(0, 200) ?? null,
                    senderName:
                      item.type === 'direct'
                        ? item.peer?.displayName
                        : undefined,
                  },
                  unreadCount:
                    mine || visibleConversation
                      ? item.unreadCount
                      : (item.unreadCount ?? 0) + 1,
                }
              : item,
          )
          .sort(
            (left, right) =>
              Date.parse(right.updatedAt ?? right.createdAt) -
              Date.parse(left.updatedAt ?? left.createdAt),
          );
      });
      if (!mine && !mutedRef.current[message.conversationId]) {
        void playMessageSound();
        setIncomingNotice(message);
      }
      if (!conversationIds.current.includes(message.conversationId))
        void list(undefined, true).catch(() => {});
      if (!mine)
        void api
          .authenticated(
            `/conversations/${message.conversationId}/messages/delivered`,
            { messageId: message.id },
          )
          .catch(() => {});
    });
    client.connect();
    const refresh = window.setInterval(() => {
      void api
        .accessToken()
        .then((accessToken) => {
          if (stopped) return;
          if (client.connected && accessToken !== currentToken) {
            client.disconnect();
            client.connect();
          } else if (!client.connected) client.connect();
        })
        .catch(() => {});
    }, 15000);
    return () => {
      stopped = true;
      window.clearInterval(refresh);
      client.removeAllListeners();
      client.disconnect();
      if (inboxSocket.current === client) inboxSocket.current = undefined;
    };
  }, [user.id]);
  useEffect(() => {
    if (!inboxSocket.current?.connected) return;
    for (const conversationId of conversationIds.current)
      inboxSocket.current.emit('conversation:subscribe', { conversationId });
  }, [items.map((item) => item.id).join(',')]);
  useEffect(() => {
    if (!active) return;
    const refreshFriends = () => {
      void loadFriends().catch(() => {
        if (live.current) {
          setFriendsUnavailable(true);
          setFriendsLoading(false);
        }
      });
    };
    refreshFriends();
    void list().catch((error) => {
      setListLoading(false);
      fail(error);
    });
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void list().catch(fail);
        refreshFriends();
      }
    };
    window.addEventListener('focus', refresh);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        void list(undefined, true).catch(fail);
        refreshFriends();
      }
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
  const visibleThreads = visibleConversations(
    items,
    category === 'requests' ? 'all' : category,
    filter,
    directNames,
  );
  const incomingMessageRequestsCount = messageRequests.filter(
    (req) => req.direction !== 'outgoing',
  ).length;
  const visibleMessageRequests = messageRequests.filter((req) =>
    req.user.displayName
      .toLocaleLowerCase('vi')
      .includes(filter.toLocaleLowerCase('vi').trim()),
  );
  const isGroup = selected?.type === 'group';
  const owner = isGroup && selected.membership.role === 'owner';
  const manager = isGroup && selected.membership.role !== 'member';
  const selectedPeer =
    selected?.type === 'direct'
      ? (items.find((item) => item.id === selected.id)?.peer ??
        selected.peer ??
        members.find((member) => member.user.id !== user.id)?.user)
      : undefined;
  const heading = selected
    ? selected.type === 'group'
      ? selected.title
      : (members.find((member) => member.user.id !== user.id)?.user
          .displayName ?? 'Trò chuyện riêng')
    : 'Hội thoại';
  async function loadFriends() {
    const [rows, notePage, reqPage] = await Promise.all([
      all<{ user: Peer }>('/friends'),
      api.authenticated<{ items: FriendNote[] }>('/notes'),
      api
        .authenticated<{
          items: {
            id: string;
            user: Peer;
            body?: string;
            createdAt?: string;
            direction?: 'incoming' | 'outgoing';
          }[];
        }>('/message-requests?direction=all&limit=20')
        .catch(() => ({ items: [] })),
    ]);
    if (live.current) {
      setFriends(rows.map((row) => row.user));
      setNotes(notePage.items);
      setMessageRequests(reqPage.items);
      setFriendsLoading(false);
      setFriendsUnavailable(false);
    }
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
      className={`conversations messenger-layout${selected || creating ? ' has-thread' : ''}${selected && !creating && !showInfo ? ' has-summary' : ''}`}
      aria-busy={busy}
    >
      <aside className="thread-sidebar" aria-label="Danh sách trò chuyện">
        <div className="thread-sidebar-heading">
          <h2>Đoạn chat</h2>
          <button
            className="secondary accept"
            aria-label="Nhắn tin mới"
            title="Nhắn tin mới"
            disabled={busy}
            onClick={() => compose('direct')}
          >
            <UiIcon name="compose" />
          </button>
        </div>
        <div className="thread-search">
          <UiIcon name="search" size={18} />
          <input
            aria-label="Tìm cuộc trò chuyện"
            placeholder="Tìm cuộc trò chuyện"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <ActiveFriends
          loading={friendsLoading}
          unavailable={friendsUnavailable}
          online={onlineFriends}
          friends={friends}
          presence={presence}
          notes={notes}
          currentUser={user}
          hasFriends={friends.length > 0}
          presenceLoaded={Object.keys(presence).length > 0}
          busy={busy}
          onRetry={() => void run(loadFriends)}
          onOpen={(peerId) => void startDirect(peerId)}
          onNoteChange={(note) =>
            setNotes((previous) => [
              ...(note ? [note] : []),
              ...previous.filter((item) => item.user.id !== user.id),
            ])
          }
        />
        <div className="thread-filters" aria-label="Lọc đoạn chat">
          {(
            [
              ['all', 'Tất cả'],
              ['unread', 'Chưa đọc'],
              ['group', 'Nhóm'],
              ['requests', 'Tin nhắn chờ'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={category === key}
              onClick={() => setCategory(key)}
            >
              {label}
              {key === 'requests' && incomingMessageRequestsCount > 0 && (
                <span className="thread-filter-badge">
                  {incomingMessageRequestsCount > 99
                    ? '99+'
                    : incomingMessageRequestsCount}
                </span>
              )}
            </button>
          ))}
        </div>
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
            onClick={() =>
              void run(async () => {
                await Promise.all([list(), loadFriends()]);
              })
            }
          >
            Tải lại
          </button>
        </div>
        {category === 'requests' ? (
          <>
            <ul className="thread-list thread-requests-list">
              {visibleMessageRequests.map((req) => (
                <li key={req.id} className="thread-request-card">
                  <div className="thread-request-top">
                    <span className="peer-avatar" aria-hidden="true">
                      <Avatar peer={req.user} />
                    </span>
                    <div className="thread-request-meta">
                      <strong>{req.user.displayName}</strong>
                      <small>
                        {req.direction === 'outgoing'
                          ? 'Bạn đã gửi tin nhắn chờ'
                          : 'Đã gửi tin nhắn chờ cho bạn'}
                      </small>
                    </div>
                  </div>
                  {req.body && (
                    <p className="thread-request-preview">{req.body}</p>
                  )}
                  <div className="thread-request-actions">
                    {req.direction !== 'outgoing' && (
                      <button
                        type="button"
                        className="secondary accept"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await api.authenticated(
                              `/message-requests/${req.id}`,
                              { action: 'accept' },
                              'PATCH',
                            );
                            await loadFriends();
                            setCategory('all');
                            await startDirect(req.user.id);
                          })
                        }
                      >
                        Chấp nhận
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api.authenticated(
                            `/message-requests/${req.id}`,
                            {
                              action:
                                req.direction === 'outgoing'
                                  ? 'cancel'
                                  : 'reject',
                            },
                            'PATCH',
                          );
                          await loadFriends();
                        })
                      }
                    >
                      {req.direction === 'outgoing' ? 'Thu hồi' : 'Từ chối'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {visibleMessageRequests.length === 0 && (
              <p className="list-status">
                {filter
                  ? 'Không tìm thấy tin nhắn chờ phù hợp.'
                  : 'Chưa có tin nhắn chờ nào.'}
              </p>
            )}
          </>
        ) : (
          <>
            <ul className="thread-list">
              {visibleThreads.map((item) => (
                <ThreadListItem
                  key={item.id}
                  item={item}
                  currentUserId={user.id}
                  selected={selected?.id === item.id}
                  busy={busy}
                  directNames={directNames}
                  presence={presence}
                  onPreload={() => preload(item.id)}
                  onSelect={() => {
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
                />
              ))}
            </ul>
            {!listLoading &&
              items.length > 0 &&
              visibleThreads.length === 0 && (
                <p className="list-status">
                  {filter
                    ? 'Không tìm thấy cuộc trò chuyện phù hợp.'
                    : category === 'unread'
                      ? 'Bạn đã đọc hết tin nhắn.'
                      : 'Chưa có cuộc trò chuyện nhóm.'}
                </p>
              )}
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
          </>
        )}
      </aside>
      <div className="thread-content">
        <div className="conversation-toolbar">
          {(selected || creating) && (
            <button
              className="chat-back"
              type="button"
              aria-label="Trở về danh sách trò chuyện"
              onClick={() => {
                readVersion.current++;
                setSelected(undefined);
                setCreating(false);
                setShowInfo(false);
                setConfirmation(undefined);
                setError('');
                setNotice('');
              }}
            >
              ←
            </button>
          )}
          <h2>
            {selected ? (
              <button
                className="chat-heading"
                type="button"
                disabled={busy}
                aria-label="Xem thông tin cuộc trò chuyện"
                aria-expanded={showInfo}
                onClick={() => {
                  setShowInfo(!showInfo);
                  if (!showInfo) void run(() => detail(selected.id));
                }}
              >
                <span className="chat-header-avatar">
                  <Avatar
                    peer={selected.peer ?? { displayName: heading ?? 'Nhóm' }}
                  />
                </span>
                <span className="chat-header-title">
                  {heading}
                  <small>
                    {selected.type === 'group' ? (
                      'Trò chuyện nhóm'
                    ) : selectedPeer && presence[selectedPeer.id] ? (
                      <span
                        className={`presence-status${selectedPeer && presence[selectedPeer.id]?.online ? ' is-online' : ''}`}
                      >
                        <span aria-hidden="true" />
                        {presenceLabel(presence[selectedPeer.id])}
                      </span>
                    ) : null}
                  </small>
                </span>
              </button>
            ) : creating ? (
              type === 'direct' ? (
                'Tin nhắn mới'
              ) : (
                'Tạo nhóm'
              )
            ) : (
              'PingPong'
            )}
          </h2>
          {(selected || onToggleAiChat) && (
            <div className="chat-call-actions">
              {onToggleAiChat && (
                <button
                  type="button"
                  className="chat-info-button ai-toolbar-toggle"
                  title="Trợ lý PingPong AI"
                  aria-label="Trợ lý PingPong AI"
                  aria-pressed={aiChatOpen}
                  onClick={onToggleAiChat}
                >
                  <Sparkles size={19} aria-hidden="true" />
                </button>
              )}
              {selected && (
                <>
                  <button
                    type="button"
                    className="chat-info-button"
                    aria-label="Gọi thoại"
                    onClick={() =>
                      void callStart.current?.(selected.id, 'audio')
                    }
                  >
                    <UiIcon name="phone" />
                  </button>
                  <button
                    type="button"
                    className="chat-info-button"
                    aria-label="Gọi video"
                    onClick={() =>
                      void callStart.current?.(selected.id, 'video')
                    }
                  >
                    <UiIcon name="video" />
                  </button>
                  <button
                    type="button"
                    className="chat-info-button"
                    aria-label="Thông tin cuộc trò chuyện"
                    aria-expanded={showInfo}
                    onClick={() => {
                      setShowInfo(!showInfo);
                      if (!showInfo) void run(() => detail(selected.id));
                    }}
                  >
                    <UiIcon name="info" />
                  </button>
                </>
              )}
            </div>
          )}
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
          <ComposeForm
            type={type}
            busy={busy}
            title={title}
            onTitle={setTitle}
            friends={friends}
            matchingFriends={matchingFriends}
            friendFilter={friendFilter}
            onFriendFilter={setFriendFilter}
            chosen={chosen}
            onToggleChosen={(peerId) =>
              setChosen((previous) =>
                previous.includes(peerId)
                  ? previous.filter((id) => id !== peerId)
                  : [...previous, peerId],
              )
            }
            onStartDirect={(peerId) => void startDirect(peerId)}
            onSubmit={() => void create()}
            onCancel={() => setCreating(false)}
          />
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
            isGroup={selected.type === 'group'}
            onMessagesChange={setSharedMessages}
            user={user}
            peers={members.map((member) => member.user)}
            active={active}
            initialLastReadSequence={selected.membership.lastReadSequence}
            initialUnreadCount={selected.unreadCount ?? 0}
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
          <section
            className="conversation-details"
            aria-label="Thông tin cuộc trò chuyện"
          >
            <button
              type="button"
              className="secondary details-back"
              onClick={() => setShowInfo(false)}
            >
              ← Quay lại trò chuyện
            </button>
            <h2>Thông tin cuộc trò chuyện</h2>
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
            <h3>
              Thành viên <span className="member-count">{members.length}</span>
            </h3>
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
                    <Avatar peer={member.user} />
                  </span>
                  <div>
                    <strong>
                      {member.user.displayName}
                      {member.user.id === user.id ? ' (bạn)' : ''}
                    </strong>
                    <p className="hint">
                      {isGroup ? roles[member.role] : 'Thành viên'}
                      {member.user.id !== user.id &&
                        presence[member.user.id] !== undefined &&
                        ` · ${presenceLabel(presence[member.user.id])}`}
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
          </section>
        )}
      </div>
      {selected && !creating && !showInfo && (
        <ConversationSummaryPanel
          conversationId={selected.id}
          heading={heading}
          peer={selectedPeer ?? undefined}
          memberCount={members.length}
          presence={presence}
          muted={!!muted[selected.id]}
          sharedMessages={sharedMessages}
          onCall={(kind) => void callStart.current?.(selected.id, kind)}
          onToggleMute={() => toggleMute(selected.id)}
          onOpenInfo={() => {
            setShowInfo(true);
            void run(() => detail(selected.id));
          }}
          onViewAll={(type) => setMediaView({ id: selected.id, type })}
        />
      )}
      {mediaView && (
        <SharedMediaDialog
          key={`${mediaView.id}:${mediaView.type}`}
          conversationId={mediaView.id}
          type={mediaView.type}
          onClose={() => setMediaView(undefined)}
        />
      )}
      {incomingNotice && (
        <div className="incoming-message-toast" role="status">
          <button
            type="button"
            onClick={() => {
              void run(() => detail(incomingNotice.conversationId));
              setIncomingNotice(undefined);
            }}
          >
            <strong>Tin nhắn mới</strong>
            <span>{messageSummary(incomingNotice)}</span>
          </button>
          <button
            type="button"
            aria-label="Đóng thông báo"
            onClick={() => setIncomingNotice(undefined)}
          >
            ×
          </button>
        </div>
      )}
      <CallExperience
        user={user}
        onExpired={onExpired}
        registerStart={registerCallStart}
      />
    </section>
  );
}
