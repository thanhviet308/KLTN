import { Fragment, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import * as api from './api';
import { Avatar } from './Avatar';
import { MediaTools, MessageMedia, type MediaDraft } from './ChatMedia';
import { MessageActions } from './MessageActions';
import { MessageReactions } from './MessageReactions';
import {
  cachedHistory,
  loadRecentHistory,
  rememberHistory,
} from './chat-history-cache';
import {
  mergeMessages,
  messageSummary,
  mergeReceipt,
  type Message,
  type Receipt,
  type History,
} from './chat-model';

interface Draft {
  clientMessageId: string;
  body: string;
  media?: MediaDraft;
  status: 'sending' | 'failed';
  error?: string;
}
interface Peer {
  avatarUrl?: string | null;
  id: string;
  displayName: string;
}
const drafts = new Map<string, { body: string; pending: Draft[] }>();
export function Chat({
  conversationId,
  user,
  peers,
  onExpired,
  onLatestMessage,
  active = true,
  onReadSequence,
}: {
  conversationId: string;
  user: api.User;
  peers: Peer[];
  onExpired: () => void;
  onLatestMessage?: (message: Message) => void;
  active?: boolean;
  onReadSequence?: (sequence: string) => void;
}) {
  const draftKey = `${user.id}:${conversationId}`;
  const [cached] = useState(() => cachedHistory(draftKey));
  const [messages, setMessages] = useState<Message[]>(cached?.messages ?? []);
  const [pending, setPending] = useState<Draft[]>(() =>
    (drafts.get(draftKey)?.pending ?? []).map((item) => ({
      ...item,
      status: 'failed',
      error: 'Chưa xác nhận gửi. Bạn có thể gửi lại.',
    })),
  );
  const [body, setBody] = useState(() => drafts.get(draftKey)?.body ?? '');
  const [replyTo, setReplyTo] = useState<Message>();
  const [reactionTarget, setReactionTarget] = useState<string>();
  const [reactionVersions, setReactionVersions] = useState<
    Record<string, number>
  >({});
  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const input = composer.current;
    if (!input) return;
    input.style.height = '38px';
    input.style.height = `${Math.min(140, Math.max(38, input.scrollHeight))}px`;
  }, [body]);
  useEffect(() => {
    drafts.set(draftKey, { body, pending });
  }, [body, pending, draftKey]);
  const [older, setOlder] = useState<string | null>(cached?.older ?? null);
  const [loading, setLoading] = useState(!cached);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [connectionDelayed, setConnectionDelayed] = useState(false);
  const [connectionCode, setConnectionCode] = useState('');
  useEffect(() => {
    setConnectionDelayed(false);
    if (connected) return;
    const timer = setTimeout(() => setConnectionDelayed(true), 8000);
    return () => clearTimeout(timer);
  }, [connected]);
  const [unavailable, setUnavailable] = useState(false);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [receipts, setReceipts] = useState<
    Record<string, Record<string, Receipt>>
  >(cached?.receipts ?? {});
  const [receiptMessage, setReceiptMessage] = useState<string>();
  const [receiptLoading, setReceiptLoading] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const socket = useRef<Socket | undefined>(undefined);
  const latest = useRef(cached?.messages.at(-1)?.sequence ?? '0');
  const messageCache = useRef<Message[]>(cached?.messages ?? []);
  // Revalidate recent history on reopen to pick up edits/deletions while closed.
  const freshCache =
    !!cached?.verifiedAt && Date.now() - cached.verifiedAt < 30000;
  const started = useRef(freshCache);
  useEffect(() => {
    if (!loading) rememberHistory(draftKey, { messages, older, receipts });
  }, [messages, older, receipts, loading, draftKey]);
  const alive = useRef(true);
  const nearBottom = useRef(true);
  const acked = useRef(new Set<string>());
  const ackPending = useRef(new Set<string>());
  const sending = useRef(new Set<string>());
  const typingAt = useRef(0);
  const latestCallback = useRef(onLatestMessage);
  latestCallback.current = onLatestMessage;
  const readCallback = useRef(onReadSequence);
  readCallback.current = onReadSequence;
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function fail(e: unknown) {
    if (!alive.current) return;
    if (e instanceof api.ApiError && e.status === 401) onExpired();
    else {
      setError(api.errorMessage(e));
      if (
        e instanceof api.ApiError &&
        e.status === 404 &&
        e.code !== 'MESSAGE_NOT_FOUND'
      )
        setUnavailable(true);
    }
  }
  function accept(incoming: Message[], advanceCursor = false) {
    const cached = drafts.get(draftKey);
    if (cached)
      drafts.set(draftKey, {
        ...cached,
        pending: cached.pending.filter(
          (draft) =>
            !incoming.some(
              (message) =>
                message.senderId === user.id &&
                message.clientMessageId === draft.clientMessageId,
            ),
        ),
      });
    if (!alive.current) return;
    if (advanceCursor)
      for (const message of incoming)
        if (BigInt(message.sequence) > BigInt(latest.current))
          latest.current = message.sequence;
    messageCache.current = mergeMessages(messageCache.current, incoming);
    setMessages(messageCache.current);
    const newest = messageCache.current.at(-1);
    if (newest) latestCallback.current?.(newest);
    setPending((previous) =>
      previous.filter(
        (draft) =>
          !incoming.some(
            (message) =>
              message.senderId === user.id &&
              message.clientMessageId === draft.clientMessageId,
          ),
      ),
    );
  }
  function receipt(next: Receipt) {
    if (alive.current)
      setReceipts((previous) => ({
        ...previous,
        [next.messageId]: {
          ...previous[next.messageId],
          [next.userId]: mergeReceipt(
            previous[next.messageId]?.[next.userId],
            next,
          ),
        },
      }));
  }
  async function acknowledge(message: Message, read: boolean) {
    const key = `${message.id}:${read ? 'read' : 'delivered'}`;
    if (
      acked.current.has(key) ||
      ackPending.current.has(key) ||
      !!message.deletedAt ||
      message.senderId === user.id
    )
      return;
    ackPending.current.add(key);
    try {
      const result = await api.authenticated<{ receipt: Receipt }>(
        `/conversations/${conversationId}/messages/${read ? 'read' : 'delivered'}`,
        { messageId: message.id },
      );
      acked.current.add(key);
      if (read) acked.current.add(`${message.id}:delivered`);
      receipt(result.receipt);
      if (read && alive.current) readCallback.current?.(message.sequence);
    } catch (e) {
      if (e instanceof api.ApiError && e.code === 'MESSAGE_NOT_FOUND') return;
      if (e instanceof api.ApiError && (e.status === 401 || e.status === 404))
        fail(e);
    } finally {
      ackPending.current.delete(key);
    }
  }
  useEffect(() => {
    alive.current = true;
    let syncing = false;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let currentToken = '';
    let lastSyncAt = 0;
    const client = io(`${api.API_ORIGIN}/chat`, {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
    });
    socket.current = client;
    async function sync() {
      if (syncing || Date.now() - lastSyncAt < 2000) {
        return;
      }
      syncing = true;
      lastSyncAt = Date.now();
      try {
        const initial = !started.current;
        if (!started.current) {
          const page = await loadRecentHistory(draftKey, () =>
            api.authenticated<History>(
              `/conversations/${conversationId}/messages?direction=backward&limit=50`,
            ),
          );
          if (stopped) return;
          messageCache.current = [];
          accept(page.items, true);
          setOlder(page.nextCursor);
          started.current = true;
        }
        if (!stopped) setLoading(false);
        if (!initial) {
          let cursor: string | null = latest.current;
          do {
            const page: History = await api.authenticated(
              `/conversations/${conversationId}/messages?direction=forward&limit=50&cursor=${cursor}`,
            );
            if (stopped) return;
            accept(page.items, true);
            cursor = page.nextCursor;
          } while (cursor);
        }
        for (const message of messageCache.current
          .filter((item) => item.senderId === user.id && !item.deletedAt)
          .slice(-1)) {
          try {
            const page = await api.authenticated<{ items: Receipt[] }>(
              `/conversations/${conversationId}/messages/${message.id}/receipts?limit=50`,
            );
            if (stopped) return;
            page.items.forEach(receipt);
          } catch (e) {
            if (!(e instanceof api.ApiError) || e.code !== 'MESSAGE_NOT_FOUND')
              throw e;
          }
        }
        if (!stopped) {
          setLoading(false);
          setError('');
        }
      } catch (e) {
        if (!stopped) {
          fail(e);
          setLoading(false);
        }
      } finally {
        syncing = false;
      }
    }
    async function connect(force = false) {
      try {
        if (force) await api.refresh();
        const token = await api.accessToken();
        if (stopped) return;
        currentToken = token;
        client.auth = { accessToken: token };
        client.connect();
      } catch (e) {
        if (!stopped) {
          fail(e);
          schedule();
        }
      }
    }
    function schedule(force = false) {
      if (stopped || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void connect(force);
      }, 5000);
    }
    client.on('connect', () => {
      client
        .timeout(10000)
        .emit(
          'conversation:subscribe',
          { conversationId },
          (err: Error | null, ack: { ok: boolean; code?: string }) => {
            if (stopped) return;
            if (err || !ack?.ok) {
              setConnected(false);
              if (ack?.code === 'CONVERSATION_NOT_FOUND') {
                setUnavailable(true);
                setError('Bạn không còn quyền truy cập cuộc trò chuyện này.');
                client.disconnect();
              } else {
                client.disconnect();
                schedule();
              }
              return;
            }
            setConnected(true);
            setConnectionCode('');
            void sync();
          },
        );
    });
    client.on('message:created', (message: Message) => {
      if (message.conversationId === conversationId) accept([message]);
    });
    client.on(
      'message:reactions',
      (event: { conversationId: string; messageId: string }) => {
        if (event.conversationId === conversationId && alive.current)
          setReactionVersions((previous) => ({
            ...previous,
            [event.messageId]: (previous[event.messageId] ?? 0) + 1,
          }));
      },
    );
    for (const name of ['message:updated', 'message:deleted']) {
      client.on(name, (message: Message) => {
        if (message.conversationId === conversationId) accept([message]);
      });
    }
    client.on(
      'message:receipt',
      (event: { conversationId: string; receipt: Receipt }) => {
        if (event.conversationId === conversationId) receipt(event.receipt);
      },
    );
    client.on(
      'typing:update',
      (event: {
        conversationId: string;
        userId: string;
        typing: boolean;
        expiresAt: string;
      }) => {
        if (event.conversationId === conversationId && alive.current)
          setTyping((previous) => ({
            ...previous,
            [event.userId]: event.typing ? Date.parse(event.expiresAt) : 0,
          }));
      },
    );
    client.on('sync:required', () => void sync());
    client.on('disconnect', (reason: string) => {
      if (!stopped) {
        setConnected(false);
        // A server disconnect can be a transport or capacity issue. Let token
        // expiry drive renewal; disconnect alone does not prove auth failure.
        schedule();
      }
    });
    client.on('connect_error', (failure) => {
      if (!stopped) {
        setConnected(false);
        setConnectionCode(
          (failure as Error & { data?: { code?: string } }).data?.code ??
            failure.message,
        );
        schedule(
          /AUTH|TOKEN|SESSION|CREDENTIAL/.test(
            (failure as Error & { data?: { code?: string } }).data?.code ??
              failure.message,
          ),
        );
      }
    });
    void sync();
    void connect();
    const typingExpiry = setInterval(() => {
      setTyping((previous) =>
        Object.fromEntries(
          Object.entries(previous).filter(([, expiry]) => expiry > Date.now()),
        ),
      );
    }, 1000);
    const interval = setInterval(() => {
      if (!client.connected) void sync();
      void api
        .accessToken()
        .then((token) => {
          if (!stopped && client.connected && token !== currentToken) {
            client.disconnect();
            if (retryTimer) {
              clearTimeout(retryTimer);
              retryTimer = undefined;
            }
            void connect();
          }
        })
        .catch(fail);
    }, 15000);
    const onFocus = () => {
      if (document.visibilityState === 'visible' && !client.connected)
        void sync();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      stopped = true;
      alive.current = false;
      clearInterval(interval);
      clearInterval(typingExpiry);
      if (retryTimer) clearTimeout(retryTimer);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (client.connected)
        client.emit('typing:update', { conversationId, typing: false });
      client.removeAllListeners();
      client.disconnect();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [conversationId]);
  useEffect(() => {
    const container = list.current;
    if (!container) return;
    if (nearBottom.current) container.scrollTop = container.scrollHeight;
    for (const message of messages) void acknowledge(message, false);
    function markVisible() {
      if (
        !active ||
        document.visibilityState !== 'visible' ||
        !document.hasFocus()
      )
        return;
      const bounds = container!.getBoundingClientRect();
      for (const element of container!.querySelectorAll<HTMLElement>(
        '[data-message-id]',
      )) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom > bounds.top && rect.top < bounds.bottom) {
          const message = messages.find(
            (item) => item.id === element.dataset.messageId,
          );
          if (message) void acknowledge(message, true);
        }
      }
    }
    markVisible();
    container.addEventListener('scroll', markVisible);
    window.addEventListener('focus', markVisible);
    document.addEventListener('visibilitychange', markVisible);
    return () => {
      container.removeEventListener('scroll', markVisible);
      window.removeEventListener('focus', markVisible);
      document.removeEventListener('visibilitychange', markVisible);
    };
  }, [messages, active]);
  useEffect(() => {
    if (nearBottom.current && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [pending]);
  async function loadOlder() {
    if (!older || loadingOlder) return;
    setLoadingOlder(true);
    setError('');
    const container = list.current;
    const height = container?.scrollHeight ?? 0;
    const top = container?.scrollTop ?? 0;
    nearBottom.current = false;
    try {
      const page = await api.authenticated<History>(
        `/conversations/${conversationId}/messages?direction=backward&limit=50&cursor=${older}`,
      );
      accept(page.items);
      if (alive.current) setOlder(page.nextCursor);
      requestAnimationFrame(() => {
        if (container && alive.current)
          container.scrollTop = top + container.scrollHeight - height;
      });
    } catch (e) {
      fail(e);
    } finally {
      if (alive.current) setLoadingOlder(false);
    }
  }
  async function send(draft: Draft) {
    if (sending.current.has(draft.clientMessageId)) return;
    sending.current.add(draft.clientMessageId);
    setPending((previous) => [
      ...previous.filter(
        (item) => item.clientMessageId !== draft.clientMessageId,
      ),
      { ...draft, status: 'sending' },
    ]);
    nearBottom.current = true;
    try {
      const result = draft.media?.file
        ? await api.uploadChatFile<{ message: Message }>(
            conversationId,
            draft.clientMessageId,
            draft.media.file,
            draft.media.type as 'image' | 'file' | 'voice',
          )
        : await api.authenticated<{ message: Message }>(
            `/conversations/${conversationId}/messages`,
            draft.media?.type === 'location'
              ? {
                  clientMessageId: draft.clientMessageId,
                  type: 'location',
                  location: draft.media.location,
                }
              : { clientMessageId: draft.clientMessageId, body: draft.body },
          );
      accept([result.message]);
    } catch (e) {
      if (alive.current)
        setPending((previous) =>
          previous.map((item) =>
            item.clientMessageId === draft.clientMessageId
              ? { ...item, status: 'failed', error: api.errorMessage(e) }
              : item,
          ),
        );
      if (e instanceof api.ApiError && (e.status === 401 || e.status === 404))
        fail(e);
    } finally {
      sending.current.delete(draft.clientMessageId);
    }
  }
  function submit() {
    if (!body.trim()) {
      setError('Vui lòng nhập nội dung tin nhắn.');
      return;
    }
    const original = replyTo
      ? (messageCache.current.find((message) => message.id === replyTo.id) ??
        replyTo)
      : undefined;
    const content = original
      ? `> ${names(original.senderId)}: ${original.deletedAt ? 'Tin nhắn đã thu hồi' : (original.body ?? '').slice(0, 300).replace(/\n/g, '\n> ')}\n\n${body}`
      : body;
    if (content.length > 10000) {
      setError('Tin nhắn tối đa 10.000 ký tự.');
      return;
    }
    const draft: Draft = {
      clientMessageId: crypto.randomUUID(),
      body: content,
      status: 'sending',
    };
    setBody('');
    setReplyTo(undefined);
    setError('');
    updateTyping(false);
    void send(draft);
  }
  function updateTyping(value: boolean) {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (
      socket.current?.connected &&
      (!value || Date.now() - typingAt.current > 3000)
    ) {
      socket.current.emit(
        'typing:update',
        { conversationId, typing: value },
        () => {},
      );
      typingAt.current = Date.now();
    }
    if (value)
      typingTimer.current = setTimeout(() => updateTyping(false), 3500);
  }
  async function viewReceipts(messageId: string) {
    setReceiptMessage(messageId);
    setReceiptLoading(true);
    try {
      let cursor: string | null = null;
      do {
        const page: { items: Receipt[]; nextCursor: string | null } =
          await api.authenticated(
            `/conversations/${conversationId}/messages/${messageId}/receipts?limit=50${cursor ? `&cursor=${cursor}` : ''}`,
          );
        page.items.forEach(receipt);
        cursor = page.nextCursor;
      } while (cursor && alive.current);
    } catch (e) {
      fail(e);
    } finally {
      if (alive.current) setReceiptLoading(false);
    }
  }
  const names = (id: string) =>
    peers.find((peer) => peer.id === id)?.displayName ?? 'Thành viên';
  const lastSentId = pending.length
    ? undefined
    : [...messages].reverse().find((message) => message.senderId === user.id)
        ?.id;
  return (
    <div className="chat-panel">
      {!connected && connectionDelayed && !unavailable && (
        <p className="connection-note" role="status">
          {connectionCode === 'ORIGIN_FORBIDDEN'
            ? 'Kết nối realtime bị từ chối. Kiểm tra WEB_ORIGIN của backend khớp địa chỉ đang mở.'
            : 'Chưa kết nối realtime. Bạn vẫn có thể gửi tin; tin mới đang được cập nhật định kỳ.'}
        </p>
      )}
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      <div
        className="message-timeline"
        ref={list}
        onScroll={() => {
          const node = list.current;
          if (node)
            nearBottom.current =
              node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
        aria-label="Tin nhắn"
      >
        {older && (
          <button
            className="retry"
            disabled={loadingOlder}
            onClick={() => void loadOlder()}
          >
            {loadingOlder ? 'Đang tải…' : 'Xem tin nhắn cũ'}
          </button>
        )}
        {loading && (
          <p className="list-status" role="status">
            Đang tải tin nhắn…
          </p>
        )}
        {!loading && !messages.length && (
          <div className="empty-state">
            <h2>Bắt đầu bằng một lời chào</h2>
            <p>
              {peers.filter((peer) => peer.id !== user.id).length === 1
                ? `Hãy gửi lời chào đến ${peers.find((peer) => peer.id !== user.id)?.displayName} 👋`
                : 'Gửi tin nhắn đầu tiên trong cuộc trò chuyện này.'}
            </p>
          </div>
        )}
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const next = messages[index + 1];
          const continuesGroup =
            !!next &&
            next.senderId === message.senderId &&
            Date.parse(next.createdAt) - Date.parse(message.createdAt) <
              5 * 60 * 1000;
          const showTime =
            !previous ||
            Date.parse(message.createdAt) - Date.parse(previous.createdAt) >=
              5 * 60 * 1000;
          const mine = message.senderId === user.id;
          const lastSent = mine && message.id === lastSentId;
          const values = Object.values(receipts[message.id] ?? {}).filter(
            (item) => item.userId !== user.id,
          );
          const readers = values.filter((item) => item.readAt);
          const delivered = values.filter((item) => item.deliveredAt).length;
          return (
            <Fragment key={message.id}>
              {showTime && (
                <div className="chat-time-divider">
                  <time dateTime={message.createdAt}>
                    {new Intl.DateTimeFormat('vi-VN', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hourCycle: 'h23',
                    }).format(new Date(message.createdAt))}
                  </time>
                </div>
              )}
              <div
                data-message-id={message.id}
                className={`chat-message ${mine ? 'mine' : ''}${continuesGroup ? ' continues-group' : ''}`}
              >
                <MessageActions
                  message={message}
                  mine={mine}
                  onUpdate={(updated) => accept([updated])}
                  onReply={(message) => {
                    setReplyTo(message);
                    composer.current?.focus();
                  }}
                  onReact={() => setReactionTarget(message.id)}
                />
                <MessageReactions
                  message={message}
                  revision={reactionVersions[message.id] ?? 0}
                  open={reactionTarget === message.id}
                  onClose={() => setReactionTarget(undefined)}
                  active={active}
                />
                {!mine && (
                  <span
                    className={`message-sender-avatar${continuesGroup ? ' avatar-spacer' : ''}`}
                    role={continuesGroup ? undefined : 'img'}
                    aria-hidden={continuesGroup || undefined}
                    aria-label={
                      continuesGroup ? undefined : names(message.senderId)
                    }
                    title={continuesGroup ? undefined : names(message.senderId)}
                  >
                    <Avatar
                      peer={
                        peers.find((peer) => peer.id === message.senderId) ?? {
                          displayName: names(message.senderId),
                        }
                      }
                    />
                  </span>
                )}
                <div className="message-body">
                  {message.deletedAt ? (
                    'Tin nh?n ?? thu h?i'
                  ) : message.type && message.type !== 'text' ? (
                    <MessageMedia message={message} />
                  ) : (
                    message.body
                  )}
                </div>
                {lastSent && !message.deletedAt && readers.length === 0 && (
                  <div className="message-meta">
                    <button onClick={() => void viewReceipts(message.id)}>
                      {delivered ? `Đã nhận (${delivered})` : 'Đã gửi'}
                    </button>
                  </div>
                )}
                {lastSent && !message.deletedAt && readers.length > 0 && (
                  <div className="read-avatars" aria-label="Người đã đọc">
                    {readers.map((reader) => (
                      <button
                        key={reader.userId}
                        type="button"
                        className="read-avatar"
                        title={`${names(reader.userId)} đã đọc`}
                        aria-label={`${names(reader.userId)} đã đọc. Xem trạng thái tin nhắn`}
                        onClick={() => void viewReceipts(message.id)}
                      >
                        {Array.from(names(reader.userId))[0]?.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Fragment>
          );
        })}
        {pending.map((draft) => (
          <div key={draft.clientMessageId} className="chat-message mine">
            <div className="message-body">{draft.body}</div>
            {draft.status === 'sending' ? (
              <small>Đang gửi…</small>
            ) : (
              <>
                <small className="field-error">{draft.error}</small>
                <button
                  className="retry"
                  disabled={unavailable}
                  onClick={() => void send(draft)}
                >
                  Gửi lại
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {receiptMessage && (
        <div className="receipt-panel">
          <div>
            <strong>Trạng thái tin nhắn</strong>
            <button
              className="retry"
              onClick={() => setReceiptMessage(undefined)}
            >
              Đóng
            </button>
          </div>
          {receiptLoading ? (
            <p>Đang tải…</p>
          ) : Object.values(receipts[receiptMessage] ?? {}).filter(
              (item) => item.userId !== user.id,
            ).length ? (
            <ul>
              {Object.values(receipts[receiptMessage] ?? {})
                .filter((item) => item.userId !== user.id)
                .map((item) => (
                  <li key={item.userId}>
                    {names(item.userId)} · {item.readAt ? 'Đã đọc' : 'Đã nhận'}
                  </li>
                ))}
            </ul>
          ) : (
            <p>Chưa có xác nhận nhận hoặc đọc.</p>
          )}
        </div>
      )}
      <p className="typing-note" aria-live="polite">
        {Object.entries(typing)
          .filter(([, expiry]) => expiry > Date.now())
          .map(([id]) => names(id))
          .join(', ')}
        {Object.values(typing).some((expiry) => expiry > Date.now())
          ? ' đang nhập…'
          : '\u00a0'}
      </p>
      {replyTo && (
        <div className="reply-preview">
          <div>
            <strong>Trả lời {names(replyTo.senderId)}</strong>
            <p>{messageSummary(replyTo).slice(0, 300)}</p>
          </div>
          <button
            type="button"
            className="retry"
            aria-label="Hủy trả lời"
            onClick={() => setReplyTo(undefined)}
          >
            ×
          </button>
        </div>
      )}
      <MediaTools
        disabled={unavailable || !active}
        onError={setError}
        onSend={async (media) => {
          setError('');
          await send({
            clientMessageId: crypto.randomUUID(),
            body:
              media.type === 'location'
                ? '?? V? tr?'
                : media.type === 'voice'
                  ? 'Tin nh?n tho?i'
                  : (media.file?.name ?? 'T?p'),
            media,
            status: 'sending',
          });
        }}
      />
      <form
        className="message-composer"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          ref={composer}
          aria-label="Nội dung tin nhắn"
          placeholder="Nhập tin nhắn…"
          value={body}
          disabled={unavailable}
          maxLength={10000}
          rows={1}
          onChange={(e) => {
            setBody(e.target.value);
            updateTyping(!!e.target.value.trim());
          }}
          onBlur={() => updateTyping(false)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              if (!unavailable) submit();
            }
          }}
        />
        <button
          className="secondary accept"
          disabled={unavailable || !body.trim()}
          type="submit"
          aria-label="Gửi tin nhắn"
          title="Gửi tin nhắn"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m3 3 18 9-18 9 4-9-4-9Z M7 12h14" />
          </svg>
        </button>
      </form>
      <small className="hint">Enter để gửi · Shift + Enter để xuống dòng</small>
    </div>
  );
}
