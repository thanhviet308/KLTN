import type { Socket } from 'socket.io-client';
import { isOverconstrainedMediaError } from './call-media';

export interface WebRtcMediaConfig {
  callId: string;
  roomName: string;
  callType: 'audio' | 'video';
  iceServers: RTCIceServer[];
  expiresAt: string;
}

export interface WebRtcPeerSnapshot {
  userId: string;
  displayName: string;
  audioTrack?: MediaStreamTrack;
  videoTrack?: MediaStreamTrack;
  audioEnabled: boolean;
  videoEnabled: boolean;
  connected: boolean;
}

interface JoinAck {
  ok: boolean;
  code?: string;
  message?: string;
  data?: {
    callId: string;
    peers: {
      userId: string;
      displayName: string;
      audioEnabled: boolean;
      videoEnabled: boolean;
    }[];
  };
}

interface PeerJoinedEvent {
  callId: string;
  userId: string;
  displayName: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

interface PeerLeftEvent {
  callId: string;
  userId: string;
}

interface MediaStateEvent {
  callId: string;
  userId: string;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

interface SignalEvent {
  callId: string;
  fromUserId: string;
  type: 'offer' | 'answer' | 'ice-candidate';
  payload: Record<string, unknown>;
}

interface PeerConnectionEntry {
  userId: string;
  displayName: string;
  pc: RTCPeerConnection;
  audioSender?: RTCRtpSender;
  videoSender?: RTCRtpSender;
  remoteAudioTrack?: MediaStreamTrack;
  remoteVideoTrack?: MediaStreamTrack;
  audioEnabled: boolean;
  videoEnabled: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  connected: boolean;
}

export interface WebRtcRoomCallbacks {
  onStateChange: () => void;
  onReconnectingChange: (reconnecting: boolean) => void;
  onDisconnected: () => void;
}

async function emitWithAck<T>(
  socket: Socket,
  event: string,
  payload: unknown,
  timeoutMs = 10000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    socket
      .timeout(timeoutMs)
      .emit(event, payload, (err: Error | null, response: T) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(response);
      });
  });
}

async function waitForSocketConnected(socket: Socket, timeoutMs = 10000) {
  if (socket.connected) return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      socket.off('connect', onConnect);
      reject(new Error('Không thể kết nối máy chủ tín hiệu cuộc gọi.'));
    }, timeoutMs);
    const onConnect = () => {
      window.clearTimeout(timer);
      socket.off('connect', onConnect);
      resolve();
    };
    socket.on('connect', onConnect);
  });
}

export class WebRtcRoom {
  private readonly peers = new Map<string, PeerConnectionEntry>();
  private localAudioTrack?: MediaStreamTrack;
  private localVideoTrack?: MediaStreamTrack;
  private localAudioEnabled = false;
  private localVideoEnabled = false;
  private activeVideoDeviceId?: string;
  private joined = false;
  private disposed = false;

  private readonly onPeerJoinedBound: (event: PeerJoinedEvent) => void;
  private readonly onPeerLeftBound: (event: PeerLeftEvent) => void;
  private readonly onMediaStateBound: (event: MediaStateEvent) => void;
  private readonly onSignalBound: (event: SignalEvent) => void;
  private readonly onSocketDisconnectBound: () => void;
  private readonly onSocketConnectBound: () => void;
  private readonly onDeviceChangeBound: () => void;

  private readonly callId: string;
  private readonly localUserId: string;

  constructor(
    private readonly socket: Socket,
    callId: string,
    localUserId: string,
    private readonly iceServers: RTCIceServer[],
    private readonly callbacks: WebRtcRoomCallbacks,
    private readonly onDevicesChanged?: () => void,
  ) {
    this.callId = callId.toLowerCase();
    this.localUserId = localUserId.toLowerCase();
    this.onPeerJoinedBound = (event) => {
      if (this.disposed || event.callId !== this.callId) return;
      if (event.userId === this.localUserId) return;
      const entry = this.ensurePeer(
        event.userId,
        event.displayName,
        event.audioEnabled,
        event.videoEnabled,
      );
      entry.displayName = event.displayName || entry.displayName;
      entry.audioEnabled = event.audioEnabled;
      entry.videoEnabled = event.videoEnabled;
      if (!entry.polite) {
        void this.negotiatePeer(entry);
      }
      this.callbacks.onStateChange();
    };

    this.onPeerLeftBound = (event) => {
      if (this.disposed || event.callId !== this.callId) return;
      this.removePeer(event.userId);
      this.callbacks.onStateChange();
    };

    this.onMediaStateBound = (event) => {
      if (this.disposed || event.callId !== this.callId) return;
      const entry = this.peers.get(event.userId);
      if (!entry) return;
      entry.audioEnabled = event.audioEnabled;
      entry.videoEnabled = event.videoEnabled;
      this.callbacks.onStateChange();
    };

    this.onSignalBound = (event) => {
      if (this.disposed || event.callId !== this.callId) return;
      if (event.fromUserId === this.localUserId) return;
      void this.handleSignal(event);
    };

    this.onSocketDisconnectBound = () => {
      if (this.disposed || !this.joined) return;
      this.callbacks.onReconnectingChange(true);
    };

    this.onSocketConnectBound = () => {
      if (this.disposed || !this.joined) return;
      void this.joinSignalingRoom()
        .then(() => {
          if (!this.disposed) this.callbacks.onReconnectingChange(false);
        })
        .catch(() => {});
    };

    this.onDeviceChangeBound = () => {
      this.onDevicesChanged?.();
    };
  }

  get localAudio(): MediaStreamTrack | undefined {
    return this.localAudioTrack;
  }

  get localVideo(): MediaStreamTrack | undefined {
    return this.localVideoTrack;
  }

  get isAudioEnabled(): boolean {
    return this.localAudioEnabled;
  }

  get isVideoEnabled(): boolean {
    return this.localVideoEnabled;
  }

  getActiveVideoDeviceId(): string | undefined {
    return (
      this.localVideoTrack?.getSettings?.().deviceId ?? this.activeVideoDeviceId
    );
  }

  getRemotePeers(): WebRtcPeerSnapshot[] {
    return [...this.peers.values()].map((entry) => ({
      userId: entry.userId,
      displayName: entry.displayName,
      audioTrack: entry.remoteAudioTrack,
      videoTrack: entry.remoteVideoTrack,
      audioEnabled: entry.audioEnabled,
      videoEnabled: entry.videoEnabled,
      connected: entry.connected,
    }));
  }

  getAllLiveAudioTracks(): MediaStreamTrack[] {
    const tracks: MediaStreamTrack[] = [];
    if (this.localAudioTrack && this.localAudioTrack.readyState === 'live') {
      tracks.push(this.localAudioTrack);
    }
    for (const entry of this.peers.values()) {
      if (
        entry.remoteAudioTrack &&
        entry.remoteAudioTrack.readyState === 'live'
      ) {
        tracks.push(entry.remoteAudioTrack);
      }
    }
    return tracks;
  }

  async connect() {
    if (this.disposed) return;
    await waitForSocketConnected(this.socket);
    if (this.disposed) return;

    this.socket.on('webrtc:peer-joined', this.onPeerJoinedBound);
    this.socket.on('webrtc:peer-left', this.onPeerLeftBound);
    this.socket.on('webrtc:media-state', this.onMediaStateBound);
    this.socket.on('webrtc:signal', this.onSignalBound);
    this.socket.on('disconnect', this.onSocketDisconnectBound);
    this.socket.on('connect', this.onSocketConnectBound);
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.addEventListener(
        'devicechange',
        this.onDeviceChangeBound,
      );
    }

    await this.joinSignalingRoom();
    this.joined = true;
    this.callbacks.onStateChange();
  }

  private async joinSignalingRoom() {
    const response = await emitWithAck<JoinAck>(this.socket, 'webrtc:join', {
      callId: this.callId,
      audioEnabled: this.localAudioEnabled,
      videoEnabled: this.localVideoEnabled,
    });
    if (!response?.ok || !response.data) {
      throw new Error(
        response?.message || 'Không thể tham gia phòng tín hiệu WebRTC.',
      );
    }
    for (const peer of response.data.peers) {
      if (peer.userId === this.localUserId) continue;
      const entry = this.ensurePeer(
        peer.userId,
        peer.displayName,
        peer.audioEnabled,
        peer.videoEnabled,
      );
      if (!entry.polite) {
        void this.negotiatePeer(entry);
      }
    }
  }

  private emitMediaState() {
    if (this.disposed || !this.joined || !this.socket.connected) return;
    this.socket.emit('webrtc:media-state', {
      callId: this.callId,
      audioEnabled: this.localAudioEnabled,
      videoEnabled: this.localVideoEnabled,
    });
  }

  async enableCameraAndMicrophone() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: {
          facingMode: 'user',
          width: { ideal: 960 },
          height: { ideal: 540 },
          frameRate: { ideal: 30 },
        },
      });
    } catch (failure) {
      if (!isOverconstrainedMediaError(failure)) throw failure;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24 },
        },
      });
    }
    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];
    if (audioTrack) {
      await this.attachLocalAudioTrack(audioTrack);
      this.localAudioEnabled = true;
    }
    if (videoTrack) {
      await this.attachLocalVideoTrack(videoTrack);
      this.localVideoEnabled = true;
    }
    this.emitMediaState();
    this.callbacks.onStateChange();
  }

  async setMicrophoneEnabled(enabled: boolean) {
    if (!enabled) {
      if (this.localAudioTrack) {
        this.localAudioTrack.enabled = false;
      }
      this.localAudioEnabled = false;
      this.emitMediaState();
      this.callbacks.onStateChange();
      return;
    }
    if (this.localAudioTrack && this.localAudioTrack.readyState === 'live') {
      this.localAudioTrack.enabled = true;
      this.localAudioEnabled = true;
      this.emitMediaState();
      this.callbacks.onStateChange();
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('Không tìm thấy micro.');
    await this.attachLocalAudioTrack(track);
    this.localAudioEnabled = true;
    this.emitMediaState();
    this.callbacks.onStateChange();
  }

  async setCameraEnabled(
    enabled: boolean,
    constraints?: MediaTrackConstraints,
  ) {
    if (!enabled) {
      if (this.localVideoTrack) {
        this.localVideoTrack.stop();
        this.localVideoTrack = undefined;
      }
      for (const entry of this.peers.values()) {
        if (entry.videoSender) {
          await entry.videoSender.replaceTrack(null).catch(() => {});
        }
      }
      this.localVideoEnabled = false;
      this.emitMediaState();
      this.callbacks.onStateChange();
      return;
    }

    let stream: MediaStream;
    const videoConstraint: MediaTrackConstraints = constraints ?? {
      facingMode: 'user',
      width: { ideal: 960 },
      height: { ideal: 540 },
      frameRate: { ideal: 30 },
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: videoConstraint,
      });
    } catch (failure) {
      if (!isOverconstrainedMediaError(failure)) throw failure;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24 },
        },
      });
    }
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Không tìm thấy camera.');
    await this.attachLocalVideoTrack(track);
    this.localVideoEnabled = true;
    this.emitMediaState();
    this.callbacks.onStateChange();
  }

  async switchCameraDevice(deviceId: string) {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: { exact: deviceId } },
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Không thể chuyển camera.');
    this.activeVideoDeviceId = deviceId;
    await this.attachLocalVideoTrack(track);
    this.localVideoEnabled = true;
    this.emitMediaState();
    this.callbacks.onStateChange();
  }

  async switchCameraFacing(facingMode: 'user' | 'environment') {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { exact: facingMode } },
      });
    } catch {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode },
      });
    }
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Không thể đổi camera.');
    await this.attachLocalVideoTrack(track);
    this.localVideoEnabled = true;
    this.emitMediaState();
    this.callbacks.onStateChange();
  }

  private async attachLocalAudioTrack(track: MediaStreamTrack) {
    const previous = this.localAudioTrack;
    this.localAudioTrack = track;
    if (previous && previous !== track) previous.stop();
    const localStream = this.buildLocalStream();
    for (const entry of this.peers.values()) {
      if (entry.audioSender) {
        await entry.audioSender.replaceTrack(track).catch(() => {});
      } else {
        entry.audioSender = entry.pc.addTrack(track, localStream);
      }
    }
  }

  private async attachLocalVideoTrack(track: MediaStreamTrack) {
    const previous = this.localVideoTrack;
    this.localVideoTrack = track;
    this.activeVideoDeviceId = track.getSettings?.().deviceId;
    if (previous && previous !== track) previous.stop();
    const localStream = this.buildLocalStream();
    for (const entry of this.peers.values()) {
      if (entry.videoSender) {
        await entry.videoSender.replaceTrack(track).catch(() => {});
      } else {
        entry.videoSender = entry.pc.addTrack(track, localStream);
      }
    }
  }

  private buildLocalStream() {
    const tracks: MediaStreamTrack[] = [];
    if (this.localAudioTrack) tracks.push(this.localAudioTrack);
    if (this.localVideoTrack) tracks.push(this.localVideoTrack);
    return new MediaStream(tracks);
  }

  private ensurePeer(
    userId: string,
    displayName: string,
    audioEnabled: boolean,
    videoEnabled: boolean,
  ): PeerConnectionEntry {
    const existing = this.peers.get(userId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 4,
    });
    const entry: PeerConnectionEntry = {
      userId,
      displayName: displayName || 'Người tham gia',
      pc,
      audioEnabled,
      videoEnabled,
      makingOffer: false,
      ignoreOffer: false,
      polite: this.localUserId > userId,
      pendingCandidates: [],
      connected: false,
    };

    const localStream = this.buildLocalStream();
    if (this.localAudioTrack) {
      entry.audioSender = pc.addTrack(this.localAudioTrack, localStream);
    }
    if (this.localVideoTrack) {
      entry.videoSender = pc.addTrack(this.localVideoTrack, localStream);
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate || this.disposed) return;
      this.socket.emit('webrtc:signal', {
        callId: this.callId,
        targetUserId: userId,
        type: 'ice-candidate',
        payload: event.candidate.toJSON() as Record<string, unknown>,
      });
    };

    pc.onnegotiationneeded = () => {
      void this.negotiatePeer(entry);
    };

    pc.ontrack = (event) => {
      const track = event.track;
      const receiver = event.receiver as RTCRtpReceiver & {
        playoutDelayHint?: number;
        jitterBufferTarget?: number;
      };
      if (receiver) {
        if ('playoutDelayHint' in receiver) {
          receiver.playoutDelayHint = 0;
        }
        if ('jitterBufferTarget' in receiver) {
          receiver.jitterBufferTarget = 0;
        }
      }
      if (track.kind === 'audio') {
        entry.remoteAudioTrack = track;
      } else if (track.kind === 'video') {
        entry.remoteVideoTrack = track;
      }
      track.onended = () => {
        if (track.kind === 'audio' && entry.remoteAudioTrack === track) {
          entry.remoteAudioTrack = undefined;
        }
        if (track.kind === 'video' && entry.remoteVideoTrack === track) {
          entry.remoteVideoTrack = undefined;
        }
        if (!this.disposed) this.callbacks.onStateChange();
      };
      track.onunmute = () => {
        if (!this.disposed) this.callbacks.onStateChange();
      };
      if (!this.disposed) this.callbacks.onStateChange();
    };

    pc.oniceconnectionstatechange = () => {
      if (this.disposed) return;
      const state = pc.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        entry.connected = true;
        this.syncReconnecting();
      } else if (state === 'disconnected') {
        this.syncReconnecting();
      } else if (state === 'failed') {
        entry.connected = false;
        this.syncReconnecting();
        if (!entry.polite && typeof pc.restartIce === 'function') {
          pc.restartIce();
        }
      } else if (state === 'closed') {
        entry.connected = false;
      }
      this.callbacks.onStateChange();
    };

    this.peers.set(userId, entry);
    return entry;
  }

  private syncReconnecting() {
    if (!this.socket.connected) {
      this.callbacks.onReconnectingChange(true);
      return;
    }
    const anyRecovering = [...this.peers.values()].some((peer) => {
      const state = peer.pc.iceConnectionState;
      return state === 'disconnected' || state === 'failed';
    });
    this.callbacks.onReconnectingChange(anyRecovering);
  }

  private async negotiatePeer(entry: PeerConnectionEntry) {
    if (this.disposed) return;
    if (entry.pc.signalingState === 'closed') return;
    try {
      entry.makingOffer = true;
      const offer = await entry.pc.createOffer();
      if (this.disposed || entry.pc.signalingState !== 'stable') return;
      await entry.pc.setLocalDescription(offer);
      this.socket.emit('webrtc:signal', {
        callId: this.callId,
        targetUserId: entry.userId,
        type: 'offer',
        payload: {
          type: entry.pc.localDescription?.type ?? 'offer',
          sdp: entry.pc.localDescription?.sdp ?? offer.sdp ?? '',
        },
      });
    } catch {
      // Glare or transient state; next negotiation or incoming offer resolves it.
    } finally {
      entry.makingOffer = false;
    }
  }

  private async handleSignal(event: SignalEvent) {
    const entry = this.ensurePeer(event.fromUserId, 'Người tham gia', true, true);
    const { pc } = entry;
    if (pc.signalingState === 'closed') return;

    try {
      if (event.type === 'offer' || event.type === 'answer') {
        const description: RTCSessionDescriptionInit = {
          type: event.type,
          sdp: typeof event.payload.sdp === 'string' ? event.payload.sdp : '',
        };
        const offerCollision =
          event.type === 'offer' &&
          (entry.makingOffer || pc.signalingState !== 'stable');
        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) return;

        if (offerCollision) {
          await pc.setLocalDescription({ type: 'rollback' });
        }
        await pc.setRemoteDescription(description);
        await this.flushCandidates(entry);

        if (event.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.socket.emit('webrtc:signal', {
            callId: this.callId,
            targetUserId: entry.userId,
            type: 'answer',
            payload: {
              type: pc.localDescription?.type ?? 'answer',
              sdp: pc.localDescription?.sdp ?? answer.sdp ?? '',
            },
          });
        }
      } else if (event.type === 'ice-candidate') {
        const candidate = event.payload as RTCIceCandidateInit;
        if (!pc.remoteDescription) {
          entry.pendingCandidates.push(candidate);
          return;
        }
        try {
          await pc.addIceCandidate(candidate);
        } catch {
          if (!entry.ignoreOffer) {
            // Ignore stale candidates during ICE restart.
          }
        }
      }
    } catch {
      // Ignore transient signaling errors; ICE restart or peer rejoin will recover.
    }
  }

  private async flushCandidates(entry: PeerConnectionEntry) {
    while (entry.pendingCandidates.length) {
      const candidate = entry.pendingCandidates.shift();
      if (!candidate) continue;
      try {
        await entry.pc.addIceCandidate(candidate);
      } catch {
        // Ignore stale candidates.
      }
    }
  }

  private removePeer(userId: string) {
    const entry = this.peers.get(userId);
    if (!entry) return;
    this.peers.delete(userId);
    entry.pc.onicecandidate = null;
    entry.pc.onnegotiationneeded = null;
    entry.pc.ontrack = null;
    entry.pc.oniceconnectionstatechange = null;
    entry.pc.close();
  }

  async disconnect() {
    if (this.disposed) return;
    this.disposed = true;

    this.socket.off('webrtc:peer-joined', this.onPeerJoinedBound);
    this.socket.off('webrtc:peer-left', this.onPeerLeftBound);
    this.socket.off('webrtc:media-state', this.onMediaStateBound);
    this.socket.off('webrtc:signal', this.onSignalBound);
    this.socket.off('disconnect', this.onSocketDisconnectBound);
    this.socket.off('connect', this.onSocketConnectBound);
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      navigator.mediaDevices.removeEventListener(
        'devicechange',
        this.onDeviceChangeBound,
      );
    }

    if (this.joined && this.socket.connected) {
      this.socket.emit('webrtc:leave', { callId: this.callId });
    }
    this.joined = false;

    for (const userId of [...this.peers.keys()]) {
      this.removePeer(userId);
    }

    this.localAudioTrack?.stop();
    this.localAudioTrack = undefined;
    this.localVideoTrack?.stop();
    this.localVideoTrack = undefined;
    this.localAudioEnabled = false;
    this.localVideoEnabled = false;
    this.callbacks.onDisconnected();
  }
}
