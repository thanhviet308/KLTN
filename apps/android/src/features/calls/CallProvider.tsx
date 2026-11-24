import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  AppState,
  PermissionsAndroid,
  Platform,
  Vibration,
  type Permission,
} from 'react-native';
import Sound from 'react-native-nitro-sound';
import * as api from '../../api';
import { acquireChatSocket } from '../../realtime';
import { clientMessageId } from '../../utils';
import { AudioRoute } from './audio-route';
import {
  applyCall,
  canJoin,
  hangupAction,
  isInvited,
  isOpen,
  type Call,
  type CallType,
} from './call-model';
import { CallScreen } from './CallScreen';
import {
  WebRtcRoom,
  type CallConnectionState,
  type MediaCredentials,
} from './webrtc-room';

interface CallResponse {
  call: Call;
  media?: MediaCredentials;
}
type StartCall = (conversation: api.Conversation, type: CallType) => void;
const CallContext = createContext<{ start: StartCall; busy: boolean }>({
  start: () => {},
  busy: false,
});
export const useCalls = () => useContext(CallContext);

async function permissions(type: CallType) {
  if (Platform.OS !== 'android') return;
  const required: Permission[] = [PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
  if (type === 'video') required.push(PermissionsAndroid.PERMISSIONS.CAMERA);
  const result = await PermissionsAndroid.requestMultiple(required);
  if (
    required.some(
      permission => result[permission] !== PermissionsAndroid.RESULTS.GRANTED,
    )
  ) {
    throw new Error(
      'Hãy cấp quyền micro' +
        (type === 'video' ? ' và camera' : '') +
        ' trong cài đặt để tham gia cuộc gọi.',
    );
  }
}

function failureMessage(error: unknown) {
  if (error instanceof api.ApiError) {
    if (error.code === 'CALL_ALREADY_OPEN')
      return 'Cuộc trò chuyện đang có cuộc gọi. Hãy thử lại sau.';
    if (error.status === 0) return 'Mất kết nối mạng. Vui lòng thử lại.';
    if (error.status === 409)
      return 'Trạng thái cuộc gọi đã thay đổi. Hãy thử lại.';
    return 'Không thể xử lý cuộc gọi. Vui lòng thử lại.';
  }
  return error instanceof Error ? error.message : 'Không thể kết nối cuộc gọi.';
}

export function CallProvider({
  user,
  onExpired,
  children,
}: {
  user: api.User;
  onExpired: () => void;
  children: React.ReactNode;
}) {
  const [call, setCall] = useState<Call>();
  const [room, setRoom] = useState<WebRtcRoom>();
  const [connection, setConnection] =
    useState<CallConnectionState>('disconnected');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('Cuộc gọi');
  const current = useRef<Call | undefined>(undefined);
  const media = useRef<WebRtcRoom | undefined>(undefined);
  const mediaSocketRelease = useRef<(() => void) | undefined>(undefined);
  const operation = useRef<symbol | undefined>(undefined);
  const ending = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const closed = useRef(new Set<string>());
  const cleanup = useRef(Promise.resolve());
  const titleConversationRef = useRef<string | undefined>(undefined);

  const prepareAudio = useCallback(async () => {
    await Promise.allSettled([Sound.stopRecorder(), Sound.stopPlayer()]);
  }, []);

  const closeMedia = useCallback(async (forceStopAudio = true) => {
    generation.current++;
    const old = media.current;
    media.current = undefined;
    const releaseSocket = mediaSocketRelease.current;
    mediaSocketRelease.current = undefined;
    if (alive.current) {
      setRoom(undefined);
      setConnection('disconnected');
    }
    if (!old && !forceStopAudio) {
      releaseSocket?.();
      await cleanup.current;
      return;
    }
    // Serialize cleanup so a late disconnect cannot stop the next call's audio.
    cleanup.current = cleanup.current
      .then(async () => {
        try {
          await old?.disconnect();
        } finally {
          releaseSocket?.();
          await AudioRoute.stop();
        }
      })
      .catch(() => {});
    await cleanup.current;
  }, []);

  const receive = useCallback(
    (next: Call) => {
      if (!alive.current) return;
      if (closed.current.has(next.id) && isOpen(next)) return;
      const previous = current.current;
      if (!isOpen(next)) {
        closed.current.add(next.id);
        if (closed.current.size > 100) {
          const oldest = closed.current.values().next().value;
          if (oldest) closed.current.delete(oldest);
        }
        if (previous?.id !== next.id) return;
      }
      const accepted = applyCall(previous, next);
      if (accepted === previous) return;
      // An unrelated terminal event should not produce a call dialog.
      if (!previous && !isOpen(accepted)) return;
      current.current = accepted;
      setCall(accepted);
      if (
        !isOpen(accepted) ||
        (!isInvited(accepted, user.id) && !canJoin(accepted, user.id))
      ) {
        void closeMedia();
      }
    },
    [closeMedia, user.id],
  );

  const connectMedia = useCallback(
    async (
      next: Call,
      initialMedia?: MediaCredentials,
      audioPreparation?: Promise<void>,
    ) => {
      await closeMedia(false);
      const attempt = generation.current;
      const valid = () =>
        alive.current &&
        generation.current === attempt &&
        current.current?.id === next.id &&
        canJoin(current.current, user.id);
      if (!valid()) return;
      // Prepare audio while fetching ICE config (or reuse bundled config).
      const [credentials, audio] = await Promise.allSettled([
        initialMedia
          ? Promise.resolve(initialMedia)
          : api.authenticated<MediaCredentials>(`/calls/${next.id}/token`, {}),
        audioPreparation ?? prepareAudio(),
      ]);
      if (!valid()) return;
      if (credentials.status === 'rejected') throw credentials.reason;
      if (audio.status === 'rejected') throw audio.reason;
      const signalingSocket = acquireChatSocket(onExpired);
      mediaSocketRelease.current = signalingSocket.release;
      const activeRoom = new WebRtcRoom(
        signalingSocket,
        next.id,
        user.id,
        credentials.value.iceServers ?? [],
      );
      media.current = activeRoom;
      activeRoom.onConnectionStateChange(state => {
        if (valid()) setConnection(state);
      });
      activeRoom.onDisconnected(() => {
        if (valid()) {
          setRoom(undefined);
          setError(
            'Đã ngắt kết nối âm thanh/video. Bạn có thể kết nối lại hoặc kết thúc cuộc gọi.',
          );
          void AudioRoute.stop();
        }
      });
      try {
        await AudioRoute.start(next.type === 'video' ? 'speaker' : 'earpiece');
        if (!valid()) {
          await AudioRoute.stop();
          return;
        }
        await activeRoom.connect();
        if (!valid()) {
          await activeRoom.disconnect();
          return;
        }
        setConnection(activeRoom.state);
        if (activeRoom.state === 'connected') {
          setRoom(activeRoom);
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const mediaTasks: Promise<unknown>[] = [
            activeRoom.setMicrophoneEnabled(true),
          ];
          if (next.type === 'video') {
            mediaTasks.push(activeRoom.setCameraEnabled(true));
          }
          await Promise.race([
            Promise.all(mediaTasks),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                reject(
                  new Error(
                    'Không thể bật micro hoặc camera kịp thời. Hãy thử kết nối lại.',
                  ),
                );
              }, 15000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        if (!valid()) {
          await activeRoom.disconnect();
          return;
        }
        if (activeRoom.state !== 'connected')
          throw new Error(
            'Kết nối âm thanh/video đã bị ngắt. Hãy thử kết nối lại.',
          );
        setRoom(activeRoom);
        setConnection(activeRoom.state);
      } catch (failure) {
        if (generation.current === attempt) void closeMedia();
        throw failure;
      }
    },
    [closeMedia, onExpired, prepareAudio, user.id],
  );

  const run = useCallback(
    async (work: () => Promise<void>, interrupt = false) => {
      if (operation.current && !interrupt) return;
      const id = Symbol();
      operation.current = id;
      setBusy(true);
      setError('');
      try {
        await work();
      } catch (failure) {
        if (alive.current && operation.current === id) {
          setError(failureMessage(failure));
          if (failure instanceof api.ApiError && failure.status === 401)
            onExpired();
        }
      } finally {
        if (operation.current === id) {
          operation.current = undefined;
          if (alive.current) setBusy(false);
        }
      }
    },
    [onExpired],
  );

  const start: StartCall = useCallback(
    (conversation, type) => {
      if (current.current && isOpen(current.current)) return;
      const knownTitle =
        conversation.peer?.displayName ?? conversation.title ?? 'Cuộc gọi';
      titleConversationRef.current = conversation.id;
      setTitle(knownTitle);
      void run(async () => {
        await permissions(type);
        if (!alive.current || (current.current && isOpen(current.current)))
          return;
        const audioPrep = prepareAudio();
        const result = await api.authenticated<CallResponse>(
          `/conversations/${conversation.id}/calls`,
          { type, clientRequestId: clientMessageId() },
        );
        if (
          !alive.current ||
          (current.current &&
            isOpen(current.current) &&
            current.current.id !== result.call.id)
        ) {
          void audioPrep.catch(() => {});
          await api.authenticated(`/calls/${result.call.id}/end`, {});
          return;
        }
        receive(result.call);
        await connectMedia(result.call, result.media, audioPrep);
      });
    },
    [connectMedia, prepareAudio, receive, run],
  );

  const join = () =>
    run(async () => {
      const next = current.current;
      if (!next || !isOpen(next)) return;
      // Ask before accepting, so denied permissions do not accept the remote call.
      await permissions(next.type);
      if (
        !alive.current ||
        current.current?.id !== next.id ||
        !isOpen(current.current)
      )
        return;
      const audioPrep = prepareAudio();
      const result = isInvited(current.current, user.id)
        ? await api.authenticated<CallResponse>(`/calls/${next.id}/accept`, {})
        : await api.authenticated<CallResponse>(`/calls/${next.id}`);
      if (!alive.current) {
        void audioPrep.catch(() => {});
        if (canJoin(result.call, user.id)) {
          await api.authenticated(`/calls/${next.id}/leave`, {});
        }
        return;
      }
      receive(result.call);
      if (canJoin(result.call, user.id))
        await connectMedia(result.call, result.media, audioPrep);
    });

  const hangup = async () => {
    if (ending.current || (operation.current && !media.current)) return;
    ending.current = true;
    try {
      await run(async () => {
        const next = current.current;
        if (!next) return;
        // Release hardware immediately; retain server state if the request fails.
        void closeMedia();
        const result = await api.authenticated<CallResponse>(
          `/calls/${next.id}/${hangupAction(next, user.id)}`,
          {},
        );
        receive(result.call);
        if (alive.current && current.current?.id === next.id) {
          current.current = undefined;
          setCall(undefined);
        }
      }, true);
    } finally {
      ending.current = false;
    }
  };

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let syncing = false;
    const socket = acquireChatSocket(onExpired);
    async function sync() {
      if (disposed || syncing || AppState.currentState !== 'active') return;
      syncing = true;
      try {
        if (!socket.isConnected()) {
          void socket.connect();
        }
        const snapshot = current.current;
        if (snapshot && isOpen(snapshot)) {
          const response = await api.authenticated<CallResponse>(
            `/calls/${snapshot.id}`,
          );
          if (!disposed && current.current?.id === snapshot.id)
            receive(response.call);
        } else {
          const page =
            await api.authenticated<api.Page<Call>>('/calls?limit=50');
          if (disposed || (current.current && isOpen(current.current))) return;
          const pending = page.items.find(
            item => isInvited(item, user.id) || canJoin(item, user.id),
          );
          if (pending) receive(pending);
        }
      } catch (failure) {
        if (
          !disposed &&
          failure instanceof api.ApiError &&
          failure.status === 401
        )
          onExpired();
      } finally {
        syncing = false;
      }
    }
    const offIncoming = socket.on('call:incoming', (event: CallResponse) =>
      receive(event.call),
    );
    const offUpdated = socket.on('call:updated', (event: CallResponse) =>
      receive(event.call),
    );
    const offConnect = socket.on('connect', () => {
      void sync();
    });
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      const hasOpenCall = !!current.current && isOpen(current.current);
      if (!socket.isConnected() || hasOpenCall) {
        void sync();
      }
    }, 8000);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void sync();
    });
    void sync();
    return () => {
      disposed = true;
      alive.current = false;
      clearInterval(timer);
      listener.remove();
      offIncoming();
      offUpdated();
      offConnect();
      socket.release();
      const next = current.current;
      if (next && canJoin(next, user.id)) {
        void api.authenticated(`/calls/${next.id}/leave`, {}).catch(() => {});
      }
      void closeMedia(false);
    };
  }, [closeMedia, onExpired, receive, user.id]);

  const conversationId = call?.conversationId;
  useEffect(() => {
    if (!conversationId) {
      titleConversationRef.current = undefined;
      return;
    }
    if (titleConversationRef.current === conversationId) return;
    let disposed = false;
    void Promise.all([
      api.authenticated<{ conversation: api.Conversation }>(
        `/conversations/${conversationId}`,
      ),
      api.authenticated<api.Page<{ user: api.User }>>(
        `/conversations/${conversationId}/members?limit=100`,
      ),
    ])
      .then(([{ conversation }, members]) => {
        if (!disposed) {
          titleConversationRef.current = conversationId;
          setTitle(
            conversation.type === 'group'
              ? (conversation.title ?? 'Cuộc gọi nhóm')
              : (members.items.find(member => member.user.id !== user.id)?.user
                  .displayName ?? 'Cuộc gọi'),
          );
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [conversationId, user.id]);

  const incoming = !!call && isInvited(call, user.id);
  useEffect(() => {
    if (!incoming) return;
    Vibration.vibrate([0, 500, 1000], true);
    return () => Vibration.cancel();
  }, [incoming, call?.id]);

  const dismiss = () => {
    if (
      call &&
      isOpen(call) &&
      (canJoin(call, user.id) || isInvited(call, user.id))
    )
      return;
    current.current = undefined;
    setCall(undefined);
    setError('');
  };

  return (
    <CallContext.Provider
      value={{ start, busy: busy || (!!call && isOpen(call)) }}
    >
      {children}
      <CallScreen
        call={call}
        room={room}
        title={title}
        incoming={incoming}
        busy={busy}
        canHangupWhileBusy={connection !== 'disconnected' && !ending.current}
        connection={connection}
        error={error}
        onJoin={() => {
          void join();
        }}
        onHangup={() => {
          void hangup();
        }}
        onDismiss={dismiss}
      />
    </CallContext.Provider>
  );
}
