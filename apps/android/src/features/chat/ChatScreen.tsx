import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  Text,
  TextInput,
  type TextInputInstance,
  View,
} from 'react-native';
import {
  errorCodes as documentErrorCodes,
  isErrorWithCode as isDocumentError,
  pick as pickDocument,
} from '@react-native-documents/picker';
import Geolocation from '@react-native-community/geolocation';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { launchImageLibrary } from 'react-native-image-picker';
import Sound from 'react-native-nitro-sound';
import * as api from '../../api';
import { acquireChatSocket } from '../../realtime';
import { Avatar, Centered, InlineNotice } from '../../components/Common';
import { UiGlyph } from '../../components/Icons';
import {
  allPages,
  presenceLabel,
  type Peer,
  type Presence,
} from '../../presence';
import {
  clientMessageId,
  conversationName,
  dividerTime,
  extractMessageReply,
  GAME_CATALOG,
  mergeMessages,
  parseGameInviteBody,
} from '../../utils';
import { styles } from '../../styles';
import { ConversationInfo } from './ConversationInfo';
import { MessageMedia } from './MessageMedia';
import {
  SwipeableMessageBubble,
  triggerTouchHaptic,
} from './SwipeableMessageBubble';
import {
  VoiceTranscriptCard,
  type VoiceTranscriptEntry,
} from './VoiceTranscriptCard';
import { CallSummaryCard, type CallSummaryEntry } from './CallSummaryCard';
import { ChatComposer, type ChatComposerHandle } from './ChatComposer';
import { useCalls } from '../calls/CallProvider';
import { GameModal } from '../games/GameModal';
import { GAME_INFO, type CaroSession } from '../games/game-rules';
import { ChatHistoryCache, isFreshHistory } from './chat-history-cache';

async function requestMicrophonePermission() {
  if (Platform.OS !== 'android') return true;
  return (
    (await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Cho phép ghi âm',
        message: 'PingPong cần micro để gửi tin nhắn thoại.',
        buttonPositive: 'Cho phép',
        buttonNegative: 'Không cho phép',
      },
    )) === PermissionsAndroid.RESULTS.GRANTED
  );
}

async function requestLocationPermission() {
  if (Platform.OS !== 'android') return true;
  return (
    (await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Cho phép dùng vị trí',
        message:
          'PingPong cần vị trí hiện tại để chia sẻ trong cuộc trò chuyện.',
        buttonPositive: 'Cho phép',
        buttonNegative: 'Không cho phép',
      },
    )) === PermissionsAndroid.RESULTS.GRANTED
  );
}

function currentPosition() {
  return new Promise<{ latitude: number; longitude: number }>(
    (resolve, reject) =>
      Geolocation.getCurrentPosition(
        position => resolve(position.coords),
        reject,
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
      ),
  );
}

export function Chat({
  conversation,
  history,
  jumpTarget,
  presence,
  user,
  onBack,
  onExpired,
}: {
  conversation: api.Conversation;
  history: ChatHistoryCache;
  jumpTarget?: { conversationId: string; messageId: string; token: number };
  presence?: Record<string, Presence>;
  user: api.User;
  onBack: () => void;
  onExpired: () => void;
}) {
  const calls = useCalls();
  const [initial] = useState(() => {
    const cached = history.get(conversation.id);
    const cutoff = BigInt(conversation.membership.clearedAfterSequence ?? '0');
    const fresh = isFreshHistory(cached, conversation);
    return {
      fresh,
      messages: cached?.messages.filter(
        message => BigInt(message.sequence) > cutoff,
      ),
      older: fresh ? (cached?.older ?? null) : null,
      verified:
        fresh && cached
          ? {
              verifiedAt: cached.verifiedAt,
              highWatermark: cached.highWatermark,
            }
          : undefined,
      cutoff,
    };
  });
  const [messages, setMessages] = useState<api.Message[]>(
    initial.messages ?? [],
  );
  const [older, setOlder] = useState(initial.older);
  const olderRef = useRef(initial.older);
  const updateOlder = useCallback((next: string | null) => {
    olderRef.current = next;
    setOlder(next);
  }, []);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loading, setLoading] = useState(!initial.messages);
  const [sending, setSending] = useState(false);
  const [mediaPaths, setMediaPaths] = useState<Record<string, string>>(() => {
    const cached: Record<string, string> = {};
    for (const msg of initial.messages ?? []) {
      const path = history.getMediaPath(msg.id);
      if (path) cached[msg.id] = path;
    }
    return cached;
  });
  const [mediaLoading, setMediaLoading] = useState<Record<string, boolean>>({});
  const [recording, setRecording] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const recordingMsRef = useRef(0);
  const recordingStartRef = useRef(0);
  const [playingMessage, setPlayingMessage] = useState<string>();
  useEffect(() => {
    if (!calls.busy) return;
    setRecording(false);
    setRecordingMs(0);
    recordingMsRef.current = 0;
    recordingStartRef.current = 0;
    setPlayingMessage(undefined);
    Sound.removeRecordBackListener();
    Sound.removePlayBackListener();
    Sound.removePlaybackEndListener();
    void Sound.stopRecorder().catch(() => undefined);
    void Sound.stopPlayer().catch(() => undefined);
  }, [calls.busy]);
  const [connected, setConnected] = useState(false);
  const [realtimeUnavailable, setRealtimeUnavailable] = useState(false);
  const [error, setError] = useState('');
  const [replyTo, setReplyTo] = useState<api.Message>();
  const [editing, setEditing] = useState<api.Message>();
  const [actionTarget, setActionTarget] = useState<api.Message>();
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [mediaSheetOpen, setMediaSheetOpen] = useState(false);
  const [gameOpen, setGameOpen] = useState(false);
  const [currentGame, setCurrentGame] = useState<CaroSession | null>(null);
  const [reactions, setReactions] = useState<
    Record<string, { emoji: string; count: number; reacted: boolean }[]>
  >({});
  const [voiceTranscripts, setVoiceTranscripts] = useState<
    Record<string, VoiceTranscriptEntry>
  >({});
  const [callSummaries, setCallSummaries] = useState<
    Record<string, CallSummaryEntry>
  >({});
  const [typing, setTyping] = useState<Record<string, number>>({});
  const [members, setMembers] = useState<
    { id: string; user: Peer; role: 'owner' | 'admin' | 'member' }[]
  >([]);
  const [infoOpen, setInfoOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchedHits, setSearchedHits] = useState<api.Message[]>([]);
  const [searchingServer, setSearchingServer] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string>();
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const handledJumpTokenRef = useRef(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [title, setTitle] = useState(conversationName(conversation));
  const [background, setBackground] = useState(
    conversation.background ?? 'default',
  );
  const [nicknames, setNicknames] = useState<Record<string, string>>(
    conversation.nicknames ?? {},
  );
  const [pins, setPins] = useState<api.Message[]>([]);
  const [pendingRequest, setPendingRequest] = useState(
    conversation.messageRequest ?? null,
  );
  const [requestBusy, setRequestBusy] = useState(false);
  const messagesRef = useRef<api.Message[]>(initial.messages ?? []);
  const verifiedHistory = useRef(initial.verified);
  const skipInitialSync = useRef(initial.fresh);
  const clearedAfter = useRef(initial.cutoff);
  const messageList = useRef<FlatList<api.Message>>(null);
  const composerRef = useRef<ChatComposerHandle>(null);
  const searchInputRef = useRef<TextInputInstance>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const socketRef = useRef<ReturnType<typeof acquireChatSocket> | undefined>(
    undefined,
  );
  const retryRealtimeRef = useRef<(() => void) | undefined>(undefined);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const typingAt = useRef(0);
  const mediaPathsRef = useRef<Record<string, string>>(mediaPaths);
  const mountedRef = useRef(true);
  const voiceConversationRef = useRef(conversation.id);
  voiceConversationRef.current = conversation.id;
  const voicePendingRef = useRef(new Set<string>());
  const callSummaryPendingRef = useRef(new Set<string>());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (verifiedHistory.current) {
        history.remember(conversation.id, {
          ...verifiedHistory.current,
          messages: messagesRef.current,
          older: olderRef.current,
          clearedAfter: clearedAfter.current,
        });
      }
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, [conversation.id, history]);

  useEffect(() => {
    setVoiceTranscripts({});
    setCallSummaries({});
    voicePendingRef.current.clear();
    callSummaryPendingRef.current.clear();
    let activeFetch = true;
    setCurrentGame(null);
    setGameOpen(false);
    void api
      .authenticated<{ game: CaroSession | null }>(
        `/conversations/${conversation.id}/games/current`,
      )
      .then(res => {
        if (activeFetch && mountedRef.current) setCurrentGame(res.game);
      })
      .catch(() => {});
    return () => {
      activeFetch = false;
    };
  }, [conversation.id]);

  const accept = useCallback((incoming: api.Message[]) => {
    if (!mountedRef.current) return;
    messagesRef.current = mergeMessages(
      messagesRef.current,
      incoming.filter(
        message => BigInt(message.sequence) > clearedAfter.current,
      ),
    );
    setMessages(messagesRef.current);
  }, []);
  const applyClearedHistory = useCallback(
    (clearedAfterSequence: string) => {
      const cutoff = BigInt(clearedAfterSequence || '0');
      if (cutoff > clearedAfter.current) clearedAfter.current = cutoff;
      history.invalidate(conversation.id);
      for (const [id] of Object.entries(mediaPathsRef.current)) {
        const msg = messagesRef.current.find(item => item.id === id);
        if (!msg || BigInt(msg.sequence) <= cutoff) {
          history.deleteMediaPath(id);
          delete mediaPathsRef.current[id];
        }
      }
      setMediaPaths({ ...mediaPathsRef.current });
      setPlayingMessage(undefined);
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
      void Sound.stopPlayer().catch(() => undefined);
      messagesRef.current = messagesRef.current.filter(
        item => BigInt(item.sequence) > cutoff,
      );
      setMessages(messagesRef.current);
      updateOlder(null);
      setReplyTo(undefined);
      setEditing(undefined);
      setActionTarget(undefined);
      setSearchedHits([]);
      setVoiceTranscripts({});
      setCallSummaries({});
      setReactions({});
    },
    [conversation.id, history, updateOlder],
  );
  const fail = useCallback(
    (next: unknown) => {
      if (next instanceof api.ApiError && next.status === 401) onExpired();
      else setError(api.errorMessage(next));
    },
    [onExpired],
  );
  const sync = useCallback(async () => {
    try {
      if (skipInitialSync.current) {
        skipInitialSync.current = false;
        return;
      }
      const latest = messagesRef.current.at(-1)?.sequence;
      if (!verifiedHistory.current || !latest) {
        const before = new Map(
          messagesRef.current.map(message => [message.id, message]),
        );
        const page = await history.loadRecent(
          conversation.id,
          clearedAfter.current,
        );
        if (!mountedRef.current) return;
        // Replace the provisional history, retaining live updates during the request.
        const returned = new Set(page.items.map(message => message.id));
        const watermark = BigInt(page.highWatermark);
        const live = messagesRef.current.filter(
          message =>
            before.get(message.id) !== message &&
            (returned.has(message.id) || BigInt(message.sequence) > watermark),
        );
        messagesRef.current = [];
        accept(mergeMessages(page.items, live));
        verifiedHistory.current = {
          verifiedAt: Date.now(),
          highWatermark: page.highWatermark,
        };
        updateOlder(
          page.nextCursor && BigInt(page.nextCursor) > clearedAfter.current
            ? page.nextCursor
            : null,
        );
      } else {
        let cursor: string | null = latest;
        do {
          const page: api.Page<api.Message> = await api.authenticated(
            `/conversations/${conversation.id}/messages?direction=forward&limit=50&cursor=${cursor}`,
          );
          if (!mountedRef.current) return;
          accept(page.items);
          cursor = page.nextCursor;
        } while (cursor);
      }
      setError('');
    } catch (next) {
      if (!mountedRef.current) return;
      if (
        next instanceof api.ApiError &&
        [401, 403, 404].includes(next.status)
      ) {
        verifiedHistory.current = undefined;
        history.invalidate(conversation.id);
        messagesRef.current = [];
        setMessages([]);
        updateOlder(null);
      }
      fail(next);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [accept, conversation.id, fail, history, updateOlder]);

  const loadMembers = useCallback(async () => {
    try {
      const [loadedMembers, pinsRes, convRes] = await Promise.all([
        allPages<{
          id: string;
          user: Peer;
          role: 'owner' | 'admin' | 'member';
        }>(`/conversations/${conversation.id}/members`),
        api
          .authenticated<{ items: api.Message[] }>(
            `/conversations/${conversation.id}/pins`,
          )
          .catch(() => ({ items: [] as api.Message[] })),
        api
          .authenticated<{ conversation: api.Conversation }>(
            `/conversations/${conversation.id}`,
          )
          .catch(() => undefined),
      ]);
      setMembers(loadedMembers);
      setPins(pinsRes.items ?? []);
      if (convRes?.conversation) {
        if (convRes.conversation.background) {
          setBackground(convRes.conversation.background);
        }
        if (convRes.conversation.nicknames) {
          setNicknames(convRes.conversation.nicknames);
        }
        setPendingRequest(convRes.conversation.messageRequest ?? null);
      }
    } catch (next) {
      fail(next);
    }
  }, [conversation.id, fail]);

  async function togglePinMessage(target: api.Message) {
    const isPinned = pins.some(p => p.id === target.id);
    try {
      if (isPinned) {
        await api.authenticated(
          `/conversations/${conversation.id}/pins/${target.id}`,
          undefined,
          'DELETE',
        );
        setPins(prev => prev.filter(p => p.id !== target.id));
      } else {
        await api.authenticated(
          `/conversations/${conversation.id}/pins/${target.id}`,
          {},
          'POST',
        );
        setPins(prev => [target, ...prev.filter(p => p.id !== target.id)]);
      }
    } catch (next) {
      fail(next);
    }
  }

  async function handleMessageRequestDecision(action: 'accept' | 'reject') {
    if (requestBusy) return;
    setRequestBusy(true);
    try {
      if (pendingRequest?.id) {
        await api.authenticated(
          `/message-requests/${pendingRequest.id}`,
          { action },
          'PATCH',
        );
      } else if (action === 'reject') {
        await api.authenticated(
          `/conversations/${conversation.id}/history`,
          undefined,
          'DELETE',
        );
      }
      setPendingRequest(null);
      if (action === 'reject') onBack();
    } catch (next) {
      fail(next);
    } finally {
      setRequestBusy(false);
    }
  }

  async function loadOlderMessages() {
    if (!older || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await api.authenticated<api.Page<api.Message>>(
        `/conversations/${conversation.id}/messages?direction=backward&limit=50&cursor=${older}`,
      );
      accept(page.items);
      updateOlder(page.nextCursor);
    } catch (next) {
      fail(next);
    } finally {
      setLoadingOlder(false);
    }
  }

  async function loadReactions(messageId: string) {
    try {
      const result = await api.authenticated<{
        messageId: string;
        items: { emoji: string; count: number; reacted: boolean }[];
      }>(`/conversations/${conversation.id}/messages/${messageId}/reactions`);
      setReactions(previous => ({
        ...previous,
        [messageId]: result.items,
      }));
    } catch (next) {
      fail(next);
    }
  }

  function updateTyping(value: boolean) {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (
      socketRef.current?.isConnected() &&
      (!value || Date.now() - typingAt.current > 3000)
    ) {
      socketRef.current.emit(
        'typing:update',
        { conversationId: conversation.id, typing: value },
        () => undefined,
      );
      typingAt.current = Date.now();
    }
    if (value)
      typingTimer.current = setTimeout(() => updateTyping(false), 3500);
  }

  useEffect(() => {
    let stopped = false;
    let subscribed = false;
    let syncingThroughApi = false;
    let catchUpAfterSync = false;
    const socket = acquireChatSocket(onExpired);
    socketRef.current = socket;
    async function syncThroughApi() {
      if (stopped || syncingThroughApi) return;
      syncingThroughApi = true;
      try {
        await sync();
      } finally {
        syncingThroughApi = false;
        if (catchUpAfterSync) {
          catchUpAfterSync = false;
          void syncThroughApi();
        }
      }
    }
    function subscribe() {
      if (stopped || !socket.isConnected()) return;
      socket.emitWithTimeout(
        10000,
        'conversation:subscribe',
        { conversationId: conversation.id },
        (problem: Error | null, result?: { ok: boolean }) => {
          if (stopped || !socket.isConnected()) return;
          if (problem || !result?.ok) {
            setConnected(false);
            setRealtimeUnavailable(true);
            return;
          }
          subscribed = true;
          setConnected(true);
          setRealtimeUnavailable(false);
          if (syncingThroughApi) catchUpAfterSync = true;
          else void syncThroughApi();
        },
      );
    }
    function recover() {
      void syncThroughApi();
      if (socket.isConnected()) subscribe();
      else void socket.connect();
    }
    retryRealtimeRef.current = recover;
    setConnected(false);
    setRealtimeUnavailable(false);
    const offConnect = socket.on('connect', () => {
      subscribe();
    });
    const offDisconnect = socket.on('disconnect', () => {
      subscribed = false;
      setConnected(false);
      setRealtimeUnavailable(true);
    });
    const offConnectError = socket.on('connect_error', () => {
      subscribed = false;
      setConnected(false);
      setRealtimeUnavailable(true);
    });
    const offCreated = socket.on('message:created', (message: api.Message) => {
      if (message.conversationId === conversation.id) accept([message]);
    });
    const offUpdated = socket.on('message:updated', (message: api.Message) => {
      if (message.conversationId === conversation.id) accept([message]);
    });
    const offDeleted = socket.on('message:deleted', (message: api.Message) => {
      if (message.conversationId === conversation.id) accept([message]);
    });
    const offReactions = socket.on(
      'message:reactions',
      (event: { conversationId: string; messageId: string }) => {
        if (event.conversationId === conversation.id)
          void loadReactions(event.messageId);
      },
    );
    const offCleared = socket.on(
      'conversation:history-cleared',
      (event: { conversationId: string; clearedAfterSequence: string }) => {
        if (event.conversationId === conversation.id)
          applyClearedHistory(event.clearedAfterSequence);
      },
    );
    const offGame = socket.on(
      'game:updated',
      (result?: { game?: CaroSession }) => {
        if (!result?.game || result.game.conversationId !== conversation.id)
          return;
        setCurrentGame(result.game);
        if (
          result.game.status === 'invited' &&
          result.game.oUserId === user.id
        ) {
          setGameOpen(true);
        }
      },
    );
    const offTyping = socket.on(
      'typing:update',
      (event: {
        conversationId: string;
        userId: string;
        typing: boolean;
        expiresAt: string;
      }) => {
        if (
          event.conversationId === conversation.id &&
          event.userId !== user.id
        )
          setTyping(previous => {
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
      },
    );
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') recover();
    });
    const fallback = setInterval(() => {
      if (!subscribed && AppState.currentState === 'active') recover();
    }, 5000);
    void syncThroughApi();
    void loadMembers();
    if (socket.isConnected()) subscribe();
    return () => {
      stopped = true;
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (socket.isConnected())
        socket.emit(
          'typing:update',
          { conversationId: conversation.id, typing: false },
          () => undefined,
        );
      clearInterval(fallback);
      retryRealtimeRef.current = undefined;
      subscription.remove();
      offConnect();
      offDisconnect();
      offConnectError();
      offCreated();
      offUpdated();
      offDeleted();
      offReactions();
      offCleared();
      offGame();
      offTyping();
      socket.release();
      socketRef.current = undefined;
    };
  }, [
    accept,
    applyClearedHistory,
    conversation.id,
    loadMembers,
    onExpired,
    sync,
    user.id,
  ]);

  const hasTyping = Object.keys(typing).length > 0;
  useEffect(() => {
    if (!hasTyping) return;
    const typingExpiry = setInterval(() => {
      const now = Date.now();
      setTyping(previous =>
        Object.values(previous).some(expiry => expiry > 0 && expiry <= now)
          ? Object.fromEntries(
              Object.entries(previous).filter(([, expiry]) => expiry > now),
            )
          : previous,
      );
    }, 1000);
    return () => clearInterval(typingExpiry);
  }, [hasTyping]);

  useEffect(
    () => () => {
      Sound.stopRecorder().catch(() => undefined);
      Sound.stopPlayer().catch(() => undefined);
      Sound.removeRecordBackListener();
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
    },
    [],
  );

  useEffect(() => {
    if (!verifiedHistory.current) return;
    const newest = messages.at(-1);
    if (!newest || newest.senderId === user.id || newest.deletedAt) return;
    void api
      .authenticated(`/conversations/${conversation.id}/messages/read`, {
        messageId: newest.id,
      })
      .catch(fail);
  }, [conversation.id, fail, messages, user.id]);

  async function send(rawText: string) {
    const text = rawText.trim();
    if (sending || !text) return false;
    setSending(true);
    setError('');
    try {
      if (editing) {
        const result = await api.authenticated<{ message: api.Message }>(
          `/conversations/${conversation.id}/messages/${editing.id}`,
          { body: text, expectedEditedAt: editing.editedAt ?? null },
          'PATCH',
        );
        accept([result.message]);
        setEditing(undefined);
        updateTyping(false);
        return true;
      }
      const original = replyTo
        ? (messagesRef.current.find(item => item.id === replyTo.id) ?? replyTo)
        : undefined;
      if (text.length > 10000) {
        setError('Tin nhắn tối đa 10.000 ký tự.');
        return false;
      }
      const result = await api.authenticated<{ message: api.Message }>(
        `/conversations/${conversation.id}/messages`,
        {
          clientMessageId: clientMessageId(),
          type: 'text',
          body: text,
          ...(original ? { replyToMessageId: original.id } : {}),
        },
      );
      accept([result.message]);
      setReplyTo(undefined);
      if (pendingRequest?.direction === 'incoming') setPendingRequest(null);
      updateTyping(false);
      return true;
    } catch (next) {
      fail(next);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function sendFile(
    file: api.LocalUpload,
    type: 'image' | 'file' | 'voice',
    durationSeconds?: number,
  ) {
    if (sending) return;
    setSending(true);
    setError('');
    try {
      const result = await api.uploadChatFile(
        conversation.id,
        clientMessageId(),
        file,
        type,
        durationSeconds,
      );
      accept([result.message]);
    } catch (next) {
      fail(next);
    } finally {
      setSending(false);
    }
  }

  async function chooseImage() {
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      quality: 0.9,
    });
    if (result.didCancel) return;
    if (result.errorCode) throw new Error(result.errorMessage);
    const image = result.assets?.[0];
    if (!image?.uri) throw new Error('Không thể đọc ảnh đã chọn.');
    await sendFile(
      {
        uri: image.uri,
        name: image.fileName ?? `image-${Date.now()}.jpg`,
        mimeType: image.type ?? 'image/jpeg',
      },
      'image',
    );
  }

  async function chooseFile() {
    try {
      const [file] = await pickDocument({ mode: 'import' });
      if (file.size !== null && file.size > 100 * 1024 * 1024) {
        setError('Tệp vượt quá giới hạn 100 MB.');
        return;
      }
      await sendFile(
        {
          uri: file.uri,
          name: file.name ?? `file-${Date.now()}`,
          mimeType: file.type ?? 'application/octet-stream',
        },
        'file',
      );
    } catch (next) {
      if (
        isDocumentError(next) &&
        next.code === documentErrorCodes.OPERATION_CANCELED
      )
        return;
      throw next;
    }
  }

  async function shareLocation() {
    if (!(await requestLocationPermission())) {
      setError('Bạn cần cho phép truy cập vị trí để chia sẻ vị trí hiện tại.');
      return;
    }
    setSending(true);
    setError('');
    try {
      const location = await currentPosition();
      Alert.alert(
        'Chia sẻ vị trí hiện tại?',
        `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`,
        [
          { text: 'Hủy', style: 'cancel' },
          {
            text: 'Chia sẻ',
            onPress: () =>
              void api
                .authenticated<{ message: api.Message }>(
                  `/conversations/${conversation.id}/messages`,
                  {
                    clientMessageId: clientMessageId(),
                    type: 'location',
                    location,
                  },
                )
                .then(result => accept([result.message]))
                .catch(fail),
          },
        ],
      );
    } catch {
      setError('Không thể lấy vị trí hiện tại. Hãy bật định vị và thử lại.');
    } finally {
      setSending(false);
    }
  }

  async function startRecording() {
    if (!(await requestMicrophonePermission())) {
      setError('Bạn cần cho phép dùng micro để gửi tin nhắn thoại.');
      return;
    }
    await Sound.stopPlayer().catch(() => undefined);
    Sound.removePlayBackListener();
    Sound.removePlaybackEndListener();
    setPlayingMessage(undefined);
    recordingMsRef.current = 0;
    recordingStartRef.current = 0;
    Sound.addRecordBackListener(event => {
      recordingMsRef.current = event.currentPosition;
      setRecordingMs(event.currentPosition);
    });
    await Sound.startRecorder();
    recordingStartRef.current = Date.now();
    setRecordingMs(0);
    setRecording(true);
  }

  async function finishRecording(sendRecording: boolean) {
    if (!recording) return;
    setRecording(false);
    Sound.removeRecordBackListener();
    const elapsedMs = Math.max(
      recordingMsRef.current,
      recordingStartRef.current ? Date.now() - recordingStartRef.current : 0,
    );
    try {
      const path = await Sound.stopRecorder();
      if (!sendRecording) {
        await ReactNativeBlobUtil.fs
          .unlink(path.replace(/^file:\/\//, ''))
          .catch(() => undefined);
        return;
      }
      if (elapsedMs < 500) {
        setError('Tin nhắn thoại quá ngắn. Hãy ghi âm lâu hơn một chút.');
        return;
      }
      await sendFile(
        {
          uri: path,
          name: `voice-${Date.now()}.m4a`,
          mimeType: 'audio/mp4',
        },
        'voice',
        Math.max(1, Math.round(elapsedMs / 1000)),
      );
    } catch (next) {
      fail(next);
    } finally {
      recordingMsRef.current = 0;
      recordingStartRef.current = 0;
      setRecordingMs(0);
    }
  }

  useEffect(() => {
    const term = searchQuery.trim();
    if (!term) {
      setSearchedHits([]);
      setSearchingServer(false);
      return;
    }
    let cancelled = false;
    setSearchingServer(true);
    const timer = setTimeout(() => {
      void api
        .authenticated<{
          items: Pick<
            api.Message,
            | 'id'
            | 'conversationId'
            | 'senderId'
            | 'body'
            | 'createdAt'
            | 'sequence'
          >[];
        }>(
          `/messages/search?conversationId=${encodeURIComponent(conversation.id)}&query=${encodeURIComponent(term)}&limit=30`,
        )
        .then(res => {
          if (cancelled) return;
          setSearchedHits(
            res.items.map(hit => ({
              id: hit.id,
              conversationId: hit.conversationId,
              senderId: hit.senderId,
              clientMessageId: hit.id,
              sequence: hit.sequence,
              type: 'text',
              body: hit.body,
              createdAt: hit.createdAt,
              editedAt: null,
              deletedAt: null,
            })),
          );
        })
        .catch(() => {
          if (!cancelled) setSearchedHits([]);
        })
        .finally(() => {
          if (!cancelled) setSearchingServer(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [conversation.id, searchQuery]);

  function showMediaMenu() {
    if (sending || recording) return;
    setMediaSheetOpen(true);
  }

  async function downloadMedia(message: api.Message) {
    const cached =
      mediaPathsRef.current[message.id] ?? history.getMediaPath(message.id);
    if (cached) {
      if (!mediaPathsRef.current[message.id]) {
        mediaPathsRef.current = {
          ...mediaPathsRef.current,
          [message.id]: cached,
        };
        setMediaPaths(mediaPathsRef.current);
      }
      return;
    }
    if (mediaLoading[message.id]) return;
    setMediaLoading(previous => ({ ...previous, [message.id]: true }));
    try {
      const path = await api.downloadChatFile(
        conversation.id,
        message.id,
        message.content?.fileName,
      );
      history.setMediaPath(message.id, path);
      mediaPathsRef.current = { ...mediaPathsRef.current, [message.id]: path };
      setMediaPaths(mediaPathsRef.current);
    } catch (next) {
      fail(next);
    } finally {
      setMediaLoading(previous => ({ ...previous, [message.id]: false }));
    }
  }

  async function openMedia(message: api.Message) {
    const path = mediaPathsRef.current[message.id];
    if (!path) {
      await downloadMedia(message);
      return;
    }
    try {
      if (Platform.OS === 'android')
        await ReactNativeBlobUtil.android.actionViewIntent(
          path,
          message.content?.mimeType ?? 'application/octet-stream',
        );
      else await ReactNativeBlobUtil.ios.openDocument(path);
    } catch {
      setError('Thiết bị chưa có ứng dụng phù hợp để mở tệp này.');
    }
  }

  async function playVoice(message: api.Message) {
    const path = mediaPathsRef.current[message.id];
    if (!path) {
      await downloadMedia(message);
      return;
    }
    if (playingMessage === message.id) {
      await Sound.stopPlayer();
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
      setPlayingMessage(undefined);
      return;
    }
    await Sound.stopPlayer().catch(() => undefined);
    Sound.removePlayBackListener();
    Sound.removePlaybackEndListener();
    Sound.addPlaybackEndListener(() => {
      Sound.removePlayBackListener();
      Sound.removePlaybackEndListener();
      setPlayingMessage(undefined);
    });
    await Sound.startPlayer(path);
    setPlayingMessage(message.id);
  }

  const memberMap = useMemo(() => {
    const map = new Map<
      string,
      { id: string; user: Peer; role: 'owner' | 'admin' | 'member' }
    >();
    for (const member of members) {
      map.set(member.user.id, member);
    }
    return map;
  }, [members]);

  const pinIdSet = useMemo(() => new Set(pins.map(p => p.id)), [pins]);

  const messageMap = useMemo(() => {
    const map = new Map<string, api.Message>();
    for (const msg of messages) {
      map.set(msg.id, msg);
    }
    return map;
  }, [messages]);

  function memberName(id: string) {
    if (id === user.id) return 'Bạn';
    const found = memberMap.get(id);
    if (found && (nicknames[found.id] || nicknames[id])) {
      return nicknames[found.id] ?? nicknames[id]!;
    }
    if (nicknames[id]) return nicknames[id]!;
    return (
      found?.user.displayName ?? conversation.peer?.displayName ?? 'Thành viên'
    );
  }

  function messageLabel(message: api.Message) {
    if (message.deletedAt) return 'Tin nhắn đã được thu hồi';
    const extracted = extractMessageReply(message).body;
    if (extracted) return extracted;
    if (message.type === 'location') return '📍 Vị trí được chia sẻ';
    if (message.type === 'voice') return '🎤 Tin nhắn thoại';
    if (message.type === 'image') return '🖼 Ảnh';
    return `📎 ${message.content?.fileName ?? 'Tệp đính kèm'}`;
  }

  const jumpToMessage = useCallback(
    async (
      messageId: string,
      notFoundText = 'Không tìm thấy tin nhắn gốc.',
    ) => {
      setError('');
      setSearchOpen(false);
      setSearchQuery('');
      try {
        let cursor = olderRef.current;
        while (
          !messagesRef.current.some(item => item.id === messageId) &&
          cursor
        ) {
          const page = await api.authenticated<api.Page<api.Message>>(
            `/conversations/${conversation.id}/messages?direction=backward&limit=50&cursor=${cursor}`,
          );
          if (!mountedRef.current) return;
          accept(page.items);
          updateOlder(page.nextCursor);
          if (page.nextCursor === cursor) break;
          cursor = page.nextCursor;
        }
        if (!mountedRef.current) return;
        const index = messagesRef.current.findIndex(
          item => item.id === messageId,
        );
        if (index < 0) {
          setError(notFoundText);
          return;
        }
        const invertedIndex = messagesRef.current.length - 1 - index;
        setHighlightedMessageId(messageId);
        if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = setTimeout(() => {
          setHighlightedMessageId(current =>
            current === messageId ? undefined : current,
          );
        }, 2500);
        setTimeout(() => {
          if (!mountedRef.current) return;
          try {
            messageList.current?.scrollToIndex({
              index: invertedIndex,
              animated: true,
              viewPosition: 0.5,
            });
          } catch {
            /* Fallback handled by onScrollToIndexFailed. */
          }
        }, 60);
      } catch (next) {
        fail(next);
      }
    },
    [accept, conversation.id, fail, updateOlder],
  );

  useEffect(() => {
    if (
      !jumpTarget ||
      jumpTarget.conversationId !== conversation.id ||
      loading ||
      handledJumpTokenRef.current === jumpTarget.token
    )
      return;
    handledJumpTokenRef.current = jumpTarget.token;
    void jumpToMessage(jumpTarget.messageId);
  }, [conversation.id, jumpTarget, jumpToMessage, loading]);

  const scheduleFocus = useCallback(
    (targetRef: React.RefObject<TextInputInstance | null>) => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
      focusTimer.current = setTimeout(() => {
        targetRef.current?.focus();
      }, 60);
    },
    [],
  );

  const focusComposer = useCallback(() => {
    composerRef.current?.focus();
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (gameOpen) {
        setGameOpen(false);
        return true;
      }
      if (infoOpen) {
        setInfoOpen(false);
        return true;
      }
      if (searchOpen) {
        setSearchOpen(false);
        setSearchQuery('');
        return true;
      }
      if (composerRef.current?.closeEmoji()) {
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [gameOpen, infoOpen, searchOpen]);

  useEffect(() => {
    return () => {
      if (focusTimer.current) clearTimeout(focusTimer.current);
    };
  }, []);

  const startReply = useCallback(
    (message: api.Message) => {
      if (message.deletedAt || message.type === 'call') return;
      setReplyTo(message);
      setEditing(undefined);
      setActionTarget(undefined);
      focusComposer();
    },
    [focusComposer],
  );

  function showActions(message: api.Message) {
    if (message.deletedAt || message.type === 'call') return;
    triggerTouchHaptic(10);
    setActionTarget(message);
    void loadReactions(message.id);
  }

  async function react(messageId: string, emoji: string) {
    try {
      const existing = reactions[messageId]?.find(item => item.reacted);
      const result = await api.authenticated<{
        messageId: string;
        items: { emoji: string; count: number; reacted: boolean }[];
      }>(
        `/conversations/${conversation.id}/messages/${messageId}/reaction`,
        existing?.emoji === emoji ? undefined : { emoji },
        existing?.emoji === emoji ? 'DELETE' : 'PUT',
      );
      setReactions(previous => ({ ...previous, [messageId]: result.items }));
      setActionTarget(undefined);
    } catch (next) {
      fail(next);
    }
  }

  async function summarizeCallMessage(target: api.Message) {
    const callId = target.content?.callId;
    if (
      target.type !== 'call' ||
      target.deletedAt ||
      !callId ||
      !target.content?.summaryAvailable
    )
      return;
    if (callSummaryPendingRef.current.has(target.id)) return;
    callSummaryPendingRef.current.add(target.id);
    const activeConversation = conversation.id;
    setCallSummaries(previous => ({
      ...previous,
      [target.id]: {
        ...previous[target.id],
        loading: true,
        error: undefined,
      },
    }));
    try {
      const response = await api.summarizeCall(callId);
      if (
        !mountedRef.current ||
        voiceConversationRef.current !== activeConversation
      )
        return;
      setCallSummaries(previous => ({
        ...previous,
        [target.id]: {
          loading: false,
          summary: response.result.summary,
          decisions: response.result.decisions,
          tasks: response.result.tasks,
        },
      }));
    } catch (e) {
      if (
        !mountedRef.current ||
        voiceConversationRef.current !== activeConversation
      )
        return;
      if (e instanceof api.ApiError && e.status === 401) {
        onExpired();
        return;
      }
      setCallSummaries(previous => ({
        ...previous,
        [target.id]: {
          ...previous[target.id],
          loading: false,
          error: api.errorMessage(e),
        },
      }));
    } finally {
      callSummaryPendingRef.current.delete(target.id);
    }
  }

  async function transcribeVoice(
    target: api.Message,
    options?: api.AiTranscribeOptions,
  ) {
    if (target.type !== 'voice' || target.deletedAt) return;
    if (voicePendingRef.current.has(target.id)) return;
    voicePendingRef.current.add(target.id);
    const activeConversation = conversation.id;
    setVoiceTranscripts(previous => ({
      ...previous,
      [target.id]: {
        ...previous[target.id],
        loading: true,
        error: undefined,
      },
    }));
    try {
      const response = await api.transcribeVoiceMessage(
        activeConversation,
        target.id,
        options,
      );
      if (
        !mountedRef.current ||
        voiceConversationRef.current !== activeConversation
      ) {
        return;
      }
      const nextResult = response.result;
      setVoiceTranscripts(previous => {
        const prior = previous[target.id];
        return {
          ...previous,
          [target.id]: {
            loading: false,
            transcript: nextResult.transcript,
            language: nextResult.language,
            translation: nextResult.translation || prior?.translation,
            translatedLanguage: nextResult.translation
              ? options?.translateTo === 'en'
                ? 'en'
                : 'vi'
              : prior?.translatedLanguage,
            replies: nextResult.replies.length
              ? nextResult.replies
              : prior?.replies,
            error: undefined,
          },
        };
      });
    } catch (next) {
      if (
        !mountedRef.current ||
        voiceConversationRef.current !== activeConversation
      ) {
        return;
      }
      if (next instanceof api.ApiError && next.status === 401) {
        onExpired();
        return;
      }
      setVoiceTranscripts(previous => ({
        ...previous,
        [target.id]: {
          ...previous[target.id],
          loading: false,
          error: api.errorMessage(next),
        },
      }));
    } finally {
      voicePendingRef.current.delete(target.id);
    }
  }

  if (infoOpen)
    return (
      <ConversationInfo
        conversation={conversation}
        currentBackground={background}
        currentTitle={title}
        members={members}
        nicknames={nicknames}
        onBackgroundChange={setBackground}
        onClearHistory={clearedAfterSequence => {
          applyClearedHistory(clearedAfterSequence);
          setInfoOpen(false);
        }}
        onClose={() => setInfoOpen(false)}
        onExpired={onExpired}
        onLeave={onBack}
        onMembers={setMembers}
        onNicknamesChange={nextNicknames => {
          setNicknames(nextNicknames);
          if (conversation.type === 'direct' && conversation.peer) {
            const peerMember = members.find(
              m => m.user.id === conversation.peer?.id,
            );
            const custom =
              (peerMember && nextNicknames[peerMember.id]) ||
              nextNicknames[conversation.peer.id];
            setTitle(custom || conversation.peer.displayName);
          }
        }}
        onTitle={setTitle}
        user={user}
      />
    );

  const THEME_BG: Record<string, string> = {
    default: '#faf7f0',
    ocean: '#edf6fa',
    mint: '#eef7f2',
    sunset: '#fdf2e9',
    rose: '#fcf0f4',
    sand: '#f5ede0',
  };
  const timelineBg = THEME_BG[background] ?? '#faf7f0';
  const lastOwnMessageId = [...messages]
    .reverse()
    .find(m => m.senderId === user.id && m.type !== 'call' && !m.deletedAt)?.id;

  const normalizedSearch = searchQuery.trim().toLocaleLowerCase('vi');
  const displayedMessages = normalizedSearch
    ? mergeMessages(
        messages.filter(item =>
          (item.body ?? '').toLocaleLowerCase('vi').includes(normalizedSearch),
        ),
        searchedHits,
      )
    : messages;
  const invertedMessages = useMemo(
    () => [...displayedMessages].reverse(),
    [displayedMessages],
  );
  const peerPresence =
    conversation.type === 'direct' && conversation.peer?.id
      ? presence?.[conversation.peer.id]
      : undefined;
  const peerOnline = Boolean(peerPresence?.online);
  const showPresenceDot =
    !realtimeUnavailable && conversation.type === 'direct' && !!peerPresence;
  const headerStatusText = realtimeUnavailable
    ? 'Đang đồng bộ qua API'
    : conversation.type === 'group'
      ? members.length > 0
        ? `${members.length} thành viên`
        : 'Nhóm trò chuyện'
      : peerPresence
        ? presenceLabel(peerPresence)
        : !connected
          ? 'Đang kết nối…'
          : 'Nhấn để xem thông tin';

  return (
    <KeyboardAvoidingView
      behavior={
        Platform.OS === 'ios' ||
        (Platform.OS === 'android' && Number(Platform.Version) >= 35)
          ? 'padding'
          : undefined
      }
      style={styles.page}
    >
      <View style={styles.chatHeader}>
        <Pressable
          accessibilityLabel="Quay lại danh sách tin nhắn"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onBack}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.infoButtonActive,
          ]}
        >
          <UiGlyph name="back" color="#b75020" size={18} />
        </Pressable>
        <Avatar
          peer={{
            id: conversation.peer?.id ?? conversation.id,
            displayName: title,
            avatarUrl: conversation.peer?.avatarUrl,
          }}
          size={34}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => setInfoOpen(true)}
          style={styles.chatTitleBox}
        >
          <Text numberOfLines={1} style={styles.headerTitle}>
            {title}
          </Text>
          <View style={styles.connectionRow}>
            {showPresenceDot && (
              <View
                style={[styles.statusDot, peerOnline && styles.statusDotOnline]}
              />
            )}
            <Text
              numberOfLines={1}
              style={[
                styles.connection,
                showPresenceDot && peerOnline && styles.connectionOnline,
              ]}
            >
              {headerStatusText}
            </Text>
          </View>
        </Pressable>
        <View style={styles.chatActionGroup}>
          {(['audio', 'video'] as const).map(type => (
            <Pressable
              key={type}
              accessibilityRole="button"
              accessibilityLabel={type === 'audio' ? 'Gọi thoại' : 'Gọi video'}
              disabled={calls.busy || recording}
              onPress={() => calls.start(conversation, type)}
              style={({ pressed }) => [
                styles.infoButton,
                pressed && styles.infoButtonActive,
                (calls.busy || recording) && styles.disabled,
              ]}
            >
              <UiGlyph
                name={type === 'audio' ? 'phone' : 'video'}
                color="#b75020"
                size={18}
              />
            </Pressable>
          ))}
          <Pressable
            accessibilityLabel="Thêm tiện ích cuộc trò chuyện"
            accessibilityRole="button"
            accessibilityState={{ expanded: headerMenuOpen }}
            onPress={() => setHeaderMenuOpen(true)}
            style={({ pressed }) => [
              styles.infoButton,
              (searchOpen || pressed) && styles.infoButtonActive,
            ]}
          >
            <UiGlyph name="more" color="#b75020" size={18} />
          </Pressable>
        </View>
      </View>
      {searchOpen && (
        <View style={styles.chatSearchBar}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            ref={searchInputRef}
            accessibilityLabel="Tìm tin nhắn trong cuộc trò chuyện"
            autoFocus
            onChangeText={setSearchQuery}
            placeholder="Tìm tin nhắn trong cuộc trò chuyện…"
            placeholderTextColor="#8c7662"
            style={styles.searchInput}
            value={searchQuery}
          />
          {searchingServer && (
            <ActivityIndicator color="#b75020" size="small" />
          )}
          <Pressable
            accessibilityLabel="Đóng tìm kiếm"
            onPress={() => {
              setSearchOpen(false);
              setSearchQuery('');
            }}
            style={styles.contextClose}
          >
            <Text style={styles.contextCloseText}>×</Text>
          </Pressable>
        </View>
      )}
      {!!error && (
        <View style={styles.chatNotice}>
          <InlineNotice message={error} onRetry={() => void sync()} />
        </View>
      )}
      {!error && realtimeUnavailable && (
        <View style={styles.chatNotice}>
          <InlineNotice
            message="Không thể kết nối realtime; ứng dụng đang đồng bộ qua API."
            onRetry={() => retryRealtimeRef.current?.()}
          />
        </View>
      )}
      {!normalizedSearch && pins.length > 0 && (
        <Pressable
          onPress={() => void jumpToMessage(pins[0]!.id)}
          style={styles.pinnedBanner}
        >
          <UiGlyph name="pin" color="#b75020" size={16} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.pinnedBannerKicker}>
              📌 Tin nhắn đã ghim ({pins.length})
            </Text>
            <Text numberOfLines={1} style={styles.pinnedBannerBody}>
              {messageLabel(pins[0]!)}
            </Text>
          </View>
          <Pressable
            hitSlop={8}
            onPress={() => void togglePinMessage(pins[0]!)}
            style={{ paddingHorizontal: 6, paddingVertical: 4 }}
          >
            <Text style={{ color: '#8d7866', fontSize: 12, fontWeight: '700' }}>
              Bỏ ghim
            </Text>
          </Pressable>
        </Pressable>
      )}
      {!gameOpen &&
        currentGame &&
        (currentGame.status === 'invited' ||
          currentGame.status === 'active') && (
          <View style={styles.gameLiveBanner}>
            <View style={styles.gameLiveDot} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={styles.gameLiveTitle}>
                {GAME_INFO[currentGame.gameType]?.name ?? 'Trò chơi'}
              </Text>
              <Text numberOfLines={1} style={styles.gameLiveSubtitle}>
                {currentGame.status === 'invited'
                  ? GAME_INFO[currentGame.gameType]?.groupOnly
                    ? currentGame.xUserId === user.id
                      ? 'Đang chờ thành viên nhóm tham gia…'
                      : `${memberName(currentGame.xUserId)} vừa mở phòng chơi nhóm!`
                    : currentGame.oUserId === user.id
                      ? `${memberName(currentGame.xUserId)} đang mời bạn vào bàn`
                      : `Đang chờ ${memberName(currentGame.oUserId)} tham gia…`
                  : (currentGame.xUserId === user.id ? 'X' : 'O') ===
                      currentGame.turn
                    ? 'Đến lượt của bạn đi!'
                    : `Lượt của ${memberName(
                        currentGame.xUserId === user.id
                          ? currentGame.oUserId
                          : currentGame.xUserId,
                      )}`}
              </Text>
            </View>
            <Pressable
              onPress={() => setGameOpen(true)}
              style={styles.gameLiveBtn}
            >
              <Text style={styles.gameLiveBtnText}>
                {currentGame.status === 'invited' &&
                currentGame.xUserId !== user.id
                  ? 'Tham gia'
                  : 'Mở bàn'}
              </Text>
            </Pressable>
          </View>
        )}
      {loading ? (
        <Centered label="Đang tải tin nhắn…" />
      ) : displayedMessages.length === 0 ? (
        <View style={{ flex: 1, backgroundColor: timelineBg }}>
          <View style={styles.emptyChat}>
            <View style={styles.emptySymbol}>
              <Text style={styles.emptySymbolText}>
                {normalizedSearch ? '⌕' : 'P'}
              </Text>
            </View>
            <Text style={styles.emptyTitle}>
              {normalizedSearch
                ? 'Không tìm thấy tin nhắn'
                : 'Bắt đầu trò chuyện'}
            </Text>
            <Text style={styles.empty}>
              {normalizedSearch
                ? 'Thử nhập từ khóa khác để tìm trong cuộc trò chuyện.'
                : 'Gửi một lời chào để bắt đầu kết nối.'}
            </Text>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: timelineBg }}>
          <FlatList
            ref={messageList}
            inverted
            contentContainerStyle={styles.messageListInverted}
            data={invertedMessages}
            initialNumToRender={16}
            maxToRenderPerBatch={12}
            windowSize={9}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            keyExtractor={item => item.id}
            ListFooterComponent={
              older && !normalizedSearch ? (
                <Pressable
                  disabled={loadingOlder}
                  onPress={() => void loadOlderMessages()}
                  style={styles.loadOlder}
                >
                  {loadingOlder ? (
                    <ActivityIndicator color="#b75020" size="small" />
                  ) : (
                    <Text style={styles.loadOlderText}>Xem tin nhắn cũ</Text>
                  )}
                </Pressable>
              ) : undefined
            }
            onScrollToIndexFailed={info => {
              messageList.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: false,
              });
              setTimeout(() => {
                if (!mountedRef.current) return;
                try {
                  messageList.current?.scrollToIndex({
                    index: info.index,
                    animated: true,
                    viewPosition: 0.5,
                  });
                } catch {
                  /* Ignore if unmounted or list changed. */
                }
              }, 80);
            }}
            onScroll={event => {
              const isNear = event.nativeEvent.contentOffset.y < 120;
              if (showScrollDown === isNear) setShowScrollDown(!isNear);
            }}
            scrollEventThrottle={32}
            showsVerticalScrollIndicator={false}
            renderItem={({ item, index }) => {
              const mine = item.senderId === user.id;
              const chronoIndex = displayedMessages.length - 1 - index;
              const prev =
                chronoIndex > 0
                  ? displayedMessages[chronoIndex - 1]
                  : undefined;
              const next =
                chronoIndex < displayedMessages.length - 1
                  ? displayedMessages[chronoIndex + 1]
                  : undefined;
              const showTimeDivider =
                !prev ||
                Date.parse(item.createdAt) - Date.parse(prev.createdAt) >=
                  5 * 60 * 1000;
              const nextTimeGap =
                !!next &&
                Date.parse(next.createdAt) - Date.parse(item.createdAt) >=
                  5 * 60 * 1000;
              const prevSame =
                !!prev &&
                !showTimeDivider &&
                prev.senderId === item.senderId &&
                prev.type !== 'call' &&
                item.type !== 'call';
              const nextSame =
                !!next &&
                !nextTimeGap &&
                next.senderId === item.senderId &&
                next.type !== 'call' &&
                item.type !== 'call';
              const isPinned = pinIdSet.has(item.id);
              const extractedBody = extractMessageReply(item).body;
              const gameInvite =
                !item.deletedAt && (!item.type || item.type === 'text')
                  ? parseGameInviteBody(extractedBody)
                  : null;
              const gameMeta = gameInvite
                ? GAME_CATALOG[gameInvite.gameType]
                : undefined;
              const senderPeer =
                memberMap.get(item.senderId)?.user ??
                (conversation.peer?.id === item.senderId
                  ? conversation.peer
                  : {
                      id: item.senderId,
                      displayName: memberName(item.senderId),
                    });
              const { reply } = extractMessageReply(item);
              const quotedTarget = reply?.messageId
                ? messageMap.get(reply.messageId)
                : undefined;
              const quotedDeleted =
                reply?.type === 'deleted' || !!quotedTarget?.deletedAt;
              const senderLabel = memberName(item.senderId);
              const targetLabel = reply?.senderId
                ? reply.senderId === user.id
                  ? undefined
                  : memberName(reply.senderId)
                : reply?.legacySenderName;
              const replyContext = reply
                ? mine
                  ? reply.senderId === user.id
                    ? 'Bạn đã trả lời chính mình'
                    : `Bạn đã trả lời ${targetLabel ?? 'thành viên'}`
                  : reply.senderId === user.id
                    ? `${senderLabel} đã trả lời bạn`
                    : reply.senderId === item.senderId
                      ? `${senderLabel} đã trả lời chính mình`
                      : `${senderLabel} đã trả lời ${targetLabel ?? 'thành viên'}`
                : '';
              const replyExcerpt = quotedDeleted
                ? 'Tin nhắn đã thu hồi'
                : (reply?.excerpt ?? '');
              const bubbleNode = (
                <>
                  {!mine && conversation.type === 'group' && !prevSame && (
                    <Text style={styles.messageSender}>
                      {memberName(item.senderId)}
                    </Text>
                  )}
                  {!!reply && !item.deletedAt && (
                    <View
                      style={[styles.replyStack, mine && styles.replyStackMine]}
                    >
                      <Text numberOfLines={1} style={styles.replyContextText}>
                        ↩ {replyContext}
                      </Text>
                      <Pressable
                        disabled={!reply.messageId}
                        onPress={() => {
                          if (reply.messageId) {
                            void jumpToMessage(reply.messageId);
                          }
                        }}
                        style={({ pressed }) => [
                          styles.replyQuoteBox,
                          mine && styles.replyQuoteBoxMine,
                          pressed && !!reply.messageId && styles.bubblePressed,
                        ]}
                      >
                        <Text numberOfLines={2} style={styles.replyQuoteText}>
                          {replyExcerpt}
                        </Text>
                      </Pressable>
                    </View>
                  )}
                  <SwipeableMessageBubble
                    disabled={!!item.deletedAt || item.type === 'call'}
                    message={item}
                    mine={mine}
                    onReply={startReply}
                  >
                    <Pressable
                      accessibilityHint={
                        item.deletedAt || item.type === 'call'
                          ? undefined
                          : 'Vuốt ngang để trả lời hoặc nhấn giữ để bày tỏ cảm xúc'
                      }
                      accessibilityRole="button"
                      delayLongPress={280}
                      onLongPress={() => showActions(item)}
                      onPress={
                        normalizedSearch
                          ? () => void jumpToMessage(item.id)
                          : undefined
                      }
                      style={({ pressed }) => [
                        styles.bubble,
                        mine ? styles.bubbleMine : styles.bubblePeer,
                        mine && nextSame && styles.bubbleMineContinuesBottom,
                        mine && prevSame && styles.bubbleMineContinuesTop,
                        !mine && nextSame && styles.bubblePeerContinuesBottom,
                        !mine && prevSame && styles.bubblePeerContinuesTop,
                        highlightedMessageId === item.id &&
                          (mine
                            ? styles.bubbleMineHighlighted
                            : styles.bubbleHighlighted),
                        pressed &&
                          !item.deletedAt &&
                          item.type !== 'call' &&
                          styles.bubblePressed,
                      ]}
                    >
                      <MessageMedia
                        loading={!!mediaLoading[item.id]}
                        localPath={mediaPaths[item.id]}
                        message={item}
                        mine={mine}
                        onLoad={() => void downloadMedia(item)}
                        onOpen={() => void openMedia(item)}
                        onPlay={() => void playVoice(item).catch(fail)}
                        onTranscribe={
                          item.type === 'voice'
                            ? () => void transcribeVoice(item)
                            : undefined
                        }
                        onSummarizeCall={
                          item.type === 'call'
                            ? () => void summarizeCallMessage(item)
                            : undefined
                        }
                        playing={playingMessage === item.id}
                        transcribed={!!voiceTranscripts[item.id]?.transcript}
                        transcribing={!!voiceTranscripts[item.id]?.loading}
                        callSummarized={
                          callSummaries[item.id]?.summary !== undefined
                        }
                        callSummarizing={!!callSummaries[item.id]?.loading}
                      />
                      {(item.type === 'text' || !!item.deletedAt) && (
                        <>
                          {!item.deletedAt && isPinned && (
                            <Text
                              style={[
                                styles.pinTagText,
                                mine && styles.pinTagTextMine,
                              ]}
                            >
                              📌 Đã ghim
                            </Text>
                          )}
                          {gameInvite && !item.deletedAt ? (
                            <View
                              style={[
                                styles.gameInviteCard,
                                mine && styles.gameInviteCardMine,
                              ]}
                            >
                              <View style={styles.gameInviteHeader}>
                                <Text
                                  style={[
                                    styles.gameInviteKicker,
                                    mine && styles.gameInviteKickerMine,
                                  ]}
                                >
                                  🎮{' '}
                                  {gameMeta?.groupOnly
                                    ? 'TRÒ CHƠI NHÓM'
                                    : 'MỜI CHƠI'}
                                </Text>
                                {gameMeta && (
                                  <View style={styles.gameInviteBadge}>
                                    <Text style={styles.gameInviteBadgeText}>
                                      {gameMeta.badge}
                                    </Text>
                                  </View>
                                )}
                              </View>
                              <Text
                                style={[
                                  styles.gameInviteTitle,
                                  mine && styles.gameInviteTitleMine,
                                ]}
                              >
                                {gameMeta?.name ?? 'Trò chơi trực tuyến'}
                              </Text>
                              <Text
                                style={[
                                  styles.gameInviteDesc,
                                  mine && styles.gameInviteDescMine,
                                ]}
                              >
                                {gameMeta?.subtitle ?? gameInvite.text}
                              </Text>
                              <Pressable
                                onPress={() => {
                                  const isThisGame =
                                    !!currentGame &&
                                    (!gameInvite.gameId ||
                                      currentGame.id === gameInvite.gameId);
                                  if (
                                    isThisGame &&
                                    currentGame.status === 'invited' &&
                                    !mine
                                  ) {
                                    setGameOpen(true);
                                    void api
                                      .authenticated<{ game: CaroSession }>(
                                        `/games/${currentGame.id}/accept`,
                                        undefined,
                                        'POST',
                                      )
                                      .then(res => setCurrentGame(res.game))
                                      .catch(fail);
                                  } else {
                                    setGameOpen(true);
                                  }
                                }}
                                style={[
                                  styles.gameInviteActionBtn,
                                  mine && styles.gameInviteActionBtnMine,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.gameInviteActionText,
                                    mine && styles.gameInviteActionTextMine,
                                  ]}
                                >
                                  {!!currentGame &&
                                  (!gameInvite.gameId ||
                                    currentGame.id === gameInvite.gameId) &&
                                  currentGame.status === 'invited' &&
                                  !mine
                                    ? '⚡ Chấp nhận & chơi'
                                    : !!currentGame &&
                                        (!gameInvite.gameId ||
                                          currentGame.id ===
                                            gameInvite.gameId) &&
                                        currentGame.status === 'invited'
                                      ? '⏳ Phòng chờ'
                                      : !!currentGame &&
                                          (!gameInvite.gameId ||
                                            currentGame.id ===
                                              gameInvite.gameId) &&
                                          currentGame.status === 'active'
                                        ? '▶ Vào bàn chơi'
                                        : '▶ Mở bàn chơi'}
                                </Text>
                              </Pressable>
                            </View>
                          ) : (
                            <Text
                              style={[
                                styles.messageText,
                                mine && styles.messageTextMine,
                                !!item.deletedAt && styles.deletedMessage,
                              ]}
                            >
                              {messageLabel(item)}
                            </Text>
                          )}
                        </>
                      )}
                      {!!item.editedAt && !item.deletedAt && (
                        <View style={styles.messageTimeRow}>
                          <Text
                            style={[
                              styles.editedLabel,
                              mine && styles.bubbleTimeMine,
                            ]}
                          >
                            đã sửa
                          </Text>
                        </View>
                      )}
                    </Pressable>
                  </SwipeableMessageBubble>
                  {!!normalizedSearch && (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => void jumpToMessage(item.id)}
                      style={({ pressed }) => [
                        styles.searchJumpChip,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={styles.searchJumpChipText}>
                        Đi tới tin nhắn gốc ↗
                      </Text>
                    </Pressable>
                  )}
                  {!item.deletedAt &&
                    item.type === 'voice' &&
                    !!voiceTranscripts[item.id] && (
                      <VoiceTranscriptCard
                        mine={mine}
                        onHide={() =>
                          setVoiceTranscripts(previous => {
                            const rest = { ...previous };
                            delete rest[item.id];
                            return rest;
                          })
                        }
                        onRetry={() => void transcribeVoice(item)}
                        onSuggestReplies={() =>
                          void transcribeVoice(item, { includeReplies: true })
                        }
                        onTranslate={lang =>
                          void transcribeVoice(item, { translateTo: lang })
                        }
                        onUseReply={reply => {
                          setReplyTo(item);
                          setEditing(undefined);
                          composerRef.current?.setDraft(reply);
                          focusComposer();
                        }}
                        state={voiceTranscripts[item.id]}
                      />
                    )}
                  {!item.deletedAt &&
                    item.type === 'call' &&
                    !!callSummaries[item.id] && (
                      <CallSummaryCard
                        mine={mine}
                        onHide={() =>
                          setCallSummaries(previous => {
                            const rest = { ...previous };
                            delete rest[item.id];
                            return rest;
                          })
                        }
                        onRetry={() => void summarizeCallMessage(item)}
                        state={callSummaries[item.id]}
                      />
                    )}
                  {!!reactions[item.id]?.length && (
                    <View
                      style={[
                        styles.reactionSummary,
                        mine && styles.reactionSummaryMine,
                      ]}
                    >
                      {reactions[item.id].map(reaction => (
                        <Pressable
                          key={reaction.emoji}
                          onPress={() => void react(item.id, reaction.emoji)}
                          style={[
                            styles.reactionChip,
                            reaction.reacted && styles.reactionChipActive,
                          ]}
                        >
                          <Text style={styles.reactionChipText}>
                            {reaction.emoji} {reaction.count}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {mine && item.id === lastOwnMessageId && (
                    <Text style={styles.sentStatusText}>Đã gửi</Text>
                  )}
                </>
              );
              return (
                <View>
                  {showTimeDivider && !normalizedSearch && (
                    <View style={styles.timeDividerRow}>
                      <View style={styles.timeDividerLine} />
                      <Text style={styles.timeDividerText}>
                        {dividerTime(item.createdAt)}
                      </Text>
                      <View style={styles.timeDividerLine} />
                    </View>
                  )}
                  <View
                    style={[
                      styles.messageRow,
                      nextSame && styles.messageRowContinues,
                      mine && styles.messageRowMine,
                    ]}
                  >
                    {mine ? (
                      bubbleNode
                    ) : (
                      <View style={styles.peerMessageLine}>
                        <View style={styles.peerAvatarSlot}>
                          {!nextSame && <Avatar peer={senderPeer} size={28} />}
                        </View>
                        <View style={styles.peerMessageColumn}>
                          {bubbleNode}
                        </View>
                      </View>
                    )}
                  </View>
                </View>
              );
            }}
          />
          {showScrollDown && !normalizedSearch && (
            <Pressable
              accessibilityLabel="Cuộn xuống tin nhắn mới nhất"
              accessibilityRole="button"
              onPress={() => {
                setShowScrollDown(false);
                messageList.current?.scrollToOffset({
                  offset: 0,
                  animated: true,
                });
              }}
              style={styles.scrollDownFab}
            >
              <Text style={styles.scrollDownFabText}>↓ Tin mới</Text>
            </Pressable>
          )}
        </View>
      )}
      {Object.values(typing).some(expiry => expiry > Date.now()) && (
        <View style={styles.typingNote}>
          <View style={styles.typingBubble}>
            <View style={styles.typingDot} />
            <View style={[styles.typingDot, styles.typingDotAccent]} />
            <View style={styles.typingDot} />
          </View>
          <Text numberOfLines={1} style={styles.typingCaption}>
            {Object.entries(typing)
              .filter(([, expiry]) => expiry > Date.now())
              .map(([id]) => memberName(id))
              .join(', ')}{' '}
            đang nhập…
          </Text>
        </View>
      )}
      {pendingRequest?.direction === 'incoming' &&
        pendingRequest.status === 'pending' && (
          <View style={styles.chatRequestBanner}>
            <Text style={styles.chatRequestBannerTitle}>
              {title} muốn gửi tin nhắn cho bạn
            </Text>
            <Text style={styles.chatRequestBannerCopy}>
              Hai bạn chưa kết bạn trên PingPong. Chấp nhận hoặc trả lời trực
              tiếp bên dưới để chuyển đoạn chat về mục Tất cả.
            </Text>
            <View style={styles.chatRequestBannerActions}>
              <Pressable
                disabled={requestBusy}
                onPress={() => void handleMessageRequestDecision('accept')}
                style={styles.smallPrimary}
              >
                <Text style={styles.smallPrimaryText}>Chấp nhận</Text>
              </Pressable>
              <Pressable
                disabled={requestBusy}
                onPress={() => void handleMessageRequestDecision('reject')}
                style={styles.smallSecondary}
              >
                <Text style={styles.smallSecondaryText}>Xóa tin nhắn chờ</Text>
              </Pressable>
            </View>
          </View>
        )}
      <ChatComposer
        ref={composerRef}
        sending={sending}
        recording={recording}
        recordingMs={recordingMs}
        replyTo={replyTo}
        editing={editing}
        replyContextTitle={
          editing
            ? 'Chỉnh sửa tin nhắn'
            : replyTo
              ? `Trả lời ${memberName(replyTo.senderId)}`
              : undefined
        }
        contextPreview={
          editing || replyTo ? messageLabel(editing ?? replyTo!) : undefined
        }
        onCancelContext={() => {
          setReplyTo(undefined);
          setEditing(undefined);
        }}
        onSend={send}
        onTypingChange={updateTyping}
        onClearError={() => setError('')}
        onOpenMediaMenu={showMediaMenu}
        onStartRecording={() => void startRecording().catch(fail)}
        onFinishRecording={sendRec => void finishRecording(sendRec)}
        onBeforeSendScroll={() => {
          setShowScrollDown(false);
          messageList.current?.scrollToOffset({ offset: 0, animated: true });
        }}
      />

      <Modal
        animationType="fade"
        transparent
        visible={!!actionTarget}
        onRequestClose={() => setActionTarget(undefined)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setActionTarget(undefined)}
        >
          <Pressable style={styles.sheetCard} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            {actionTarget && (
              <>
                <View style={styles.reactionPicker}>
                  {['👍', '❤️', '😂', '😮', '😢', '😡'].map(emoji => {
                    const active = !!reactions[actionTarget.id]?.some(
                      item => item.emoji === emoji && item.reacted,
                    );
                    return (
                      <Pressable
                        key={emoji}
                        accessibilityHint={
                          active
                            ? 'Nhấn để gỡ cảm xúc này'
                            : 'Nhấn để bày tỏ cảm xúc'
                        }
                        accessibilityLabel={`Bày tỏ ${emoji}`}
                        accessibilityState={{ selected: active }}
                        onPress={() => void react(actionTarget.id, emoji)}
                        style={({ pressed }) => [
                          styles.reactionOption,
                          active && styles.reactionOptionActive,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.reactionEmoji}>{emoji}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text numberOfLines={2} style={styles.sheetSubtitle}>
                  {messageLabel(actionTarget)}
                </Text>
                <Pressable
                  onPress={() => startReply(actionTarget)}
                  style={styles.sheetOption}
                >
                  <View style={styles.sheetOptionIcon}>
                    <Text style={styles.sheetOptionIconText}>↩</Text>
                  </View>
                  <Text style={styles.sheetOptionText}>Trả lời tin nhắn</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const target = actionTarget;
                    setActionTarget(undefined);
                    void togglePinMessage(target);
                  }}
                  style={styles.sheetOption}
                >
                  <View style={styles.sheetOptionIcon}>
                    <UiGlyph name="pin" color="#b75020" size={16} />
                  </View>
                  <Text style={styles.sheetOptionText}>
                    {pins.some(p => p.id === actionTarget.id)
                      ? 'Bỏ ghim tin nhắn'
                      : 'Ghim tin nhắn'}
                  </Text>
                </Pressable>
                {actionTarget.type === 'voice' && (
                  <Pressable
                    onPress={() => {
                      const target = actionTarget;
                      setActionTarget(undefined);
                      void transcribeVoice(target);
                    }}
                    style={styles.sheetOption}
                  >
                    <View style={styles.sheetOptionIcon}>
                      <Text style={styles.sheetOptionIconText}>✦</Text>
                    </View>
                    <Text style={styles.sheetOptionText}>
                      Chép lời tin nhắn thoại với AI
                    </Text>
                  </Pressable>
                )}
                {actionTarget.senderId === user.id &&
                  actionTarget.type === 'text' && (
                    <Pressable
                      onPress={() => {
                        setEditing(actionTarget);
                        setReplyTo(undefined);
                        composerRef.current?.setDraft(actionTarget.body ?? '');
                        setActionTarget(undefined);
                        focusComposer();
                      }}
                      style={styles.sheetOption}
                    >
                      <View style={styles.sheetOptionIcon}>
                        <Text style={styles.sheetOptionIconText}>✎</Text>
                      </View>
                      <Text style={styles.sheetOptionText}>
                        Chỉnh sửa tin nhắn
                      </Text>
                    </Pressable>
                  )}
                {actionTarget.senderId === user.id && (
                  <Pressable
                    onPress={() => {
                      const target = actionTarget;
                      setActionTarget(undefined);
                      Alert.alert(
                        'Thu hồi tin nhắn?',
                        'Nội dung sẽ không còn hiển thị với các thành viên.',
                        [
                          { text: 'Hủy', style: 'cancel' },
                          {
                            text: 'Thu hồi',
                            style: 'destructive',
                            onPress: () =>
                              void api
                                .authenticated<{ message: api.Message }>(
                                  `/conversations/${conversation.id}/messages/${target.id}`,
                                  undefined,
                                  'DELETE',
                                )
                                .then(result => accept([result.message]))
                                .catch(fail),
                          },
                        ],
                      );
                    }}
                    style={styles.sheetOption}
                  >
                    <View
                      style={[
                        styles.sheetOptionIcon,
                        styles.sheetOptionIconDanger,
                      ]}
                    >
                      <Text
                        style={[
                          styles.sheetOptionIconText,
                          styles.sheetOptionIconTextDanger,
                        ]}
                      >
                        ×
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.sheetOptionText,
                        styles.sheetOptionTextDanger,
                      ]}
                    >
                      Thu hồi tin nhắn
                    </Text>
                  </Pressable>
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={mediaSheetOpen}
        onRequestClose={() => setMediaSheetOpen(false)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setMediaSheetOpen(false)}
        >
          <Pressable style={styles.sheetCard} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Đính kèm & chia sẻ</Text>
            <Text style={styles.sheetSubtitle}>
              Chọn nội dung bạn muốn gửi vào cuộc trò chuyện
            </Text>
            {[
              {
                icon: '🖼',
                label: 'Ảnh từ thư viện',
                act: () => void chooseImage().catch(fail),
              },
              {
                icon: '📎',
                label: 'Tệp đính kèm (tối đa 100 MB)',
                act: () => void chooseFile().catch(fail),
              },
              {
                icon: '🎮',
                label:
                  currentGame &&
                  (currentGame.status === 'invited' ||
                    currentGame.status === 'active')
                    ? 'Trò chơi trong chat (Đang chơi)'
                    : 'Trò chơi trong chat',
                act: () => setGameOpen(true),
              },
              {
                icon: '📍',
                label: 'Chia sẻ vị trí hiện tại',
                act: () => void shareLocation(),
              },
              {
                icon: '🎤',
                label: 'Ghi âm tin nhắn thoại',
                act: () => void startRecording().catch(fail),
              },
            ].map(option => (
              <Pressable
                key={option.label}
                onPress={() => {
                  setMediaSheetOpen(false);
                  option.act();
                }}
                style={styles.sheetOption}
              >
                <View style={styles.sheetOptionIcon}>
                  <Text style={styles.sheetOptionIconText}>{option.icon}</Text>
                </View>
                <Text style={styles.sheetOptionText}>{option.label}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={headerMenuOpen}
        onRequestClose={() => setHeaderMenuOpen(false)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setHeaderMenuOpen(false)}
        >
          <Pressable style={styles.sheetCard} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text numberOfLines={1} style={styles.sheetTitle}>
              {title}
            </Text>
            <Text style={styles.sheetSubtitle}>Tiện ích cuộc trò chuyện</Text>
            {[
              {
                icon: '⌕',
                label: 'Tìm trong cuộc trò chuyện',
                active: searchOpen,
                act: () => {
                  const next = !searchOpen;
                  setSearchOpen(next);
                  if (next) scheduleFocus(searchInputRef);
                  else setSearchQuery('');
                },
              },
              {
                icon: 'i',
                label: 'Thông tin cuộc trò chuyện',
                active: false,
                act: () => setInfoOpen(true),
              },
            ].map(option => (
              <Pressable
                key={option.label}
                onPress={() => {
                  setHeaderMenuOpen(false);
                  option.act();
                }}
                style={[
                  styles.sheetOption,
                  option.active && styles.sheetOptionActive,
                ]}
              >
                <View style={styles.sheetOptionIcon}>
                  <Text style={styles.sheetOptionIconText}>{option.icon}</Text>
                </View>
                <Text style={styles.sheetOptionText}>{option.label}</Text>
                {option.active && (
                  <Text style={styles.sheetOptionBadge}>Đang mở</Text>
                )}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
      <GameModal
        conversationId={conversation.id}
        isGroup={conversation.type === 'group'}
        names={memberName}
        onClose={() => setGameOpen(false)}
        onExpired={onExpired}
        onGameChange={setCurrentGame}
        userId={user.id}
        visible={gameOpen}
      />
    </KeyboardAvoidingView>
  );
}
