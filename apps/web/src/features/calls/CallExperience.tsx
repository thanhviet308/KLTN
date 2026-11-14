import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalTrack, RemoteTrack, Room } from 'livekit-client';
import { io, type Socket } from 'socket.io-client';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from 'lucide-react';
import * as api from '../../lib/api';
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
      element.muted = item.local;
    }
    holder.current?.append(element);
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

function callErrorMessage(failure: unknown) {
  if (failure instanceof api.ApiError) return api.errorMessage(failure);
  if (failure instanceof DOMException) {
    if (failure.name === 'NotAllowedError')
      return 'Trình duyệt chưa được cấp quyền dùng microphone hoặc camera.';
    if (failure.name === 'NotFoundError')
      return 'Không tìm thấy microphone hoặc camera phù hợp trên thiết bị.';
    if (failure.name === 'NotReadableError')
      return 'Microphone hoặc camera đang được ứng dụng khác sử dụng.';
  }
  if (failure instanceof Error) {
    const detail = `${failure.name} ${failure.message}`.toLowerCase();
    if (
      detail.includes('signal') ||
      detail.includes('websocket') ||
      detail.includes('unauthorized') ||
      detail.includes('401') ||
      detail.includes('connect')
    )
      return 'Không thể kết nối LiveKit. Hãy kiểm tra URL, API key và API secret có thuộc cùng một project.';
  }
  return 'Không thể khởi tạo cuộc gọi. Vui lòng kiểm tra thiết bị và thử lại.';
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
  const socket = useRef<Socket | undefined>(undefined);
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
    const unavailable: string[] = [];
    try {
      await mediaRoom.localParticipant.setMicrophoneEnabled(true);
      setMicrophone(true);
    } catch {
      setMicrophone(false);
      unavailable.push('microphone');
    }
    if (credentials.callType === 'video') {
      try {
        await mediaRoom.localParticipant.setCameraEnabled(true);
        setCamera(true);
      } catch {
        setCamera(false);
        unavailable.push('camera');
      }
    } else setCamera(false);
    syncTracks();
    if (unavailable.length)
      setError(
        `Đã vào cuộc gọi nhưng không sử dụng được ${unavailable.join(' và ')}. Bạn vẫn có thể xem và nghe người kia.`,
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
    async function connect() {
      try {
        const accessToken = await api.accessToken();
        if (disposed) return;
        const client = io(`${api.API_ORIGIN}/chat`, {
          transports: ['websocket'],
          auth: { accessToken },
        });
        socket.current = client;
        const receive = (event: CallResponse, incoming: boolean) => {
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
        client.on('call:incoming', (event: CallResponse) =>
          receive(event, true),
        );
        client.on('call:updated', (event: CallResponse) =>
          receive(event, false),
        );
        const history = await api.authenticated<{
          items: Call[];
          nextCursor: string | null;
        }>('/calls?limit=20');
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
      }
    }
    void connect();
    return () => {
      disposed = true;
      socket.current?.disconnect();
      socket.current = undefined;
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
    try {
      await room.localParticipant.setMicrophoneEnabled(enabled);
      setMicrophone(enabled);
      setError('');
    } catch (failure) {
      setMicrophone(false);
      setError(callErrorMessage(failure));
    }
  }

  async function toggleCamera() {
    if (!room || call?.type !== 'video') return;
    const enabled = !camera;
    try {
      await room.localParticipant.setCameraEnabled(enabled);
      setCamera(enabled);
      setError('');
    } catch (failure) {
      setCamera(false);
      setError(
        failure instanceof DOMException
          ? callErrorMessage(failure)
          : 'Không thể bật camera. Bạn vẫn đang kết nối với cuộc gọi.',
      );
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
