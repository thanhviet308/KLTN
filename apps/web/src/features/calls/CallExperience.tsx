import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalTrack, RemoteTrack, Room } from 'livekit-client';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import * as api from '../../lib/api';
import { acquireChatSocket } from '../../lib/realtime';
import { isEmbeddedInAppBrowser } from '../chat/location-helper';
import {
  extractMediaErrorInfo,
  formatCallMediaError,
  isOverconstrainedMediaError,
} from './call-media';
import { Avatar } from '../../components/Avatar';
import { startIncomingCallRingtone } from '../../lib/notification-sounds';
import type { Peer } from '../../lib/types';

type CallStatus =
  'ringing' | 'active' | 'ended' | 'rejected' | 'missed' | 'cancelled';

interface Call {
  id: string;
  conversationId: string;
  initiatorId: string;
  type: 'audio' | 'video';
  status: CallStatus;
  ringExpiresAt: string;
  participants: { userId: string; status: string }[];
}

interface CallResponse {
  call: Call;
}

interface TokenResponse {
  url: string;
  token: string;
  expiresAt: string;
  callType: 'audio' | 'video';
}

interface MediaTrack {
  key: string;
  track: RemoteTrack | LocalTrack;
  local: boolean;
  kind: 'audio' | 'video';
}

export interface CallConversationMeta {
  title: string;
  peer?: Peer | null;
}

export type StartCall = (
  conversationId: string,
  type: 'audio' | 'video',
) => Promise<void>;

function formatDuration(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function AttachedTrack({
  item,
  pipBottom,
  onTogglePipPosition,
}: {
  item: MediaTrack;
  pipBottom?: boolean;
  onTogglePipPosition?: () => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = item.track.attach();
    element.autoplay = true;
    if (element instanceof HTMLVideoElement) {
      element.playsInline = true;
      element.setAttribute('playsinline', '');
      element.setAttribute('webkit-playsinline', '');
      element.muted = item.local;
    }
    holder.current?.append(element);
    void element.play().catch(() => {});
    return () => {
      item.track.detach(element);
      element.remove();
    };
  }, [item]);
  return (
    <div
      className={`call-track ${item.kind}${item.local ? ' local' : ''}${item.local && pipBottom ? ' pip-bottom' : ''}`}
      ref={holder}
      onClick={item.local ? onTogglePipPosition : undefined}
      title={item.local ? 'Chạm để đổi vị trí khung hình của bạn' : undefined}
    />
  );
}

const terminal = new Set<CallStatus>([
  'ended',
  'rejected',
  'missed',
  'cancelled',
]);

function mediaEnvironment() {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  return {
    mediaSupported:
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function',
    secureContext:
      typeof window === 'undefined' ? true : window.isSecureContext,
    userAgent,
    embedded: isEmbeddedInAppBrowser(userAgent),
  };
}

function describeMediaFailure(
  callType: 'audio' | 'video',
  failure?: unknown,
  missingDevices?: ('microphone' | 'camera')[],
) {
  return formatCallMediaError({
    failure,
    missingDevices,
    callType,
    ...mediaEnvironment(),
  });
}

async function enableCameraTrack(localParticipant: Room['localParticipant']) {
  try {
    await localParticipant.setCameraEnabled(true);
  } catch (failure) {
    if (!isOverconstrainedMediaError(failure)) throw failure;
    await localParticipant.setCameraEnabled(true, {
      facingMode: 'user',
      resolution: { width: 640, height: 480, frameRate: 24 },
    });
  }
}

function callErrorMessage(
  failure: unknown,
  callType: 'audio' | 'video' = 'video',
) {
  if (failure instanceof api.ApiError) return api.errorMessage(failure);
  const { name, message } = extractMediaErrorInfo(failure);
  const detail = `${name} ${message}`.toLowerCase();
  if (
    name === 'ConnectionError' ||
    detail.includes('signal') ||
    detail.includes('websocket') ||
    detail.includes('unauthorized') ||
    detail.includes('401') ||
    detail.includes('livekit') ||
    (detail.includes('connect') && !detail.includes('disconnect'))
  ) {
    return 'Không thể kết nối LiveKit. Hãy kiểm tra URL, API key và API secret có thuộc cùng một project.';
  }
  return describeMediaFailure(callType, failure);
}

export function CallExperience({
  user,
  onExpired,
  registerStart,
  conversationMeta = {},
}: {
  user: api.User;
  onExpired: () => void;
  registerStart: (start: StartCall | undefined) => void;
  conversationMeta?: Record<string, CallConversationMeta>;
}) {
  const [call, setCall] = useState<Call>();
  const [room, setRoom] = useState<Room>();
  const [tracks, setTracks] = useState<MediaTrack[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [microphone, setMicrophone] = useState(true);
  const [camera, setCamera] = useState(true);
  const [pipBottom, setPipBottom] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const currentCall = useRef<Call | undefined>(undefined);
  const roomRef = useRef<Room | undefined>(undefined);

  useEffect(() => {
    if (!room) {
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [room]);

  const closeMedia = useCallback(async () => {
    const activeRoom = roomRef.current;
    roomRef.current = undefined;
    setRoom(undefined);
    setTracks([]);
    if (activeRoom) await activeRoom.disconnect();
  }, []);

  const connectMedia = useCallback(async (next: Call) => {
    const { Room, RoomEvent, Track } = await import('livekit-client');
    const credentials = await api.authenticated<TokenResponse>(
      `/calls/${next.id}/token`,
      {},
    );
    const mediaRoom = new Room({
      adaptiveStream: true,
      dynacast: true,
      disconnectOnPageLeave: true,
    });
    const syncTracks = () => {
      const values: MediaTrack[] = [];
      for (const publication of mediaRoom.localParticipant.trackPublications.values())
        if (publication.track?.kind === Track.Kind.Video)
          values.push({
            key: `local:${publication.trackSid}`,
            track: publication.track,
            local: true,
            kind: 'video',
          });
      for (const participant of mediaRoom.remoteParticipants.values())
        for (const publication of participant.trackPublications.values())
          if (publication.track)
            values.push({
              key: `remote:${participant.identity}:${publication.trackSid}`,
              track: publication.track,
              local: false,
              kind:
                publication.track.kind === Track.Kind.Video ? 'video' : 'audio',
            });
      setTracks(values);
    };
    mediaRoom.on(RoomEvent.TrackSubscribed, syncTracks);
    mediaRoom.on(RoomEvent.TrackUnsubscribed, syncTracks);
    mediaRoom.on(RoomEvent.LocalTrackPublished, syncTracks);
    mediaRoom.on(RoomEvent.LocalTrackUnpublished, syncTracks);
    mediaRoom.on(RoomEvent.Disconnected, () => {
      if (roomRef.current === mediaRoom) roomRef.current = undefined;
      setTracks([]);
      setRoom((active) => (active === mediaRoom ? undefined : active));
    });
    roomRef.current = mediaRoom;
    try {
      await mediaRoom.connect(credentials.url, credentials.token);
    } catch (failure) {
      if (roomRef.current === mediaRoom) roomRef.current = undefined;
      await mediaRoom.disconnect();
      throw failure;
    }
    setRoom(mediaRoom);
    syncTracks();
    await mediaRoom.startAudio().catch(() => {});
    if (!mediaEnvironment().mediaSupported) {
      setMicrophone(false);
      setCamera(false);
      const missing: ('microphone' | 'camera')[] =
        credentials.callType === 'video'
          ? ['microphone', 'camera']
          : ['microphone'];
      setError(describeMediaFailure(credentials.callType, undefined, missing));
      syncTracks();
      return;
    }
    const unavailable: ('microphone' | 'camera')[] = [];
    let lastMediaFailure: unknown;
    if (credentials.callType === 'video') {
      let combinedSucceeded = false;
      try {
        await mediaRoom.localParticipant.enableCameraAndMicrophone();
        combinedSucceeded = true;
        setMicrophone(true);
        setCamera(true);
      } catch (failure) {
        lastMediaFailure = failure;
      }
      if (!combinedSucceeded) {
        try {
          await mediaRoom.localParticipant.setMicrophoneEnabled(true);
          setMicrophone(true);
        } catch (failure) {
          lastMediaFailure = failure;
          setMicrophone(false);
          unavailable.push('microphone');
        }
        try {
          await enableCameraTrack(mediaRoom.localParticipant);
          setCamera(true);
        } catch (failure) {
          lastMediaFailure = failure;
          setCamera(false);
          unavailable.push('camera');
        }
      }
    } else {
      setCamera(false);
      try {
        await mediaRoom.localParticipant.setMicrophoneEnabled(true);
        setMicrophone(true);
      } catch (failure) {
        lastMediaFailure = failure;
        setMicrophone(false);
        unavailable.push('microphone');
      }
    }
    syncTracks();
    if (unavailable.length)
      setError(
        describeMediaFailure(
          credentials.callType,
          lastMediaFailure,
          unavailable,
        ),
      );
  }, []);

  const start = useCallback<StartCall>(
    async (conversationId, type) => {
      if (currentCall.current && !terminal.has(currentCall.current.status)) {
        setError('Bạn đang có một cuộc gọi khác.');
        return;
      }
      setBusy(true);
      setError('');
      try {
        const result = await api.authenticated<CallResponse>(
          `/conversations/${conversationId}/calls`,
          { clientRequestId: crypto.randomUUID(), type },
        );
        currentCall.current = result.call;
        setCall(result.call);
        await connectMedia(result.call);
      } catch (failure) {
        if (
          failure instanceof api.ApiError &&
          failure.code === 'CALL_ALREADY_OPEN'
        ) {
          try {
            const history = await api.authenticated<{
              items: Call[];
              nextCursor: string | null;
            }>('/calls?limit=20');
            const open = history.items.find(
              (item) =>
                item.conversationId === conversationId &&
                ['ringing', 'active'].includes(item.status),
            );
            if (open) {
              currentCall.current = open;
              setCall(open);
              setError('');
              return;
            }
          } catch {
            // Preserve the original conflict when recovery cannot load state.
          }
        }
        setError(callErrorMessage(failure));
      } finally {
        setBusy(false);
      }
    },
    [connectMedia],
  );

  useEffect(() => {
    registerStart(start);
    return () => registerStart(undefined);
  }, [registerStart, start]);

  useEffect(() => {
    let disposed = false;
    let syncingCalls = false;
    const hub = acquireChatSocket(user.id);
    const client = hub.socket;
    const receive = (event: CallResponse, incoming: boolean) => {
      if (disposed) return;
      const next = event.call;
      if (incoming && next.initiatorId === user.id) return;
      if (
        !currentCall.current ||
        currentCall.current.id === next.id ||
        terminal.has(currentCall.current.status)
      ) {
        currentCall.current = next;
        setCall(next);
        if (terminal.has(next.status)) void closeMedia();
      }
    };
    const onIncoming = (event: CallResponse) => receive(event, true);
    const onUpdated = (event: CallResponse) => receive(event, false);
    const syncCalls = async () => {
      if (disposed || syncingCalls) return;
      syncingCalls = true;
      try {
        const history = await api.authenticated<{
          items: Call[];
          nextCursor: string | null;
        }>('/calls?limit=20');
        if (disposed) return;
        const pending = history.items.find(
          (item) =>
            ['ringing', 'active'].includes(item.status) &&
            item.participants.some(
              (participant) =>
                participant.userId === user.id &&
                ['invited', 'accepted', 'joined'].includes(participant.status),
            ),
        );
        if (pending && !currentCall.current) {
          currentCall.current = pending;
          setCall(pending);
        }
      } catch (failure) {
        if (failure instanceof api.ApiError && failure.status === 401)
          onExpired();
      } finally {
        syncingCalls = false;
      }
    };
    const onConnect = () => {
      void syncCalls();
    };
    client.on('call:incoming', onIncoming);
    client.on('call:updated', onUpdated);
    client.on('connect', onConnect);
    void syncCalls();
    return () => {
      disposed = true;
      client.off('call:incoming', onIncoming);
      client.off('call:updated', onUpdated);
      client.off('connect', onConnect);
      hub.release();
    };
  }, [closeMedia, onExpired, user.id]);

  async function transition(action: 'accept' | 'reject' | 'leave' | 'end') {
    if (!call || busy) return;
    setBusy(true);
    setError('');
    if (action !== 'accept') {
      const ending = call;
      currentCall.current = undefined;
      setCall(undefined);
      await closeMedia();
      try {
        await api.authenticated<CallResponse>(
          `/calls/${ending.id}/${action}`,
          {},
        );
      } catch (failure) {
        currentCall.current = ending;
        setCall(ending);
        setError(
          `${callErrorMessage(failure)} Cuộc gọi chưa được kết thúc trên máy chủ, hãy thử lại.`,
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      const result = await api.authenticated<CallResponse>(
        `/calls/${call.id}/${action}`,
        {},
      );
      currentCall.current = result.call;
      setCall(result.call);
      await connectMedia(result.call);
    } catch (failure) {
      setError(callErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function toggleMicrophone() {
    if (!room) return;
    const enabled = !microphone;
    if (enabled && !mediaEnvironment().mediaSupported) {
      setMicrophone(false);
      setError(
        describeMediaFailure(call?.type ?? 'audio', undefined, ['microphone']),
      );
      return;
    }
    try {
      await room.localParticipant.setMicrophoneEnabled(enabled);
      if (enabled) void room.startAudio().catch(() => {});
      setMicrophone(enabled);
      setError('');
    } catch (failure) {
      setMicrophone(false);
      setError(
        describeMediaFailure(call?.type ?? 'audio', failure, ['microphone']),
      );
    }
  }

  async function toggleCamera() {
    if (!room || call?.type !== 'video') return;
    const enabled = !camera;
    if (enabled && !mediaEnvironment().mediaSupported) {
      setCamera(false);
      setError(describeMediaFailure('video', undefined, ['camera']));
      return;
    }
    try {
      if (enabled) await enableCameraTrack(room.localParticipant);
      else await room.localParticipant.setCameraEnabled(false);
      setCamera(enabled);
      setError('');
    } catch (failure) {
      setCamera(false);
      setError(describeMediaFailure('video', failure, ['camera']));
    }
  }

  async function rejoin() {
    if (!call || busy) return;
    setBusy(true);
    setError('');
    try {
      await connectMedia(call);
    } catch (failure) {
      setError(callErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!call || call.status !== 'ringing') return;
    const delay = Math.max(0, Date.parse(call.ringExpiresAt) - Date.now() + 50);
    const timer = window.setTimeout(() => {
      void api
        .authenticated<CallResponse>(`/calls/${call.id}`)
        .then((result) => {
          currentCall.current = result.call;
          setCall(result.call);
          if (terminal.has(result.call.status)) void closeMedia();
        })
        .catch(() => {});
    }, delay);
    return () => window.clearTimeout(timer);
  }, [call, closeMedia]);

  const incoming =
    call?.status === 'ringing' && call.initiatorId !== user.id && !room;
  useEffect(() => {
    if (!incoming) return;
    return startIncomingCallRingtone();
  }, [incoming, call?.id]);

  if (!call || terminal.has(call.status))
    return error ? (
      <div className="call-error-toast" role="alert">
        <span>{error}</span>
        <button type="button" onClick={() => setError('')}>
          Đóng
        </button>
      </div>
    ) : null;

  const remoteVideoCount = tracks.filter(
    (item) => item.kind === 'video' && !item.local,
  ).length;
  const hasAnyVideo = tracks.some((item) => item.track.kind === 'video');
  const meta = conversationMeta[call.conversationId];
  const callTitle =
    meta?.title ||
    (incoming
      ? `Cuộc gọi ${call.type === 'video' ? 'video' : 'thoại'} đến`
      : call.type === 'video'
        ? 'Cuộc gọi video'
        : 'Cuộc gọi thoại');
  const avatarPeer: Pick<Peer, 'displayName' | 'avatarUrl'> = meta?.peer ?? {
    displayName: callTitle,
  };
  const statusSubtitle = room
    ? `${call.type === 'video' ? 'Video' : 'Thoại'} · ${formatDuration(elapsedSeconds)}`
    : incoming
      ? `Cuộc gọi ${call.type === 'video' ? 'video' : 'thoại'} đến…`
      : 'Đang đổ chuông…';

  return (
    <div className="call-overlay" role="dialog" aria-modal="true">
      <section
        className={`call-window${room ? ' connected' : ' ringing'}${call.type === 'video' ? ' video-mode' : ' audio-mode'}${remoteVideoCount > 0 ? ' has-remote-video' : ''}`}
      >
        <header className="call-topbar">
          <div className="call-peer-pill">
            <span className="call-peer-avatar" aria-hidden="true">
              <Avatar peer={avatarPeer} />
            </span>
            <div className="call-peer-copy">
              <strong>{callTitle}</strong>
              <small>
                {room && <span className="call-live-dot" aria-hidden="true" />}
                {statusSubtitle}
              </small>
            </div>
          </div>
        </header>

        {error && <p className="message error call-inline-error">{error}</p>}

        {room ? (
          <div
            className={`call-stage${call.type === 'audio' ? ' audio' : ''}${call.type === 'video' && remoteVideoCount <= 1 ? ' one-to-one' : ''}${remoteVideoCount ? ' has-remote' : ''}`}
          >
            {tracks.map((item) => (
              <AttachedTrack
                key={item.key}
                item={item}
                pipBottom={pipBottom}
                onTogglePipPosition={() => setPipBottom((prev) => !prev)}
              />
            ))}
            {(call.type === 'audio' ||
              !hasAnyVideo ||
              remoteVideoCount === 0) && (
              <div className="call-hero-center">
                <div className="call-avatar-pulse">
                  <span className="call-avatar-xl" aria-hidden="true">
                    <Avatar peer={avatarPeer} />
                  </span>
                </div>
                <strong className="call-hero-name">{callTitle}</strong>
                <span className="call-hero-status">
                  {call.status === 'ringing'
                    ? 'Đang chờ người nhận trả lời…'
                    : formatDuration(elapsedSeconds)}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="call-stage call-waiting-stage">
            <div className="call-hero-center">
              <div className="call-avatar-pulse is-ringing">
                <span className="call-avatar-xl" aria-hidden="true">
                  <Avatar peer={avatarPeer} />
                </span>
              </div>
              <strong className="call-hero-name">{callTitle}</strong>
              <span className="call-hero-status">
                {incoming
                  ? `Đang gọi ${call.type === 'video' ? 'video' : 'thoại'} cho bạn…`
                  : 'Đang kết nối cuộc gọi…'}
              </span>
            </div>
          </div>
        )}

        <footer className="call-controls">
          <div className="call-controls-dock">
            {incoming ? (
              <>
                <button
                  className="call-control reject"
                  disabled={busy}
                  onClick={() => void transition('reject')}
                  aria-label="Từ chối cuộc gọi"
                  title="Từ chối"
                >
                  <PhoneOff size={24} />
                </button>
                <button
                  className="call-control accept"
                  disabled={busy}
                  onClick={() => void transition('accept')}
                  aria-label="Nhận cuộc gọi"
                  title="Nhận cuộc gọi"
                >
                  <Phone size={24} />
                </button>
              </>
            ) : (
              <>
                {!room && call.status === 'active' && (
                  <button
                    className="call-control accept rejoin"
                    disabled={busy}
                    onClick={() => void rejoin()}
                  >
                    Tham gia lại
                  </button>
                )}
                <button
                  className={`call-control${microphone ? '' : ' is-muted'}`}
                  disabled={!room || busy}
                  onClick={() => void toggleMicrophone()}
                  aria-label={microphone ? 'Tắt mic' : 'Bật mic'}
                  title={microphone ? 'Tắt mic' : 'Bật mic'}
                >
                  {microphone ? <Mic size={22} /> : <MicOff size={22} />}
                </button>
                {call.type === 'video' && (
                  <button
                    className={`call-control${camera ? '' : ' is-muted'}`}
                    disabled={!room || busy}
                    onClick={() => void toggleCamera()}
                    aria-label={camera ? 'Tắt camera' : 'Bật camera'}
                    title={camera ? 'Tắt camera' : 'Bật camera'}
                  >
                    {camera ? <Video size={22} /> : <VideoOff size={22} />}
                  </button>
                )}
                <button
                  className="call-control reject"
                  disabled={busy}
                  onClick={() =>
                    void transition(
                      call.initiatorId === user.id ? 'end' : 'leave',
                    )
                  }
                  aria-label="Kết thúc cuộc gọi"
                  title="Kết thúc"
                >
                  <PhoneOff size={22} />
                </button>
              </>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
