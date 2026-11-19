import { PinnedMessages } from './PinnedMessages';
import { Fragment, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { type Socket } from 'socket.io-client';
import * as api from '../../lib/api';
import { acquireChatSocket } from '../../lib/realtime';
import { UiIcon } from '../../components/UiIcon';
import { Avatar } from '../../components/Avatar';
import { MediaTools, type MediaDraft } from './ChatMedia';
import { MessageBubble, type Translation } from './MessageBubble';
import type { CallSummaryState } from './CallSummaryNote';
import { EmojiPicker } from './EmojiPicker';
import { PendingMessage } from './PendingMessage';
import { ReceiptPanel } from './ReceiptPanel';
import { ReplyPreview } from './ReplyPreview';
import { TimeDivider, UnreadDivider } from './MessageDividers';
import { TypingNote } from './TypingNote';
import {
  useAutoResizeTextarea,
  useConnectionDelayed,
  useDismissOnOutside,
} from './useComposerHelpers';
import { useTimelineScroll } from './useTimelineScroll';
import { AiAssistant } from '../ai/AiAssistant';
import {
  buildVoiceTranscribePayload,
  reduceVoiceTranscriptSuccess,
  sourceVersion,
  unreadTextMessages,
  UNREAD_SUMMARY_THRESHOLD,
  type AiKind,
  type AiTranscriptResult,
  type VoiceTranscribeOptions,
  type VoiceTranscriptState,
} from '../ai/ai-model';
import {
  cachedHistory,
  clearConversationHistoryCache,
  loadRecentHistory,
  rememberHistory,
} from '../../lib/chat-history-cache';
import {
  buildReplyDraftSummary,
  mergeMessages,
  mergeReceipt,
  type History,
  type Message,
  type Receipt,
  type ReplySummary,
} from '../../lib/chat-model';
import type { Peer } from '../../lib/types';
import type { ConversationMessageRequest } from '../conversations/types';
import { GAME_INFO, type CaroSession } from '../games/game-rules';

const CaroGame = lazy(() =>
  import('../games/CaroGame').then((m) => ({ default: m.CaroGame })),
);

interface Draft {
  clientMessageId: string;
  body: string;
  mentions?: string[];
  replyToMessageId?: string;
  replyPreview?: {
    replyTo: ReplySummary;
    label: string;
  };
  media?: MediaDraft;
  status: 'sending' | 'failed';
  error?: string;
}
const drafts = new Map<string, { body: string; pending: Draft[] }>();
interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

function normalizeMentionSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .trim();
}

function findMentionTrigger(
  text: string,
  caret: number,
): MentionTrigger | null {
  const before = text.slice(0, caret);
  const match = before.match(/(?:^|\s)@([^\s@\n]{0,40})$/);
  if (!match) return null;
  const query = match[1] ?? '';
  const start = caret - query.length - 1;
  return { start, end: caret, query };
}

export function Chat({
  conversationId,
  isGroup,
  user,
  peers,
  background = 'default',
  onExpired,
  onLatestMessage,
  active = true,
  onReadSequence,
  onMessagesChange,
  initialLastReadSequence,
  initialUnreadCount = 0,
  jumpTarget,
  messageRequest,
  onAcceptMessageRequest,
  onRejectMessageRequest,
  requestActionBusy = false,
}: {
  conversationId: string;
  isGroup?: boolean;
  user: api.User;
  peers: Peer[];
  background?: string;
  onExpired: () => void;
  onLatestMessage?: (message: Message) => void;
  active?: boolean;
  onReadSequence?: (sequence: string) => void;
  onMessagesChange?: (messages: Message[]) => void;
  initialLastReadSequence?: string | null;
  initialUnreadCount?: number;
  jumpTarget?: { conversationId: string; messageId: string; token: number };
  messageRequest?: ConversationMessageRequest | null;
  onAcceptMessageRequest?: () => void;
  onRejectMessageRequest?: () => void;
  requestActionBusy?: boolean;
}) {
  const [mentions, setMentions] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<MentionTrigger | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const draftKey = `${user.id}:${conversationId}`;
  const [cached] = useState(() => cachedHistory(draftKey));
  const [messages, setMessages] = useState<Message[]>(cached?.messages ?? []);
  const [pins, setPins] = useState<Message[]>([]);
  const pinRefresh = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    async function refresh() {
      const current = ++revision;
      try {
        const result = await api.authenticated<{ items: Message[] }>(
          `/conversations/${conversationId}/pins`,
        );
        if (!disposed && current === revision) setPins(result.items);
      } catch {
        /* Reconnect/focus retries without interrupting chat. */
      }
    }
    pinRefresh.current = () => {
      void refresh();
    };
    const changed = (e: Event) => {
      if ((e as CustomEvent).detail === conversationId) void refresh();
    };
    void refresh();
    window.addEventListener('chat:pins', changed);
    window.addEventListener('focus', pinRefresh.current);
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    const focus = pinRefresh.current;
    return () => {
      disposed = true;
      clearInterval(timer);
      window.removeEventListener('chat:pins', changed);
      window.removeEventListener('focus', focus);
    };
  }, [conversationId]);
  async function unpin(message: Message) {
    try {
      await api.authenticated(
        `/conversations/${conversationId}/pins/${message.id}`,
        undefined,
        'DELETE',
      );
      pinRefresh.current();
    } catch (e) {
      fail(e);
    }
  }
  const [ai, setAi] = useState<{
    kind: AiKind;
    targetId?: string;
    selectedIds?: string[];
    quickStart?: boolean;
  }>();
  const unreadBoundary = useRef(initialLastReadSequence ?? '0');
  const unreadCount = useRef(initialUnreadCount);
  const [translations, setTranslations] = useState<Record<string, Translation>>(
    {},
  );
  const [voiceTranscripts, setVoiceTranscripts] = useState<
    Record<string, VoiceTranscriptState>
  >({});
  const [callSummaries, setCallSummaries] = useState<
    Record<string, CallSummaryState>
  >({});
  const voiceConversation = useRef(conversationId);
  voiceConversation.current = conversationId;
  const voicePending = useRef(new Set<string>());
  const callSummaryPending = useRef(new Set<string>());
  useEffect(() => {
    setAi(undefined);
    setTranslations({});
    setVoiceTranscripts({});
    setCallSummaries({});
    voicePending.current.clear();
    callSummaryPending.current.clear();
  }, [conversationId]);
  async function summarizeCallMessage(target: Message) {
    const callId = target.content?.callId;
    if (
      target.type !== 'call' ||
      target.deletedAt ||
      !callId ||
      !target.content?.summaryAvailable
    )
      return;
    if (callSummaryPending.current.has(target.id)) return;
    callSummaryPending.current.add(target.id);
    const activeConversation = conversationId;
    setCallSummaries((previous) => ({
      ...previous,
      [target.id]: {
        ...previous[target.id],
        loading: true,
        error: undefined,
      },
    }));
    try {
      const response = await api.authenticated<{
        callId: string;
        result: { summary: string; decisions: string[]; tasks: string[] };
      }>(`/calls/${callId}/summary`, {}, 'POST');
      if (!alive.current || voiceConversation.current !== activeConversation)
        return;
      setCallSummaries((previous) => ({
        ...previous,
        [target.id]: {
          loading: false,
          summary: response.result.summary,
          decisions: response.result.decisions,
          tasks: response.result.tasks,
        },
      }));
    } catch (e) {
      if (!alive.current || voiceConversation.current !== activeConversation)
        return;
      if (e instanceof api.ApiError && e.status === 401) {
        onExpired();
        return;
      }
      setCallSummaries((previous) => ({
        ...previous,
        [target.id]: {
          ...previous[target.id],
          loading: false,
          error: api.errorMessage(e),
        },
      }));
    } finally {
      callSummaryPending.current.delete(target.id);
    }
  }
  async function transcribeVoice(
    target: Message,
    options?: VoiceTranscribeOptions,
  ) {
    if (target.type !== 'voice' || target.deletedAt) return;
    if (voicePending.current.has(target.id)) return;
    voicePending.current.add(target.id);
    const activeConversation = conversationId;
    setVoiceTranscripts((previous) => ({
      ...previous,
      [target.id]: {
        ...previous[target.id],
        loading: true,
        error: undefined,
      },
    }));
    try {
      const response = await api.authenticated<{
        messageId: string;
        result: AiTranscriptResult;
      }>(
        `/conversations/${activeConversation}/messages/${target.id}/transcribe`,
        buildVoiceTranscribePayload(options),
        'POST',
      );
      if (!alive.current || voiceConversation.current !== activeConversation) {
        return;
      }
      setVoiceTranscripts((previous) => ({
        ...previous,
        [target.id]: reduceVoiceTranscriptSuccess(
          previous[target.id],
          response.result,
          options,
        ),
      }));
    } catch (e) {
      if (!alive.current || voiceConversation.current !== activeConversation) {
        return;
      }
      if (e instanceof api.ApiError && e.status === 401) {
        onExpired();
        return;
      }
      setVoiceTranscripts((previous) => ({
        ...previous,
        [target.id]: {
          ...previous[target.id],
          loading: false,
          error: api.errorMessage(e),
        },
      }));
    } finally {
      voicePending.current.delete(target.id);
    }
  }
  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);
  const [pending, setPending] = useState<Draft[]>(() =>
    (drafts.get(draftKey)?.pending ?? []).map((item) => ({
      ...item,
      status: 'failed',
      error: 'Chưa xác nhận gửi. Bạn có thể gửi lại.',
    })),
  );
  const [body, setBody] = useState(() => drafts.get(draftKey)?.body ?? '');
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [currentGame, setCurrentGame] = useState<CaroSession | null>(null);
  useEffect(() => {
    let activeFetch = true;
    setCurrentGame(null);
    setGameOpen(false);
    void api
      .authenticated<{ game: CaroSession | null }>(
        `/conversations/${conversationId}/games/current`,
      )
      .then((res) => {
        if (activeFetch) setCurrentGame(res.game);
      })
      .catch(() => {});
    return () => {
      activeFetch = false;
    };
  }, [conversationId]);
  useDismissOnOutside(
    emojiOpen,
    () => setEmojiOpen(false),
    '.composer-emoji, .composer-emoji-picker',
  );
  const [replyTo, setReplyTo] = useState<Message>();
  const [reactionTarget, setReactionTarget] = useState<string>();
  const [reactionVersions, setReactionVersions] = useState<
    Record<string, number>
  >({});
  const composer = useAutoResizeTextarea(body);
  useEffect(() => {
    drafts.set(draftKey, { body, pending });
  }, [body, pending, draftKey]);
  const [older, setOlder] = useState<string | null>(cached?.older ?? null);
  const olderRef = useRef<string | null>(cached?.older ?? null);
  const updateOlder = (next: string | null) => {
    olderRef.current = next;
    setOlder(next);
  };
  const [loading, setLoading] = useState(!cached);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [connectionCode, setConnectionCode] = useState('');
  const connectionDelayed = useConnectionDelayed(connected);
  const [unavailable, setUnavailable] = useState(false);
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [receipts, setReceipts] = useState<
    Record<string, Record<string, Receipt>>
  >(cached?.receipts ?? {});
  const [receiptMessage, setReceiptMessage] = useState<string>();
  const [receiptLoading, setReceiptLoading] = useState(false);
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
  const acked = useRef(new Set<string>());
  const ackPending = useRef(new Set<string>());
  // After a 429, pause receipts instead of retrying on every render.
  const ackBlockedUntil = useRef(0);
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
    if (e instanceof api.ApiError && e.code === 'SESSION_CHANGED') return;
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
    if (BigInt(message.sequence) <= BigInt(initialLastReadSequence ?? '0'))
      return;
    const key = `${message.id}:${read ? 'read' : 'delivered'}`;
    if (
      Date.now() < ackBlockedUntil.current ||
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
      if (e instanceof api.ApiError && e.status === 429) {
        ackBlockedUntil.current = Date.now() + 15000;
        return;
      }
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
    let subscribeRetry: ReturnType<typeof setTimeout> | undefined;
    let syncRetry: ReturnType<typeof setTimeout> | undefined;
    let transientSyncError = false;
    let lastSyncAt = 0;
    const hub = acquireChatSocket(user.id);
    const client = hub.socket;
    socket.current = client;
    setConnected(false);
    setConnectionCode(client.connected ? '' : hub.getLastErrorCode());
    const onAccountVisibility = ({
      userId,
      status,
    }: {
      userId: string;
      status: string;
    }) => {
      if (stopped) return;
      if (status === 'blocked') {
        messageCache.current = messageCache.current.filter(
          (m) => m.senderId !== userId,
        );
        setMessages((old) => old.filter((m) => m.senderId !== userId));
        setReplyTo((old) => (old?.senderId === userId ? undefined : old));
      }
    };
    async function sync() {
      if (syncing || Date.now() - lastSyncAt < 2000) {
        return;
      }
      syncing = true;
      if (syncRetry) {
        clearTimeout(syncRetry);
        syncRetry = undefined;
      }
      const initial = !started.current;
      try {
        if (!started.current) {
          const page = await loadRecentHistory(draftKey, () =>
            api.authenticated<History>(
              `/conversations/${conversationId}/messages?direction=backward&limit=50`,
            ),
          );
          if (stopped) return;
          messageCache.current = [];
          accept(page.items, true);
          updateOlder(page.nextCursor);
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
            if (e instanceof api.ApiError && e.status === 401) throw e;
          }
        }
        lastSyncAt = Date.now();
        if (!stopped) {
          transientSyncError = false;
          setLoading(false);
          setError('');
        }
      } catch (e) {
        if (!stopped) {
          setLoading(false);
          const isTransient =
            e instanceof api.ApiError && (e.status === 0 || e.status >= 500);
          if (!initial && messageCache.current.length > 0 && isTransient) {
            // Messages are already visible; retry silently instead of pinning
            // a sticky outage banner on brief wake/keep-alive hiccups.
            transientSyncError = true;
            syncRetry = setTimeout(() => {
              syncRetry = undefined;
              if (!stopped) void sync();
            }, 3000);
          } else {
            if (isTransient) transientSyncError = true;
            fail(e);
          }
        }
      } finally {
        syncing = false;
      }
    }
    function scheduleSubscribeRetry() {
      if (stopped || subscribeRetry) return;
      subscribeRetry = setTimeout(() => {
        subscribeRetry = undefined;
        if (!stopped && client.connected) subscribeConversation();
      }, 3000);
    }
    function subscribeConversation() {
      if (stopped || !client.connected) return;
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
              } else scheduleSubscribeRetry();
              return;
            }
            if (subscribeRetry) {
              clearTimeout(subscribeRetry);
              subscribeRetry = undefined;
            }
            setConnected(true);
            setConnectionCode('');
            void sync();
          },
        );
    }
    const onConnect = () => {
      pinRefresh.current();
      subscribeConversation();
    };
    const onMessageCreated = (message: Message) => {
      if (message.conversationId === conversationId) {
        accept([message]);
        pinRefresh.current();
      }
    };
    const onMessageReactions = (event: {
      conversationId: string;
      messageId: string;
    }) => {
      if (event.conversationId === conversationId && alive.current)
        setReactionVersions((previous) => ({
          ...previous,
          [event.messageId]: (previous[event.messageId] ?? 0) + 1,
        }));
    };
    const onConversationPins = (event: { conversationId: string }) => {
      if (event.conversationId === conversationId) pinRefresh.current();
    };
    const onMessageMutated = (message: Message) => {
      if (message.conversationId === conversationId) {
        accept([message]);
        pinRefresh.current();
      }
    };
    const onMessageReceipt = (event: {
      conversationId: string;
      receipt: Receipt;
    }) => {
      if (event.conversationId === conversationId) receipt(event.receipt);
    };
    const onTypingUpdate = (event: {
      conversationId: string;
      userId: string;
      typing: boolean;
      expiresAt: string;
    }) => {
      if (
        event.conversationId !== conversationId ||
        event.userId === user.id ||
        !alive.current
      )
        return;
      setTyping((previous) => {
        if (!event.typing) {
          if (!(event.userId in previous)) return previous;
          const next = { ...previous };
          delete next[event.userId];
          return next;
        }
        return {
          ...previous,
          [event.userId]: Date.parse(event.expiresAt),
        };
      });
    };
    const onGameUpdated = (result: { game: CaroSession }) => {
      if (result.game.conversationId === conversationId && alive.current) {
        setCurrentGame(result.game);
        if (result.game.status === 'invited' && result.game.oUserId === user.id)
          setGameOpen(true);
      }
    };
    const onSyncRequired = () => {
      void sync();
    };
    const applyClearedHistory = (clearedAfterSequence: string) => {
      if (stopped || !alive.current) return;
      const cutoff = BigInt(clearedAfterSequence || '0');
      if (cutoff > BigInt(latest.current))
        latest.current = clearedAfterSequence;
      started.current = true;
      messageCache.current = messageCache.current.filter(
        (item) => BigInt(item.sequence) > cutoff,
      );
      setMessages(messageCache.current);
      updateOlder(null);
      setPins([]);
      setReplyTo(undefined);
      setTranslations({});
      setVoiceTranscripts({});
      setCallSummaries({});
      setReceipts({});
      unreadCount.current = 0;
      clearConversationHistoryCache(draftKey);
      pinRefresh.current();
    };
    const onHistoryCleared = (event: {
      conversationId: string;
      clearedAfterSequence: string;
    }) => {
      if (event.conversationId === conversationId)
        applyClearedHistory(event.clearedAfterSequence);
    };
    const onLocalHistoryCleared = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          conversationId?: string;
          clearedAfterSequence?: string;
        }>
      ).detail;
      if (detail?.conversationId === conversationId)
        applyClearedHistory(detail.clearedAfterSequence ?? '0');
    };
    const onDisconnect = () => {
      if (!stopped) setConnected(false);
    };
    client.on('account:visibility', onAccountVisibility);
    client.on('connect', onConnect);
    client.on('message:created', onMessageCreated);
    client.on('message:reactions', onMessageReactions);
    client.on('conversation:pins', onConversationPins);
    client.on('conversation:history-cleared', onHistoryCleared);
    client.on('message:updated', onMessageMutated);
    client.on('message:deleted', onMessageMutated);
    client.on('message:receipt', onMessageReceipt);
    client.on('typing:update', onTypingUpdate);
    client.on('game:updated', onGameUpdated);
    client.on('sync:required', onSyncRequired);
    client.on('disconnect', onDisconnect);
    window.addEventListener('chat:history-cleared', onLocalHistoryCleared);
    const unsubscribeError = hub.subscribeError((code) => {
      if (stopped) return;
      setConnected(false);
      setConnectionCode(code);
    });
    void sync();
    if (client.connected) onConnect();
    const typingExpiry = setInterval(() => {
      const now = Date.now();
      setTyping((previous) =>
        Object.values(previous).some((expiry) => expiry <= now)
          ? Object.fromEntries(
              Object.entries(previous).filter(([, expiry]) => expiry > now),
            )
          : previous,
      );
    }, 1000);
    const interval = setInterval(() => {
      if (!client.connected || transientSyncError) void sync();
    }, 15000);
    const onResume = () => {
      if (document.visibilityState !== 'visible') return;
      if (!client.connected) {
        hub.reconnectNow();
        void sync();
      } else if (transientSyncError) {
        void sync();
      }
    };
    const onOnline = () => {
      if (!client.connected) {
        hub.reconnectNow();
        void sync();
      } else if (transientSyncError) {
        void sync();
      }
    };
    window.addEventListener('focus', onResume);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onResume);
    return () => {
      stopped = true;
      alive.current = false;
      clearInterval(interval);
      clearInterval(typingExpiry);
      if (subscribeRetry) clearTimeout(subscribeRetry);
      if (syncRetry) clearTimeout(syncRetry);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (client.connected)
        client.emit('typing:update', { conversationId, typing: false });
      client.off('account:visibility', onAccountVisibility);
      client.off('connect', onConnect);
      client.off('message:created', onMessageCreated);
      client.off('message:reactions', onMessageReactions);
      client.off('conversation:pins', onConversationPins);
      client.off('conversation:history-cleared', onHistoryCleared);
      client.off('message:updated', onMessageMutated);
      client.off('message:deleted', onMessageMutated);
      client.off('message:receipt', onMessageReceipt);
      client.off('typing:update', onTypingUpdate);
      client.off('game:updated', onGameUpdated);
      client.off('sync:required', onSyncRequired);
      client.off('disconnect', onDisconnect);
      window.removeEventListener('chat:history-cleared', onLocalHistoryCleared);
      unsubscribeError();
      if (socket.current === client) socket.current = undefined;
      hub.release();
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [conversationId, user.id]);
  const renderNow = Date.now();
  const activeTypingIds = Object.entries(typing)
    .filter(([, expiry]) => expiry > renderNow)
    .map(([id]) => id)
    .sort();
  const typingDependency = activeTypingIds.join(',');
  const singleTyperId =
    activeTypingIds.length === 1 ? activeTypingIds[0] : undefined;
  const {
    list,
    nearBottom,
    cancelAutoFollow,
    handlers: timelineHandlers,
  } = useTimelineScroll({
    active,
    conversationId,
    loading,
    dependencies: [messages, pending, typingDependency],
  });
  const handledJumpToken = useRef(0);
  async function jumpToMessage(
    messageId: string,
    notFoundMessage = 'Không tìm thấy tin nhắn gốc.',
  ) {
    try {
      setError('');
      cancelAutoFollow();
      let cursor = olderRef.current;
      while (!messageCache.current.some((m) => m.id === messageId) && cursor) {
        const page = await api.authenticated<History>(
          `/conversations/${conversationId}/messages?direction=backward&limit=50&cursor=${cursor}`,
        );
        if (!alive.current) return;
        accept(page.items);
        updateOlder(page.nextCursor);
        if (page.nextCursor === cursor) break;
        cursor = page.nextCursor;
      }
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      if (!alive.current) return;
      cancelAutoFollow();
      const selectorId =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(messageId)
          : messageId;
      const element = list.current?.querySelector<HTMLElement>(
        `[data-message-id="${selectorId}"]`,
      );
      if (!element) {
        setError(notFoundMessage);
        return;
      }
      element.scrollIntoView({ block: 'center', behavior: 'smooth' });
      element.classList.remove('pin-highlight');
      void element.offsetWidth;
      element.classList.add('pin-highlight');
      window.setTimeout(() => element.classList.remove('pin-highlight'), 2500);
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    if (
      !jumpTarget ||
      jumpTarget.conversationId !== conversationId ||
      loading ||
      handledJumpToken.current === jumpTarget.token
    )
      return;
    handledJumpToken.current = jumpTarget.token;
    cancelAutoFollow();
    void jumpToMessage(jumpTarget.messageId);
    // jumpToMessage reads refs for live timeline state once loading settles.
  }, [jumpTarget, loading, conversationId]);
  function jumpToPin(target: Message) {
    return jumpToMessage(target.id, 'Không tìm thấy tin nhắn đã ghim.');
  }
  const incomingRequestPending =
    !isGroup &&
    messageRequest?.direction === 'incoming' &&
    messageRequest.status === 'pending';
  const outgoingRequestPending =
    !isGroup &&
    messageRequest?.direction === 'outgoing' &&
    messageRequest.status === 'pending';
  const directPeerName =
    peers.find((peer) => peer.id !== user.id)?.displayName ?? 'người dùng này';

  useEffect(() => {
    const container = list.current;
    if (!container || incomingRequestPending) return;
    function markVisible() {
      if (
        !active ||
        document.visibilityState !== 'visible' ||
        !document.hasFocus()
      )
        return;
      const bounds = container!.getBoundingClientRect();
      const visible: Message[] = [];
      for (const element of container!.querySelectorAll<HTMLElement>(
        '[data-message-id]',
      )) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom > bounds.top && rect.top < bounds.bottom) {
          const message = messages.find(
            (item) => item.id === element.dataset.messageId,
          );
          if (message) visible.push(message);
        }
      }
      for (const message of visible) void acknowledge(message, true);
    }
    markVisible();
    // A read receipt already includes delivery; do not queue both on open.
    // Each receipt is per message on the server, so pace rather than drop them.
    function markDelivered() {
      for (const message of messages)
        if (!ackPending.current.has(`${message.id}:read`))
          void acknowledge(message, false);
    }
    markDelivered();
    const retry = setInterval(() => {
      markVisible();
      markDelivered();
    }, 15000);
    container.addEventListener('scroll', markVisible);
    window.addEventListener('focus', markVisible);
    document.addEventListener('visibilitychange', markVisible);
    return () => {
      clearInterval(retry);
      container.removeEventListener('scroll', markVisible);
      window.removeEventListener('focus', markVisible);
      document.removeEventListener('visibilitychange', markVisible);
    };
  }, [messages, active, incomingRequestPending]);
  async function loadOlder() {
    if (!older || loadingOlder) return;
    setLoadingOlder(true);
    setError('');
    const container = list.current;
    const height = container?.scrollHeight ?? 0;
    const top = container?.scrollTop ?? 0;
    cancelAutoFollow();
    try {
      const page = await api.authenticated<History>(
        `/conversations/${conversationId}/messages?direction=backward&limit=50&cursor=${older}`,
      );
      accept(page.items);
      if (alive.current) updateOlder(page.nextCursor);
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
            draft.media.durationSeconds,
          )
        : await api.authenticated<{ message: Message }>(
            `/conversations/${conversationId}/messages`,
            draft.media?.type === 'location'
              ? {
                  clientMessageId: draft.clientMessageId,
                  type: 'location',
                  location: draft.media.location,
                }
              : {
                  clientMessageId: draft.clientMessageId,
                  body: draft.body,
                  mentions: draft.mentions,
                  ...(draft.replyToMessageId
                    ? { replyToMessageId: draft.replyToMessageId }
                    : {}),
                },
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
    const original = replyTo
      ? (messageCache.current.find((message) => message.id === replyTo.id) ??
        replyTo)
      : undefined;
    const replyPreview = original
      ? {
          replyTo: buildReplyDraftSummary(original),
          label:
            original.senderId === user.id
              ? 'Bạn đã trả lời chính mình'
              : `Bạn đã trả lời ${names(original.senderId)}`,
        }
      : undefined;
    const draft: Draft = {
      clientMessageId: crypto.randomUUID(),
      body,
      mentions: mentions.filter((id) => body.includes(`@${names(id)}`)),
      replyToMessageId: original?.id,
      replyPreview,
      status: 'sending',
    };
    setBody('');
    setMentions([]);
    setMentionQuery(null);
    setReplyTo(undefined);
    setError('');
    updateTyping(false);
    void send(draft);
  }
  const mentionCandidates =
    isGroup && mentionQuery && !unavailable
      ? peers
          .filter((peer) => peer.id !== user.id)
          .filter((peer) => {
            if (!mentionQuery.query) return true;
            const needle = normalizeMentionSearch(mentionQuery.query);
            return (
              normalizeMentionSearch(names(peer.id)).includes(needle) ||
              normalizeMentionSearch(peer.displayName).includes(needle)
            );
          })
          .slice(0, 8)
      : [];
  function syncMentionQuery(nextBody: string, caret: number) {
    if (!isGroup || unavailable) {
      setMentionQuery(null);
      return;
    }
    const trigger = findMentionTrigger(nextBody, caret);
    setMentionQuery(trigger);
    setMentionIndex(0);
  }
  function pickMention(peer: Peer) {
    if (!mentionQuery) return;
    const label = names(peer.id);
    const insertion = `@${label} `;
    const nextBody =
      body.slice(0, mentionQuery.start) +
      insertion +
      body.slice(mentionQuery.end);
    const nextCaret = mentionQuery.start + insertion.length;
    setMentions((old) => [...new Set([...old, peer.id])].slice(0, 20));
    setBody(nextBody);
    setMentionQuery(null);
    setMentionIndex(0);
    updateTyping(!!nextBody.trim());
    requestAnimationFrame(() => {
      const el = composer.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }
  function updateTyping(value: boolean) {
    if (incomingRequestPending && value) return;
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
  const deletedMessageIds = new Set(
    messages.filter((item) => !!item.deletedAt).map((item) => item.id),
  );
  const lastSentId = pending.length
    ? undefined
    : [...messages].reverse().find((message) => message.senderId === user.id)
        ?.id;
  const unreadTexts = unreadTextMessages(
    messages,
    user.id,
    unreadBoundary.current,
  );
  const firstUnreadId = messages.find(
    (message) =>
      message.senderId !== user.id &&
      BigInt(message.sequence) > BigInt(unreadBoundary.current),
  )?.id;
  const canSummarizeUnread = unreadTexts.length >= UNREAD_SUMMARY_THRESHOLD;
  return (
    <div className="chat-panel">
      {gameOpen && active && (
        <Suspense fallback={null}>
          <CaroGame
            conversationId={conversationId}
            userId={user.id}
            names={names}
            socket={socket.current}
            isGroup={
              isGroup ?? peers.filter((peer) => peer.id !== user.id).length > 1
            }
            onGameChange={setCurrentGame}
            onClose={() => setGameOpen(false)}
          />
        </Suspense>
      )}
      {!gameOpen &&
        currentGame &&
        (currentGame.status === 'invited' ||
          currentGame.status === 'active') && (
          <div className="game-live-banner" role="status">
            <div className="game-live-banner-info">
              <span className="game-live-dot" aria-hidden="true" />
              <div>
                <strong>
                  {GAME_INFO[currentGame.gameType]?.name ?? 'Trò chơi'}
                </strong>
                <span>
                  {currentGame.status === 'invited'
                    ? GAME_INFO[currentGame.gameType]?.groupOnly
                      ? currentGame.xUserId === user.id
                        ? 'Đang chờ các thành viên trong nhóm tham gia…'
                        : `${names(currentGame.xUserId)} vừa mở phòng chơi nhóm!`
                      : currentGame.oUserId === user.id
                        ? `${names(currentGame.xUserId)} đang mời bạn vào bàn`
                        : `Đang chờ ${names(currentGame.oUserId)} tham gia…`
                    : (currentGame.xUserId === user.id ? 'X' : 'O') ===
                        currentGame.turn
                      ? 'Đến lượt của bạn đi!'
                      : `Lượt của ${names(
                          currentGame.xUserId === user.id
                            ? currentGame.oUserId
                            : currentGame.xUserId,
                        )}`}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="game-live-banner-btn"
              onClick={() => setGameOpen(true)}
            >
              {currentGame.status === 'invited' &&
              currentGame.xUserId !== user.id
                ? 'Tham gia ngay'
                : 'Mở bàn chơi'}
            </button>
          </div>
        )}
      {ai && active && (
        <AiAssistant
          key={`${conversationId}:${ai.kind}:${ai.targetId ?? ''}`}
          conversationId={conversationId}
          messages={messages}
          kind={ai.kind}
          targetId={ai.targetId}
          initialSelectedIds={ai.selectedIds}
          quickStart={ai.quickStart}
          names={names}
          onClose={() => setAi(undefined)}
          loadingOlder={loadingOlder}
          onLoadOlder={
            older
              ? () => {
                  void loadOlder();
                }
              : undefined
          }
          onTranslation={(message, text, language) =>
            setTranslations((previous) => ({
              ...previous,
              [message.id]: { text, language, version: sourceVersion(message) },
            }))
          }
          onDraft={(text) => {
            setBody((previous) =>
              previous.trim() ? `${previous}\n${text}` : text,
            );
            const target = messages.find((item) => item.id === ai.targetId);
            if (target) setReplyTo(target);
            setAi(undefined);
            setTimeout(() => composer.current?.focus(), 0);
          }}
        />
      )}
      {!connected && connectionDelayed && !unavailable && (
        <p className="connection-note" role="status">
          {connectionCode === 'ORIGIN_FORBIDDEN'
            ? 'Kết nối realtime bị từ chối. Kiểm tra WEB_ORIGIN của backend khớp địa chỉ đang mở.'
            : connectionCode === 'CONNECTION_LIMIT'
              ? 'Bạn đang mở quá nhiều phiên chat cùng lúc. Đóng bớt tab cũ để bật lại realtime; tin mới vẫn tự cập nhật định kỳ.'
              : 'Chưa kết nối realtime. Bạn vẫn có thể gửi tin; tin mới đang được cập nhật định kỳ.'}
        </p>
      )}
      {error && (
        <div className="message error chat-inline-error" role="alert">
          <span>{error}</span>
          {!unavailable && (
            <button
              type="button"
              className="retry chat-error-close"
              aria-label="Đóng thông báo lỗi"
              onClick={() => setError('')}
            >
              ×
            </button>
          )}
        </div>
      )}
      <PinnedMessages
        pins={pins}
        names={names}
        onJump={jumpToPin}
        onUnpin={unpin}
      />
      <div
        className="message-timeline"
        data-chat-background={background}
        ref={list}
        {...timelineHandlers}
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
        {outgoingRequestPending && (
          <div className="chat-request-context-note" role="note">
            Hai bạn chưa kết bạn trên PingPong · Bạn có thể gửi nhiều tin nhắn;
            cuộc trò chuyện đang nằm trong mục <strong>Tin nhắn chờ</strong> của{' '}
            {directPeerName} cho đến khi họ chấp nhận hoặc trả lời.
          </div>
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
          const continuesWithTyping =
            !next &&
            pending.length === 0 &&
            message.type !== 'call' &&
            !!singleTyperId &&
            singleTyperId === message.senderId &&
            renderNow - Date.parse(message.createdAt) < 5 * 60 * 1000;
          const continuesGroup =
            continuesWithTyping ||
            (!!next &&
              next.senderId === message.senderId &&
              Date.parse(next.createdAt) - Date.parse(message.createdAt) <
                5 * 60 * 1000);
          const showTime =
            !previous ||
            Date.parse(message.createdAt) - Date.parse(previous.createdAt) >=
              5 * 60 * 1000;
          const mine = message.senderId === user.id;
          const showSenderName =
            !!isGroup &&
            !mine &&
            message.type !== 'call' &&
            (!previous ||
              previous.senderId !== message.senderId ||
              previous.type === 'call' ||
              showTime);
          const lastSent = mine && message.id === lastSentId;
          const values = Object.values(receipts[message.id] ?? {}).filter(
            (item) => item.userId !== user.id,
          );
          const readers = values.filter((item) => item.readAt);
          const delivered = values.filter((item) => item.deliveredAt).length;
          const isFirstUnread = message.id === firstUnreadId;
          return (
            <Fragment key={message.id}>
              {showTime && !isFirstUnread && (
                <TimeDivider createdAt={message.createdAt} />
              )}
              {isFirstUnread && unreadCount.current > 0 && (
                <UnreadDivider
                  count={unreadCount.current}
                  onSummarize={
                    canSummarizeUnread
                      ? () =>
                          setAi({
                            kind: 'summary',
                            selectedIds: unreadTexts.map((item) => item.id),
                            quickStart: true,
                          })
                      : undefined
                  }
                />
              )}
              <MessageBubble
                message={message}
                mine={mine}
                currentUserId={user.id}
                isGroup={isGroup}
                showSenderName={showSenderName}
                pinned={pins.some((pin) => pin.id === message.id)}
                continuesGroup={continuesGroup}
                replyTargetDeleted={
                  !!message.content?.replyTo?.messageId &&
                  deletedMessageIds.has(message.content.replyTo.messageId)
                }
                onJumpToMessage={(messageId) => void jumpToMessage(messageId)}
                peers={peers}
                names={names}
                active={active}
                realtimeConnected={connected}
                reactionRevision={reactionVersions[message.id] ?? 0}
                reactionOpen={reactionTarget === message.id}
                translation={translations[message.id]}
                showStatus={
                  lastSent ||
                  (!!isGroup &&
                    message.senderId === user.id &&
                    readers.length > 0)
                }
                readers={readers}
                delivered={delivered}
                onUpdate={(updated) => accept([updated])}
                onReply={(target) => {
                  setReplyTo(target);
                  composer.current?.focus();
                }}
                onReact={() => setReactionTarget(message.id)}
                onCloseReactions={() => setReactionTarget(undefined)}
                onAi={(kind) => setAi({ kind, targetId: message.id })}
                onHideTranslation={() =>
                  setTranslations((previous) => {
                    const rest = { ...previous };
                    delete rest[message.id];
                    return rest;
                  })
                }
                voiceTranscript={voiceTranscripts[message.id]}
                onTranscribeVoice={(options) =>
                  void transcribeVoice(message, options)
                }
                onHideVoiceTranscript={() =>
                  setVoiceTranscripts((previous) => {
                    const rest = { ...previous };
                    delete rest[message.id];
                    return rest;
                  })
                }
                onUseVoiceReply={(reply) => {
                  setReplyTo(message);
                  setBody(reply);
                  composer.current?.focus();
                }}
                callSummary={callSummaries[message.id]}
                onSummarizeCall={() => void summarizeCallMessage(message)}
                onHideCallSummary={() =>
                  setCallSummaries((previous) => {
                    const rest = { ...previous };
                    delete rest[message.id];
                    return rest;
                  })
                }
                onOpenReceipts={() => void viewReceipts(message.id)}
                currentGame={currentGame}
                onOpenGame={() => setGameOpen(true)}
                onAcceptGame={(gameId) => {
                  setGameOpen(true);
                  void api
                    .authenticated<{ game: CaroSession }>(
                      `/games/${gameId}/accept`,
                      undefined,
                      'POST',
                    )
                    .then((res) => setCurrentGame(res.game))
                    .catch((e) => setError(api.errorMessage(e)));
                }}
              />
            </Fragment>
          );
        })}
        {pending.map((draft) => (
          <PendingMessage
            key={draft.clientMessageId}
            body={draft.body}
            replyTo={draft.replyPreview?.replyTo}
            replyLabel={draft.replyPreview?.label}
            status={draft.status}
            error={draft.error}
            retryDisabled={unavailable}
            onRetry={() => void send(draft)}
          />
        ))}
        <TypingNote
          typing={typing}
          names={names}
          peers={peers}
          isGroup={isGroup}
        />
      </div>
      {receiptMessage && (
        <ReceiptPanel
          receipts={receipts[receiptMessage]}
          loading={receiptLoading}
          currentUserId={user.id}
          names={names}
          onClose={() => setReceiptMessage(undefined)}
        />
      )}
      {incomingRequestPending && (
        <div
          className="chat-request-banner"
          role="region"
          aria-label="Tùy chọn tin nhắn chờ"
        >
          <div className="chat-request-banner-copy">
            <strong>{directPeerName} muốn gửi tin nhắn cho bạn</strong>
            <p>
              Hai bạn chưa kết bạn trên PingPong. Chấp nhận hoặc trả lời trực
              tiếp bên dưới để chuyển đoạn chat về mục <strong>Tất cả</strong>.
              Họ sẽ không biết bạn đã xem cho đến khi bạn phản hồi.
            </p>
          </div>
          <div className="chat-request-banner-actions">
            {onAcceptMessageRequest && (
              <button
                type="button"
                className="secondary accept"
                disabled={requestActionBusy}
                onClick={onAcceptMessageRequest}
              >
                Chấp nhận
              </button>
            )}
            {onRejectMessageRequest && (
              <button
                type="button"
                className="secondary"
                disabled={requestActionBusy}
                onClick={onRejectMessageRequest}
              >
                Xóa tin nhắn chờ
              </button>
            )}
          </div>
        </div>
      )}
      {replyTo && (
        <ReplyPreview
          message={replyTo}
          senderName={names(replyTo.senderId)}
          onCancel={() => setReplyTo(undefined)}
        />
      )}
      <div className={`chat-composer-bar${body.trim() ? ' has-draft' : ''}`}>
        <MediaTools
          disabled={unavailable || !active}
          hasOpenGame={
            !!currentGame &&
            (currentGame.status === 'invited' ||
              currentGame.status === 'active')
          }
          onOpenGame={() => setGameOpen(true)}
          onError={setError}
          onSend={async (media) => {
            setError('');
            await send({
              clientMessageId: crypto.randomUUID(),
              body:
                media.type === 'location'
                  ? '📍 Vị trí'
                  : media.type === 'voice'
                    ? 'Tin nhắn thoại'
                    : (media.file?.name ?? 'Tệp'),
              media,
              status: 'sending',
            });
          }}
        />
        {mentionCandidates.length > 0 && (
          <div
            className="mention-suggestions"
            role="listbox"
            aria-label="Gợi ý nhắc đến thành viên"
          >
            <div className="mention-suggestions-header">
              Nhắc đến thành viên
            </div>
            {mentionCandidates.map((peer, index) => {
              const display = names(peer.id);
              const activeOption = index === mentionIndex;
              return (
                <button
                  key={peer.id}
                  type="button"
                  role="option"
                  aria-selected={activeOption}
                  className={`mention-suggestion-item${activeOption ? ' is-active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setMentionIndex(index)}
                  onClick={() => pickMention(peer)}
                >
                  <span className="mention-suggestion-avatar">
                    <Avatar peer={peer} />
                  </span>
                  <span className="mention-suggestion-text">
                    <strong>{display}</strong>
                    {display !== peer.displayName && (
                      <small>{peer.displayName}</small>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        )}
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
              const nextValue = e.target.value;
              setBody(nextValue);
              updateTyping(!!nextValue.trim());
              syncMentionQuery(
                nextValue,
                e.target.selectionStart ?? nextValue.length,
              );
            }}
            onClick={(e) =>
              syncMentionQuery(
                e.currentTarget.value,
                e.currentTarget.selectionStart ?? e.currentTarget.value.length,
              )
            }
            onKeyUp={(e) => {
              if (
                e.key === 'ArrowLeft' ||
                e.key === 'ArrowRight' ||
                e.key === 'Home' ||
                e.key === 'End'
              ) {
                syncMentionQuery(
                  e.currentTarget.value,
                  e.currentTarget.selectionStart ??
                    e.currentTarget.value.length,
                );
              }
            }}
            onBlur={() => {
              updateTyping(false);
              setMentionQuery(null);
            }}
            onKeyDown={(e) => {
              if (mentionCandidates.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setMentionIndex((i) => (i + 1) % mentionCandidates.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setMentionIndex(
                    (i) =>
                      (i - 1 + mentionCandidates.length) %
                      mentionCandidates.length,
                  );
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setMentionQuery(null);
                  return;
                }
                if (
                  (e.key === 'Enter' || e.key === 'Tab') &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  pickMention(
                    mentionCandidates[mentionIndex] ?? mentionCandidates[0],
                  );
                  return;
                }
              }
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
            className="composer-emoji"
            type="button"
            disabled={unavailable}
            title="Chọn biểu tượng cảm xúc"
            aria-label="Chọn biểu tượng cảm xúc"
            aria-expanded={emojiOpen}
            onClick={() => setEmojiOpen(!emojiOpen)}
          >
            <UiIcon name="smile" />
          </button>
          <button
            className="secondary accept"
            disabled={unavailable}
            type={body.trim() ? 'submit' : 'button'}
            onClick={() => {
              if (!body.trim())
                void send({
                  clientMessageId: crypto.randomUUID(),
                  body: '👍',
                  status: 'sending',
                });
            }}
            aria-label={body.trim() ? 'Gửi tin nhắn' : 'Gửi lượt thích'}
            title={body.trim() ? 'Gửi tin nhắn' : 'Gửi lượt thích'}
          >
            <UiIcon name={body.trim() ? 'send' : 'like'} size={24} />
          </button>
        </form>
        {emojiOpen && (
          <EmojiPicker
            onPick={(emoji) => {
              setBody((previous) =>
                previous.length + emoji.length <= 10000
                  ? previous + emoji
                  : previous,
              );
              setEmojiOpen(false);
              composer.current?.focus();
            }}
          />
        )}
      </div>
    </div>
  );
}
