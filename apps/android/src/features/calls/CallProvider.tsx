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
import { AudioSession, AndroidAudioTypePresets } from '@livekit/react-native';
import { ConnectionState, Room, RoomEvent } from 'livekit-client';
import { io } from 'socket.io-client';
import Sound from 'react-native-nitro-sound';
import * as api from '../../api';
import { clientMessageId } from '../../utils';
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

interface CallResponse {
  call: Call;
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
    if (error.code === 'LIVEKIT_NOT_CONFIGURED')
      return 'Máy chủ chưa được cấu hình gọi thoại/video.';
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
  const [room, setRoom] = useState<Room>();
  const [connection, setConnection] = useState(ConnectionState.Disconnected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('Cuộc gọi');
  const current = useRef<Call | undefined>(undefined);
  const media = useRef<Room | undefined>(undefined);
  const locked = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const closed = useRef(new Set<string>());
  const cleanup = useRef(Promise.resolve());

  const closeMedia = useCallback(async () => {
    generation.current++;
    const old = media.current;
    media.current = undefined;
    if (alive.current) {
      setRoom(undefined);
      setConnection(ConnectionState.Disconnected);
    }
    // Serialize cleanup so a late disconnect cannot stop the next call's audio.
    cleanup.current = cleanup.current
      .then(async () => {
        try {
          await old?.disconnect();
        } finally {
          await AudioSession.stopAudioSession();
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
    async (next: Call) => {
      await closeMedia();
      const attempt = generation.current;
      const valid = () =>
        alive.current &&
        generation.current === attempt &&
        current.current?.id === next.id &&
        canJoin(current.current, user.id);
      if (!valid()) return;
      // Voice messages and calls share the same microphone/audio focus.
      await Sound.stopRecorder().catch(() => undefined);
      await Sound.stopPlayer().catch(() => undefined);
      if (!valid()) return;
      const credentials = await api.authenticated<{
        url: string;
        token: string;
      }>(`/calls/${next.id}/token`, {});
      if (!valid()) return;
      const activeRoom = new Room({
        adaptiveStream: { pixelDensity: 'screen' },
        dynacast: true,
      });
      media.current = activeRoom;
      activeRoom.on(RoomEvent.ConnectionStateChanged, state => {
        if (valid()) setConnection(state);
      });
      activeRoom.on(RoomEvent.Disconnected, () => {
        if (valid()) {
          setRoom(undefined);
          setError(
            'Đã ngắt kết nối âm thanh/video. Bạn có thể kết nối lại hoặc kết thúc cuộc gọi.',
          );
          void AudioSession.stopAudioSession();
        }
      });
      try {
        await AudioSession.configureAudio({
          android: {
            audioTypeOptions: AndroidAudioTypePresets.communication,
            preferredOutputList:
              next.type === 'video'
                ? ['speaker', 'earpiece']
                : ['earpiece', 'speaker'],
          },
        });
        if (!valid()) return;
        await AudioSession.startAudioSession();
        if (!valid()) {
          await AudioSession.stopAudioSession();
          return;
        }
        await activeRoom.connect(credentials.url, credentials.token);
        if (!valid()) {
          await activeRoom.disconnect();
          return;
        }
        await activeRoom.localParticipant.setMicrophoneEnabled(true);
        if (!valid()) {
          await activeRoom.disconnect();
          return;
        }
        if (next.type === 'video')
          await activeRoom.localParticipant.setCameraEnabled(true);
        if (!valid()) {
          await activeRoom.disconnect();
          return;
        }
        setRoom(activeRoom);
        setConnection(activeRoom.state);
      } catch (failure) {
        if (generation.current === attempt) await closeMedia();
        else await activeRoom.disconnect();
        throw failure;
      }
    },
    [closeMedia, user.id],
  );

  const run = useCallback(
    async (work: () => Promise<void>) => {
      if (locked.current) return;
      locked.current = true;
      setBusy(true);
      setError('');
      try {
        await work();
      } catch (failure) {
        if (alive.current) {
          setError(failureMessage(failure));
          if (failure instanceof api.ApiError && failure.status === 401)
            onExpired();
        }
      } finally {
        locked.current = false;
        if (alive.current) setBusy(false);
      }
    },
    [onExpired],
  );

  const start: StartCall = useCallback(
    (conversation, type) => {
      if (current.current && isOpen(current.current)) return;
      setTitle(
        conversation.peer?.displayName ?? conversation.title ?? 'Cuộc gọi',
      );
      void run(async () => {
        await permissions(type);
        if (!alive.current || (current.current && isOpen(current.current)))
          return;
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
          await api.authenticated(`/calls/${result.call.id}/end`, {});
          return;
        }
        receive(result.call);
        await connectMedia(result.call);
      });
    },
    [connectMedia, receive, run],
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
      const result = isInvited(current.current, user.id)
        ? await api.authenticated<CallResponse>(`/calls/${next.id}/accept`, {})
        : await api.authenticated<CallResponse>(`/calls/${next.id}`);
      if (!alive.current) {
        if (canJoin(result.call, user.id)) {
          await api.authenticated(`/calls/${next.id}/leave`, {});
        }
        return;
      }
      receive(result.call);
      if (canJoin(result.call, user.id)) await connectMedia(result.call);
    });

  const hangup = () =>
    run(async () => {
      const next = current.current;
      if (!next) return;
      // Release hardware immediately; retain server state if the request fails.
      await closeMedia();
      const result = await api.authenticated<CallResponse>(
        `/calls/${next.id}/${hangupAction(next, user.id)}`,
        {},
      );
      receive(result.call);
      if (alive.current && current.current?.id === next.id) {
        current.current = undefined;
        setCall(undefined);
      }
    });

  useEffect(() => {
    alive.current = true;
    let disposed = false;
    let syncing = false;
    const client = io(`${api.API_ORIGIN}/chat`, {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
    });
    async function sync() {
      if (disposed || syncing || AppState.currentState !== 'active') return;
      syncing = true;
      try {
        if (!client.connected) {
          const token = await api.accessToken();
          if (disposed) return;
          client.auth = { accessToken: token };
          client.connect();
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
    client.on('call:incoming', (event: CallResponse) => receive(event.call));
    client.on('call:updated', (event: CallResponse) => receive(event.call));
    client.on('connect', () => {
      void sync();
    });
    const timer = setInterval(() => {
      void sync();
    }, 5000);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void sync();
    });
    void sync();
    return () => {
      disposed = true;
      alive.current = false;
      clearInterval(timer);
      listener.remove();
      client.removeAllListeners();
      client.disconnect();
      const next = current.current;
      if (next && canJoin(next, user.id)) {
        void api.authenticated(`/calls/${next.id}/leave`, {}).catch(() => {});
      }
      void closeMedia();
    };
  }, [closeMedia, onExpired, receive, user.id]);

  const conversationId = call?.conversationId;
  useEffect(() => {
    if (!conversationId) return;
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
        if (!disposed)
          setTitle(
            conversation.type === 'group'
              ? (conversation.title ?? 'Cuộc gọi nhóm')
              : (members.items.find(member => member.user.id !== user.id)?.user
                  .displayName ?? 'Cuộc gọi'),
          );
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
