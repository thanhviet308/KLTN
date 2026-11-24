import { useCallback, useEffect, useRef, useState } from 'react';
import './calls.css';
import * as api from '../../lib/api';
import { acquireChatSocket } from '../../lib/realtime';
import { isEmbeddedInAppBrowser } from '../chat/location-helper';
import {
  extractMediaErrorInfo,
  formatCallMediaError,
} from './call-media';
import {
  computeCallElapsedSeconds,
  nextPipCorner,
  resolveStageVideoState,
  type PipCorner,
  type VideoFitMode,
} from './call-view-model';
import {
  CallStageView,
  type MediaTrackItem,
  type RemoteParticipantTile,
} from './CallStageView';
import { startIncomingCallRingtone } from '../../lib/notification-sounds';
import type { Peer } from '../../lib/types';
import { clearAiCache, resolveAiEnabled } from '../ai/ai-model';
import { CallRecorder } from './call-recorder';
import { WebRtcRoom, type WebRtcMediaConfig } from './webrtc-room';

api.onSessionClear(clearAiCache);

type CallStatus =
  'ringing' | 'active' | 'ended' | 'rejected' | 'missed' | 'cancelled';

interface Call {
  summaryEnabled?: boolean;
  summaryRecorderId?: string | null;
  id: string;
  conversationId: string;
  initiatorId: string;
  type: 'audio' | 'video';
  status: CallStatus;
  ringExpiresAt: string;
  startedAt?: string | null;
  participants: { userId: string; status: string }[];
}

interface CallResponse {
  call: Call;
  media?: WebRtcMediaConfig;
}

export interface CallConversationMeta {
  title: string;
  peer?: Peer | null;
}

export type StartCall = (
  conversationId: string,
  type: 'audio' | 'video',
) => Promise<void>;

const terminal = new Set<CallStatus>([
  'ended',
  'rejected',
  'missed',
  'cancelled',
]);

const CHROME_IDLE_HIDE_MS = 3600;

function canBrowserRecordCalls() {
  return (
    typeof MediaRecorder !== 'undefined' && typeof AudioContext !== 'undefined'
  );
}

function isLikelyMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

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
    detail.includes('webrtc') ||
    detail.includes('unauthorized') ||
    detail.includes('401') ||
    (detail.includes('connect') && !detail.includes('disconnect'))
  ) {
    return 'Không thể kết nối cuộc gọi WebRTC. Hãy kiểm tra kết nối mạng và thử lại.';
  }
  return describeMediaFailure(callType, failure);
}

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
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
  const [room, setRoom] = useState<WebRtcRoom>();
  const [tracks, setTracks] = useState<MediaTrackItem[]>([]);
  const [remotePeers, setRemotePeers] = useState<RemoteParticipantTile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const [microphone, setMicrophone] = useState(true);
  const [camera, setCamera] = useState(true);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const [swapped, setSwapped] = useState(false);
  const [pipCorner, setPipCorner] = useState<PipCorner>('top-right');
  const [pipCollapsed, setPipCollapsed] = useState(false);
  const [videoFit, setVideoFit] = useState<VideoFitMode>('contain');
  const [isMinimized, setIsMinimized] = useState(false);
  const [miniCorner, setMiniCorner] = useState<PipCorner>('bottom-right');
  const [chromeHidden, setChromeHidden] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const windowRef = useRef<HTMLElement | null>(null);
  const currentCall = useRef<Call | undefined>(undefined);
  const roomRef = useRef<WebRtcRoom | undefined>(undefined);
  const roomSocketReleaseRef = useRef<(() => void) | undefined>(undefined);
  const facingModeRef = useRef<'user' | 'environment'>('user');
  const fallbackActiveAt = useRef<number | null>(null);
  const chromeTimerRef = useRef<number | undefined>(undefined);
  const conversationMetaRef = useRef(conversationMeta);
  conversationMetaRef.current = conversationMeta;

  const recorderRef = useRef<
    { callId: string; recorder: CallRecorder } | undefined
  >(undefined);
  const recordings = useRef(new Map<string, Promise<Blob>>());
  const recorderFailed = useRef(new Set<string>());
  const submitted = useRef(new Set<string>());
  const [summaryStatus, setSummaryStatus] = useState('');
  const [summaryRetry, setSummaryRetry] = useState<{
    callId: string;
    audio: Blob;
  }>();

  const fullscreenSupported =
    typeof document !== 'undefined' && Boolean(document.fullscreenEnabled);

  const submitRecording = useCallback(async (callId: string, audio: Blob) => {
    setSummaryRetry(undefined);
    if (!audio.size) return;
    try {
      await api.uploadCallRecording(callId, audio);
      setSummaryStatus('');
    } catch (failure) {
      const nonRetryable =
        failure instanceof api.ApiError &&
        [400, 403, 404, 409, 413, 415].includes(failure.status);
      setSummaryStatus(
        `Chưa lưu được ghi âm để tóm tắt cuộc gọi. ${failure instanceof api.ApiError ? api.errorMessage(failure) : 'Kiểm tra kết nối và thử lại.'}`,
      );
      if (!nonRetryable) {
        setSummaryRetry({ callId, audio });
      }
    }
  }, []);

  useEffect(() => {
    if (!call || terminal.has(call.status)) {
      fallbackActiveAt.current = null;
      setElapsedSeconds(0);
      return;
    }
    if (call.status !== 'active') {
      setElapsedSeconds(0);
      return;
    }
    if (fallbackActiveAt.current === null) {
      fallbackActiveAt.current = Date.now();
    }
    const tick = () => {
      setElapsedSeconds(
        computeCallElapsedSeconds({
          status: call.status,
          startedAt: call.startedAt,
          fallbackActiveAtMs: fallbackActiveAt.current,
          nowMs: Date.now(),
        }),
      );
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [call?.id, call?.status, call?.startedAt]);

  useEffect(() => {
    setSwapped(false);
    setPipCollapsed(false);
    setIsMinimized(false);
    setChromeHidden(false);
    setReconnecting(false);
    facingModeRef.current = 'user';
    setFacingMode('user');
  }, [call?.id]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onFullscreenChange = () => {
      setIsFullscreen(
        Boolean(
          document.fullscreenElement &&
          windowRef.current &&
          document.fullscreenElement === windowRef.current,
        ),
      );
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () =>
      document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const closeMedia = useCallback(async () => {
    if (
      typeof document !== 'undefined' &&
      document.fullscreenElement &&
      document.fullscreenElement === windowRef.current
    ) {
      await document.exitFullscreen().catch(() => {});
    }
    const recording = recorderRef.current;
    recorderRef.current = undefined;
    if (recording) {
      const audio = recording.recorder.stop();
      recordings.current.set(recording.callId, audio);
      void audio.catch(() => {});
    }
    const activeRoom = roomRef.current;
    roomRef.current = undefined;
    const releaseSocket = roomSocketReleaseRef.current;
    roomSocketReleaseRef.current = undefined;
    setRoom(undefined);
    setTracks([]);
    setRemotePeers([]);
    setReconnecting(false);
    if (activeRoom) await activeRoom.disconnect();
    releaseSocket?.();
  }, []);

  useEffect(() => {
    const recorderUserId =
      call?.summaryRecorderId ??
      (call?.summaryEnabled ? call.initiatorId : undefined);
    if (
      !room ||
      call?.status !== 'active' ||
      !call.summaryEnabled ||
      recorderUserId !== user.id ||
      recorderRef.current
    )
      return;
    if (recordings.current.has(call.id) || recorderFailed.current.has(call.id))
      return;
    try {
      recorderRef.current = {
        callId: call.id,
        recorder: new CallRecorder(room, setError),
      };
    } catch {
      recorderFailed.current.add(call.id);
      setError(
        'Trình duyệt không hỗ trợ thu âm; cuộc gọi này sẽ không có bản tóm tắt.',
      );
    }
  }, [room, call, user.id]);

  useEffect(() => {
    if (!call || !terminal.has(call.status)) return;
    void closeMedia().then(async () => {
      const audio = recordings.current.get(call.id);
      if (!audio || submitted.current.has(call.id)) return;
      submitted.current.add(call.id);
      recordings.current.delete(call.id);
      if (call.status !== 'ended') return;
      try {
        await submitRecording(call.id, await audio);
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'Không thể thu âm cuộc gọi.',
        );
      }
    });
  }, [call, closeMedia, submitRecording]);

  useEffect(
    () => () => {
      if (chromeTimerRef.current) window.clearTimeout(chromeTimerRef.current);
      void recorderRef.current?.recorder.stop().catch(() => {});
      void roomRef.current?.disconnect();
      roomSocketReleaseRef.current?.();
      roomSocketReleaseRef.current = undefined;
    },
    [],
  );

  const refreshVideoDevices = useCallback(async () => {
    try {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices?.enumerateDevices
      ) {
        setVideoDevices([]);
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(devices.filter((item) => item.kind === 'videoinput'));
    } catch {
      setVideoDevices([]);
    }
  }, []);

  const connectMedia = useCallback(
    async (next: Call, initialMedia?: WebRtcMediaConfig) => {
      await closeMedia();
      const credentials =
        initialMedia ??
        (await api.authenticated<WebRtcMediaConfig>(
          `/calls/${next.id}/token`,
          {},
        ));
      const hub = acquireChatSocket(user.id);

      const resolvePeerName = (identity: string, participantName?: string) => {
        if (participantName?.trim()) return participantName.trim();
        const meta = conversationMetaRef.current[next.conversationId];
        if (meta?.peer && (!meta.peer.id || meta.peer.id === identity)) {
          return meta.peer.displayName;
        }
        return meta?.title || 'Người tham gia';
      };

      let mediaRoom!: WebRtcRoom;
      const syncTracks = () => {
        if (roomRef.current !== mediaRoom) return;
        recorderRef.current?.recorder.sync();

        const values: MediaTrackItem[] = [];
        const localAudioMuted = !mediaRoom.isAudioEnabled;

        if (mediaRoom.localVideo && mediaRoom.isVideoEnabled) {
          values.push({
            key: `local:${mediaRoom.localVideo.id}`,
            track: mediaRoom.localVideo,
            local: true,
            kind: 'video',
            participantIdentity: user.id,
            participantName: user.displayName || 'Bạn',
            isMirrored: facingModeRef.current !== 'environment',
            isSpeaking: false,
            audioMuted: localAudioMuted,
          });
        }

        const peerTiles: RemoteParticipantTile[] = [];
        for (const peer of mediaRoom.getRemotePeers()) {
          const displayName = resolvePeerName(peer.userId, peer.displayName);
          const hasRemoteVideo = Boolean(
            peer.videoTrack &&
            peer.videoTrack.readyState === 'live' &&
            peer.videoEnabled,
          );
          const remoteAudioMuted = !peer.audioEnabled;

          if (hasRemoteVideo && peer.videoTrack) {
            values.push({
              key: `remote:${peer.userId}:${peer.videoTrack.id}`,
              track: peer.videoTrack,
              local: false,
              kind: 'video',
              participantIdentity: peer.userId,
              participantName: displayName,
              isMirrored: false,
              isSpeaking: false,
              audioMuted: remoteAudioMuted,
            });
          }
          if (peer.audioTrack && peer.audioTrack.readyState === 'live') {
            values.push({
              key: `remote:${peer.userId}:${peer.audioTrack.id}`,
              track: peer.audioTrack,
              local: false,
              kind: 'audio',
              participantIdentity: peer.userId,
              participantName: displayName,
            });
          }

          peerTiles.push({
            identity: peer.userId,
            name: displayName,
            hasVideo: hasRemoteVideo,
            audioMuted: remoteAudioMuted,
            isSpeaking: false,
          });
        }

        setTracks(values);
        setRemotePeers(peerTiles);
      };

      mediaRoom = new WebRtcRoom(
        hub.socket,
        next.id,
        user.id,
        credentials.iceServers,
        {
          onStateChange: syncTracks,
          onReconnectingChange: (state) => {
            if (roomRef.current === mediaRoom) setReconnecting(state);
          },
          onDisconnected: () => {
            if (roomRef.current === mediaRoom) {
              recorderRef.current?.recorder.invalidate(
                'Kết nối cuộc gọi bị ngắt; không tạo bản tóm tắt thiếu nội dung.',
              );
              roomRef.current = undefined;
            }
            setTracks([]);
            setRemotePeers([]);
            setReconnecting(false);
            setRoom((active) => (active === mediaRoom ? undefined : active));
          },
        },
        () => {
          void refreshVideoDevices();
        },
      );

      roomRef.current = mediaRoom;
      roomSocketReleaseRef.current = hub.release;

      const unavailable: ('microphone' | 'camera')[] = [];
      let lastMediaFailure: unknown;
      if (!mediaEnvironment().mediaSupported) {
        setMicrophone(false);
        setCamera(false);
        unavailable.push(
          ...(credentials.callType === 'video'
            ? (['microphone', 'camera'] as const)
            : (['microphone'] as const)),
        );
      } else if (credentials.callType === 'video') {
        let combinedSucceeded = false;
        try {
          await mediaRoom.enableCameraAndMicrophone();
          combinedSucceeded = true;
          setMicrophone(true);
          setCamera(true);
        } catch (failure) {
          lastMediaFailure = failure;
        }
        if (!combinedSucceeded) {
          try {
            await mediaRoom.setMicrophoneEnabled(true);
            setMicrophone(true);
          } catch (failure) {
            lastMediaFailure = failure;
            setMicrophone(false);
            unavailable.push('microphone');
          }
          try {
            await mediaRoom.setCameraEnabled(true);
            setCamera(true);
          } catch (failure) {
            lastMediaFailure = failure;
            setCamera(false);
            unavailable.push('camera');
          }
        }
        void refreshVideoDevices();
      } else {
        setCamera(false);
        try {
          await mediaRoom.setMicrophoneEnabled(true);
          setMicrophone(true);
        } catch (failure) {
          lastMediaFailure = failure;
          setMicrophone(false);
          unavailable.push('microphone');
        }
      }

      try {
        await mediaRoom.connect();
      } catch (failure) {
        if (roomRef.current === mediaRoom) roomRef.current = undefined;
        roomSocketReleaseRef.current = undefined;
        await mediaRoom.disconnect();
        hub.release();
        throw failure;
      }

      setReconnecting(false);
      setRoom(mediaRoom);
      syncTracks();
      if (unavailable.length)
        setError(
          describeMediaFailure(
            credentials.callType,
            lastMediaFailure,
            unavailable,
          ),
        );
    },
    [closeMedia, refreshVideoDevices, user.displayName, user.id],
  );

  const start = useCallback<StartCall>(
    async (conversationId, type) => {
      if (currentCall.current && !terminal.has(currentCall.current.status)) {
        setIsMinimized(false);
        setError('Bạn đang có một cuộc gọi khác.');
        return;
      }
      setBusy(true);
      setError('');
      setSummaryStatus('');
      setSummaryRetry(undefined);
      try {
        const aiEnabled = await resolveAiEnabled(() =>
          api.authenticated<{ enabled: boolean }>('/ai/status'),
        ).catch(() => false);
        const summaryEnabled = aiEnabled && canBrowserRecordCalls();
        const result = await api.authenticated<CallResponse>(
          `/conversations/${conversationId}/calls`,
          { clientRequestId: crypto.randomUUID(), type, summaryEnabled },
        );
        currentCall.current = result.call;
        setCall(result.call);
        await connectMedia(result.call, result.media);
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
        setError(callErrorMessage(failure, type));
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
    const receive = (event: CallResponse, incomingEvent: boolean) => {
      if (disposed) return;
      const next = event.call;
      if (incomingEvent && next.initiatorId === user.id) return;
      const me = next.participants.find(
        (participant) => participant.userId === user.id,
      );
      if (!currentCall.current) {
        if (
          terminal.has(next.status) ||
          !me ||
          !['invited', 'accepted', 'joined'].includes(me.status)
        ) {
          return;
        }
      }
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
        const result = await api.authenticated<CallResponse>(
          `/calls/${ending.id}/${action}`,
          {},
        );
        if (terminal.has(result.call.status)) {
          currentCall.current = result.call;
          setCall(result.call);
        } else {
          recordings.current.delete(ending.id);
        }
      } catch (failure) {
        currentCall.current = ending;
        setCall(ending);
        setError(
          `${callErrorMessage(failure, ending.type)} Cuộc gọi chưa được kết thúc trên máy chủ, hãy thử lại.`,
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    setSummaryStatus('');
    setSummaryRetry(undefined);
    try {
      const shouldEnableSummary =
        !call.summaryEnabled &&
        canBrowserRecordCalls() &&
        (await resolveAiEnabled(() =>
          api.authenticated<{ enabled: boolean }>('/ai/status'),
        ).catch(() => false));
      const result = await api.authenticated<CallResponse>(
        `/calls/${call.id}/${action}`,
        shouldEnableSummary ? { summaryEnabled: true } : {},
      );
      currentCall.current = result.call;
      setCall(result.call);
      await connectMedia(result.call, result.media);
    } catch (failure) {
      setError(callErrorMessage(failure, call.type));
    } finally {
      setBusy(false);
    }
  }

  const toggleMicrophone = useCallback(async () => {
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
      await room.setMicrophoneEnabled(enabled);
      setMicrophone(enabled);
      setError('');
    } catch (failure) {
      setMicrophone(false);
      setError(
        describeMediaFailure(call?.type ?? 'audio', failure, ['microphone']),
      );
    }
  }, [call?.type, microphone, room]);

  const toggleCamera = useCallback(async () => {
    if (!room || call?.type !== 'video') return;
    const enabled = !camera;
    if (enabled && !mediaEnvironment().mediaSupported) {
      setCamera(false);
      setError(describeMediaFailure('video', undefined, ['camera']));
      return;
    }
    try {
      await room.setCameraEnabled(enabled);
      if (enabled) void refreshVideoDevices();
      setCamera(enabled);
      setError('');
    } catch (failure) {
      setCamera(false);
      setError(describeMediaFailure('video', failure, ['camera']));
    }
  }, [call?.type, camera, refreshVideoDevices, room]);

  const switchCamera = useCallback(async () => {
    if (!room || call?.type !== 'video' || !camera) return;
    try {
      if (!isLikelyMobileDevice() && videoDevices.length > 1) {
        const activeId = room.getActiveVideoDeviceId();
        const currentIndex = videoDevices.findIndex(
          (item) => item.deviceId === activeId,
        );
        const nextDevice =
          videoDevices[(currentIndex + 1) % videoDevices.length];
        if (nextDevice?.deviceId) {
          await room.switchCameraDevice(nextDevice.deviceId);
          facingModeRef.current = 'user';
          setFacingMode('user');
          setError('');
          return;
        }
      }

      const nextFacing: 'user' | 'environment' =
        facingMode === 'user' ? 'environment' : 'user';
      await room.switchCameraFacing(nextFacing);
      facingModeRef.current = nextFacing;
      setFacingMode(nextFacing);
      setTracks((previous) =>
        previous.map((item) =>
          item.local && item.kind === 'video'
            ? { ...item, isMirrored: nextFacing !== 'environment' }
            : item,
        ),
      );
      setError('');
    } catch (failure) {
      setError(describeMediaFailure('video', failure, ['camera']));
    }
  }, [call?.type, camera, facingMode, room, videoDevices]);

  async function rejoin() {
    if (!call || busy) return;
    setBusy(true);
    setError('');
    try {
      let target = call;
      const me = call.participants.find(
        (participant) => participant.userId === user.id,
      );
      if (me && !['accepted', 'joined'].includes(me.status)) {
        const result = await api.authenticated<CallResponse>(
          `/calls/${call.id}/accept`,
          {},
        );
        target = result.call;
        currentCall.current = target;
        setCall(target);
      }
      await connectMedia(target);
    } catch (failure) {
      setError(callErrorMessage(failure, call.type));
    } finally {
      setBusy(false);
    }
  }

  const toggleFullscreen = useCallback(async () => {
    if (typeof document === 'undefined' || !fullscreenSupported) return;
    try {
      if (
        document.fullscreenElement &&
        document.fullscreenElement === windowRef.current
      ) {
        await document.exitFullscreen();
      } else if (windowRef.current) {
        if (isMinimized) setIsMinimized(false);
        await windowRef.current.requestFullscreen();
      }
    } catch {
      // Ignore browser fullscreen gesture rejections.
    }
  }, [fullscreenSupported, isMinimized]);

  const toggleMinimize = useCallback(() => {
    setIsMinimized((previous) => {
      const next = !previous;
      if (
        next &&
        typeof document !== 'undefined' &&
        document.fullscreenElement === windowRef.current
      ) {
        void document.exitFullscreen().catch(() => {});
      }
      if (next) setChromeHidden(false);
      return next;
    });
  }, []);

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

  useEffect(() => {
    if (!call || terminal.has(call.status)) return;
    const timer = window.setInterval(() => {
      void api
        .authenticated<CallResponse>(`/calls/${call.id}`)
        .then((result) => {
          if (currentCall.current?.id !== call.id) return;
          currentCall.current = result.call;
          setCall(result.call);
        })
        .catch(() => {});
    }, 10000);
    return () => window.clearInterval(timer);
  }, [call?.id, call?.status]);

  const myParticipant = call?.participants.find(
    (participant) => participant.userId === user.id,
  );
  const incoming =
    !!call &&
    ['ringing', 'active'].includes(call.status) &&
    call.initiatorId !== user.id &&
    !room &&
    (myParticipant
      ? myParticipant.status === 'invited'
      : call.status === 'ringing');
  const [canFallbackSummarize, setCanFallbackSummarize] = useState(false);

  useEffect(() => {
    if (!incoming || call?.summaryEnabled || !canBrowserRecordCalls()) {
      setCanFallbackSummarize(false);
      return;
    }
    let cancelled = false;
    void resolveAiEnabled(() =>
      api.authenticated<{ enabled: boolean }>('/ai/status'),
    )
      .then((enabled) => {
        if (!cancelled) setCanFallbackSummarize(enabled);
      })
      .catch(() => {
        if (!cancelled) setCanFallbackSummarize(false);
      });
    return () => {
      cancelled = true;
    };
  }, [incoming, call?.id, call?.summaryEnabled]);

  useEffect(() => {
    if (!incoming) return;
    return startIncomingCallRingtone();
  }, [incoming, call?.id]);

  const remoteVideoCount = tracks.filter(
    (item) => item.kind === 'video' && !item.local,
  ).length;
  const hasLocalVideo = tracks.some(
    (item) => item.kind === 'video' && item.local,
  );

  const stageState = resolveStageVideoState({
    callType: call?.type ?? 'audio',
    callStatus: call?.status ?? 'ringing',
    hasLocalVideo,
    remoteVideoCount,
    remoteParticipantCount: remotePeers.length,
    swapped,
    pipCollapsed,
    hasError: Boolean(error),
    isMinimized,
  });

  const scheduleChromeHide = useCallback(() => {
    if (chromeTimerRef.current) window.clearTimeout(chromeTimerRef.current);
    if (!stageState.canAutoHideChrome) {
      setChromeHidden(false);
      return;
    }
    chromeTimerRef.current = window.setTimeout(() => {
      setChromeHidden(true);
    }, CHROME_IDLE_HIDE_MS);
  }, [stageState.canAutoHideChrome]);

  useEffect(() => {
    if (!stageState.canAutoHideChrome) {
      if (chromeTimerRef.current) window.clearTimeout(chromeTimerRef.current);
      setChromeHidden(false);
      return;
    }
    scheduleChromeHide();
    return () => {
      if (chromeTimerRef.current) window.clearTimeout(chromeTimerRef.current);
    };
  }, [scheduleChromeHide, stageState.canAutoHideChrome]);

  const revealChrome = useCallback(() => {
    setChromeHidden(false);
    scheduleChromeHide();
  }, [scheduleChromeHide]);

  const toggleStageChrome = useCallback(() => {
    setChromeHidden((previous) => {
      const next = !previous;
      if (!next) scheduleChromeHide();
      else if (chromeTimerRef.current)
        window.clearTimeout(chromeTimerRef.current);
      return next;
    });
  }, [scheduleChromeHide]);

  useEffect(() => {
    if (!call || terminal.has(call.status) || isMinimized || incoming) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableElement(event.target)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'm' && room && !busy) {
        event.preventDefault();
        revealChrome();
        void toggleMicrophone();
      } else if (key === 'v' && room && call.type === 'video' && !busy) {
        event.preventDefault();
        revealChrome();
        void toggleCamera();
      } else if (key === 'f' && fullscreenSupported) {
        event.preventDefault();
        revealChrome();
        void toggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    busy,
    call,
    fullscreenSupported,
    incoming,
    isMinimized,
    revealChrome,
    room,
    toggleCamera,
    toggleFullscreen,
    toggleMicrophone,
  ]);

  if (!call || terminal.has(call.status))
    return error || summaryStatus ? (
      <div className="call-error-toast" role="status" aria-live="polite">
        <span>{error || summaryStatus}</span>
        {summaryRetry && (
          <button
            type="button"
            onClick={() =>
              void submitRecording(summaryRetry.callId, summaryRetry.audio)
            }
          >
            Thử lại lưu ghi âm
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setError('');
            setSummaryStatus('');
            setSummaryRetry(undefined);
          }}
        >
          Đóng
        </button>
      </div>
    ) : null;

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
  const summaryAvailable = Boolean(
    call.summaryEnabled || (incoming && canFallbackSummarize),
  );
  const canSwitchCamera = videoDevices.length > 1 || isLikelyMobileDevice();

  return (
    <CallStageView
      windowRef={windowRef}
      callType={call.type}
      callStatus={call.status}
      callTitle={callTitle}
      avatarPeer={avatarPeer}
      hasRoom={Boolean(room)}
      incoming={incoming}
      busy={busy}
      error={error}
      reconnecting={reconnecting}
      elapsedSeconds={elapsedSeconds}
      summaryAvailable={summaryAvailable}
      microphone={microphone}
      camera={camera}
      canSwitchCamera={canSwitchCamera}
      tracks={tracks}
      remotePeers={remotePeers}
      remoteVideoCount={remoteVideoCount}
      hasLocalVideo={hasLocalVideo}
      layout={stageState.layout}
      effectiveSwapped={stageState.effectiveSwapped}
      showHeroOverlay={stageState.showHeroOverlay}
      canAutoHideChrome={stageState.canAutoHideChrome}
      chromeHidden={chromeHidden}
      pipCorner={pipCorner}
      pipCollapsed={pipCollapsed}
      videoFit={videoFit}
      isMinimized={isMinimized}
      miniCorner={miniCorner}
      isFullscreen={isFullscreen}
      fullscreenSupported={fullscreenSupported}
      onRevealChrome={revealChrome}
      onToggleStageChrome={toggleStageChrome}
      onToggleMicrophone={() => void toggleMicrophone()}
      onToggleCamera={() => void toggleCamera()}
      onSwitchCamera={() => void switchCamera()}
      onAccept={() => void transition('accept')}
      onReject={() => void transition('reject')}
      onHangup={() => {
        const otherJoinedCount = call.participants.filter(
          (participant) =>
            participant.userId !== user.id && participant.status === 'joined',
        ).length;
        const action =
          call.initiatorId === user.id &&
          (call.status === 'ringing' || otherJoinedCount < 2)
            ? 'end'
            : 'leave';
        void transition(action);
      }}
      onRejoin={() => void rejoin()}
      onToggleSwap={() => setSwapped((prev) => !prev)}
      onCyclePipCorner={() => setPipCorner((prev) => nextPipCorner(prev))}
      onCollapsePip={() => {
        setSwapped(false);
        setPipCollapsed(true);
      }}
      onRestorePip={() => setPipCollapsed(false)}
      onToggleVideoFit={() =>
        setVideoFit((prev) => (prev === 'contain' ? 'cover' : 'contain'))
      }
      onToggleMinimize={toggleMinimize}
      onCycleMiniCorner={() => setMiniCorner((prev) => nextPipCorner(prev))}
      onToggleFullscreen={() => void toggleFullscreen()}
    />
  );
}
