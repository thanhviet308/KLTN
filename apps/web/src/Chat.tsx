import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import * as api from './api';
import {
  mergeMessages,
  mergeReceipt,
  type Message,
  type Receipt,
  type History,
} from './chat-model';

interface Draft {
  clientMessageId: string;
  body: string;
  status: 'sending' | 'failed';
  error?: string;
}
interface Peer {
  id: string;
  displayName: string;
}
const drafts = new Map<string, { body: string; pending: Draft[] }>();
export function Chat({
  conversationId,
  user,
  peers,
  onExpired,
}: {
  conversationId: string;
  user: api.User;
  peers: Peer[];
  onExpired: () => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const draftKey = `${user.id}:${conversationId}`;
  const [pending, setPending] = useState<Draft[]>(() =>
    (drafts.get(draftKey)?.pending ?? []).map((item) => ({
      ...item,
      status: 'failed',
      error: 'Chưa xác nhận gửi. Bạn có thể gửi lại.',
    })),
  );
  const [body, setBody] = useState(() => drafts.get(draftKey)?.body ?? '');
  useEffect(() => {
    drafts.set(draftKey, { body, pending });
  }, [body, pending, draftKey]);
  const [older, setOlder] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [receipts, setReceipts] = useState<
    Record<string, Record<string, Receipt>>
  >({});
  const [receiptMessage, setReceiptMessage] = useState<string>();
  const [receiptLoading, setReceiptLoading] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const socket = useRef<Socket | undefined>(undefined);
  const latest = useRef('0');
  const messageCache = useRef<Message[]>([]);
  const started = useRef(false);
  const alive = useRef(true);
  const nearBottom = useRef(true);
  const acked = useRef(new Set<string>());
  const ackPending = useRef(new Set<string>());
  const sending = useRef(new Set<string>());
  const typingAt = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  function fail(e: unknown) {
    if (!alive.current) return;
    if (e instanceof api.ApiError && e.status === 401) onExpired();
    else {
      setError(api.errorMessage(e));
      if (e instanceof api.ApiError && e.status === 404) setUnavailable(true);
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
    } catch (e) {
      if (e instanceof api.ApiError && (e.status === 401 || e.status === 404))
        fail(e);
    } finally {
      ackPending.current.delete(key);
    }
  }
  useEffect(() => {
    alive.current = true;
    let syncing = false;
    let syncAgain = false;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let currentToken = '';
    const client = io(`${api.API_ORIGIN}/chat`, {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
    });
    socket.current = client;
    async function sync() {
      if (syncing) {
        syncAgain = true;
        return;
      }
      syncing = true;
      try {
        if (!started.current) {
          const page = await api.authenticated<History>(
            `/conversations/${conversationId}/messages?direction=backward&limit=50`,
          );
          if (stopped) return;
          accept(page.items, true);
          setOlder(page.nextCursor);
          started.current = true;
        }
        let cursor: string | null = latest.current;
        do {
          const page: History = await api.authenticated(
            `/conversations/${conversationId}/messages?direction=forward&limit=50&cursor=${cursor}`,
          );
          if (stopped) return;
          accept(page.items, true);
          cursor = page.nextCursor;
        } while (cursor);
        for (const message of messageCache.current
          .filter((item) => item.senderId === user.id)
          .slice(-10)) {
          const page = await api.authenticated<{ items: Receipt[] }>(
            `/conversations/${conversationId}/messages/${message.id}/receipts?limit=50`,
          );
          if (stopped) return;
          page.items.forEach(receipt);
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
        if (syncAgain && !stopped) {
          syncAgain = false;
          void sync();
        }
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
            void sync();
          },
        );
    });
    client.on('message:created', (message: Message) => {
      if (message.conversationId === conversationId) accept([message]);
    });
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
        schedule(reason === 'io server disconnect');
      }
    });
    client.on('connect_error', (failure) => {
      if (!stopped) {
        setConnected(false);
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
      void sync();
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
      if (document.visibilityState === 'visible') void sync();
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
      if (document.visibilityState !== 'visible' || !document.hasFocus())
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
  }, [messages]);
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
      const result = await api.authenticated<{ message: Message }>(
        `/conversations/${conversationId}/messages`,
        { clientMessageId: draft.clientMessageId, body: draft.body },
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
    if (body.length > 10000) {
      setError('Tin nhắn tối đa 10.000 ký tự.');
      return;
    }
    const draft: Draft = {
      clientMessageId: crypto.randomUUID(),
      body,
      status: 'sending',
    };
    setBody('');
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
  return (
    <div className="chat-panel">
      {!connected && !unavailable && (
        <p className="connection-note" role="status">
          Kết nối trực tiếp đang gián đoạn. Đang thử kết nối lại.
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
            <p>Gửi tin nhắn đầu tiên trong cuộc trò chuyện này.</p>
          </div>
        )}
        {messages.map((message) => {
          const mine = message.senderId === user.id;
          const values = Object.values(receipts[message.id] ?? {}).filter(
            (item) => item.userId !== user.id,
          );
          const read = values.filter((item) => item.readAt).length;
          const delivered = values.filter((item) => item.deliveredAt).length;
          return (
            <div
              key={message.id}
              data-message-id={message.id}
              className={`chat-message ${mine ? 'mine' : ''}`}
            >
              <small>{mine ? 'Bạn' : names(message.senderId)}</small>
              <div className="message-body">{message.body}</div>
              <div className="message-meta">
                <time dateTime={message.createdAt}>
                  {new Intl.DateTimeFormat('vi-VN', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }).format(new Date(message.createdAt))}
                </time>
                {mine && (
                  <button onClick={() => void viewReceipts(message.id)}>
                    {read
                      ? `Đã đọc (${read})`
                      : delivered
                        ? `Đã nhận (${delivered})`
                        : 'Đã gửi'}
                  </button>
                )}
              </div>
            </div>
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
      <form
        className="message-composer"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="Nội dung tin nhắn"
          placeholder="Nhập tin nhắn…"
          value={body}
          disabled={unavailable}
          maxLength={10000}
          rows={2}
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
        >
          Gửi →
        </button>
      </form>
      <small className="hint">Enter để gửi · Shift + Enter để xuống dòng</small>
    </div>
  );
}
