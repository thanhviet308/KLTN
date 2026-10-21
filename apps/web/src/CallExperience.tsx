import { useCallback, useEffect, useRef, useState } from 'react';
import type { LocalTrack, RemoteTrack, Room } from 'livekit-client';
import { io, type Socket } from 'socket.io-client';
import * as api from './api';

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
}

export type StartCall = (
  conversationId: string,
  type: 'audio' | 'video',
) => Promise<void>;

function AttachedTrack({ item }: { item: MediaTrack }) {
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
    <div className={`call-track${item.local ? ' local' : ''}`} ref={holder} />
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
}: {
  user: api.User;
  onExpired: () => void;
  registerStart: (start: StartCall | undefined) => void;
}) {
  const [call, setCall] = useState<Call>();
  const [room, setRoom] = useState<Room>();
  const [tracks, setTracks] = useState<MediaTrack[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [microphone, setMicrophone] = useState(true);
  const [camera, setCamera] = useState(true);
  const socket = useRef<Socket | undefined>(undefined);
  const currentCall = useRef<Call | undefined>(undefined);
  const roomRef = useRef<Room | undefined>(undefined);

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
          });
      for (const participant of mediaRoom.remoteParticipants.values())
        for (const publication of participant.trackPublications.values())
          if (publication.track)
            values.push({
              key: `remote:${participant.identity}:${publication.trackSid}`,
              track: publication.track,
              local: false,
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
      await mediaRoom.localParticipant.setMicrophoneEnabled(true);
      if (credentials.callType === 'video')
        await mediaRoom.localParticipant.setCameraEnabled(true);
      setMicrophone(true);
      setCamera(credentials.callType === 'video');
      setRoom(mediaRoom);
      syncTracks();
    } catch (failure) {
      if (roomRef.current === mediaRoom) roomRef.current = undefined;
      await mediaRoom.disconnect();
      throw failure;
    }
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
    try {
      const result = await api.authenticated<CallResponse>(
        `/calls/${call.id}/${action}`,
        {},
      );
      currentCall.current = result.call;
      setCall(result.call);
      if (action === 'accept') await connectMedia(result.call);
      if (action !== 'accept') await closeMedia();
    } catch (failure) {
      if (action !== 'accept') {
        await closeMedia();
        currentCall.current = undefined;
        setCall(undefined);
      } else setError(callErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function toggleMicrophone() {
    if (!room) return;
    const enabled = !microphone;
    await room.localParticipant.setMicrophoneEnabled(enabled);
    setMicrophone(enabled);
  }

  async function toggleCamera() {
    if (!room || call?.type !== 'video') return;
    const enabled = !camera;
    await room.localParticipant.setCameraEnabled(enabled);
    setCamera(enabled);
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

  if (!call || terminal.has(call.status))
    return error ? (
      <div className="call-error-toast" role="alert">
        <span>{error}</span>
        <button type="button" onClick={() => setError('')}>
          Đóng
        </button>
      </div>
    ) : null;
  const incoming =
    call.status === 'ringing' && call.initiatorId !== user.id && !room;
  return (
    <div className="call-overlay" role="dialog" aria-modal="true">
      <section className="call-window">
        <header>
          <div>
            <strong>
              {incoming
                ? `Cuộc gọi ${call.type === 'video' ? 'video' : 'thoại'} đến`
                : call.type === 'video'
                  ? 'Cuộc gọi video'
                  : 'Cuộc gọi thoại'}
            </strong>
            <small>
              {room
                ? 'Đã kết nối'
                : incoming
                  ? 'Một thành viên đang gọi cho bạn'
                  : 'Đang chờ người nhận…'}
            </small>
          </div>
        </header>
        {error && <p className="message error">{error}</p>}
        {room && (
          <div className={`call-stage${call.type === 'audio' ? ' audio' : ''}`}>
            {tracks.map((item) => (
              <AttachedTrack key={item.key} item={item} />
            ))}
            {!tracks.some((item) => item.track.kind === 'video') && (
              <div className="call-audio-placeholder" aria-hidden="true">
                ♪
              </div>
            )}
          </div>
        )}
        <footer className="call-controls">
          {incoming ? (
            <>
              <button
                className="call-control reject"
                disabled={busy}
                onClick={() => void transition('reject')}
              >
                Từ chối
              </button>
              <button
                className="call-control accept"
                disabled={busy}
                onClick={() => void transition('accept')}
              >
                Nhận cuộc gọi
              </button>
            </>
          ) : (
            <>
              {!room && call.status === 'active' && (
                <button
                  className="call-control accept"
                  disabled={busy}
                  onClick={() => void rejoin()}
                >
                  Tham gia lại
                </button>
              )}
              <button
                className={`call-control${microphone ? '' : ' disabled'}`}
                disabled={!room || busy}
                onClick={() => void toggleMicrophone()}
              >
                {microphone ? 'Tắt mic' : 'Bật mic'}
              </button>
              {call.type === 'video' && (
                <button
                  className={`call-control${camera ? '' : ' disabled'}`}
                  disabled={!room || busy}
                  onClick={() => void toggleCamera()}
                >
                  {camera ? 'Tắt camera' : 'Bật camera'}
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
              >
                Kết thúc
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  );
}
