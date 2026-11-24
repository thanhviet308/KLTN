import {
  MediaStream,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCSessionDescription,
  mediaDevices,
  type MediaStreamTrack,
  type RTCRtpSender,
} from '@livekit/react-native-webrtc';

export type CallConnectionState =
  'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface MediaCredentials {
  callId: string;
  roomName: string;
  callType: 'audio' | 'video';
  iceServers: IceServerConfig[];
  expiresAt?: string;
}

export interface RemotePeerView {
  userId: string;
  displayName: string;
  streamUrl?: string;
  hasVideo: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

export interface SignalingSocket {
  on: <Args extends unknown[]>(
    event: string,
    handler: (...args: Args) => void,
  ) => () => void;
  emit: (event: string, ...args: unknown[]) => void;
  emitWithTimeout: (
    timeoutMs: number,
    event: string,
    ...args: unknown[]
  ) => boolean;
  isConnected: () => boolean;
  connect: (forceRefresh?: boolean) => Promise<void>;
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

interface PeerEntry {
  userId: string;
  displayName: string;
  pc: RTCPeerConnection;
  audioSender?: RTCRtpSender;
  videoSender?: RTCRtpSender;
  remoteStream: MediaStream;
  audioEnabled: boolean;
  videoEnabled: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  polite: boolean;
  pendingCandidates: Record<string, unknown>[];
}

export class WebRtcRoom {
  private readonly peers = new Map<string, PeerEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly connectionListeners = new Set<
    (state: CallConnectionState) => void
  >();
  private readonly disconnectListeners = new Set<() => void>();
  private unsubscribers: (() => void)[] = [];

  private localStreamValue?: MediaStream;
  private localAudioTrack?: MediaStreamTrack;
  private localVideoTrack?: MediaStreamTrack;
  private audioEnabled = false;
  private videoEnabled = false;
  private stateValue: CallConnectionState = 'disconnected';
  private joined = false;
  private disposed = false;

  private readonly callId: string;
  private readonly localUserId: string;

  constructor(
    private readonly socket: SignalingSocket,
    callId: string,
    localUserId: string,
    private readonly iceServers: IceServerConfig[],
  ) {
    this.callId = callId.toLowerCase();
    this.localUserId = localUserId.toLowerCase();
  }

  get state(): CallConnectionState {
    return this.stateValue;
  }

  get isMicrophoneEnabled(): boolean {
    return this.audioEnabled;
  }

  get isCameraEnabled(): boolean {
    return this.videoEnabled;
  }

  get localStreamUrl(): string | undefined {
    if (!this.videoEnabled || !this.localVideoTrack || !this.localStreamValue) {
      return undefined;
    }
    return this.localStreamValue.toURL();
  }

  getRemotePeers(): RemotePeerView[] {
    return [...this.peers.values()].map(entry => {
      const videoTracks = entry.remoteStream
        .getVideoTracks()
        .filter(track => track.readyState !== 'ended');
      const hasVideo = entry.videoEnabled && videoTracks.length > 0;
      return {
        userId: entry.userId,
        displayName: entry.displayName,
        streamUrl: hasVideo ? entry.remoteStream.toURL() : undefined,
        hasVideo,
        audioEnabled: entry.audioEnabled,
        videoEnabled: entry.videoEnabled,
      };
    });
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onConnectionStateChange(listener: (state: CallConnectionState) => void) {
    this.connectionListeners.add(listener);
    return () => {
      this.connectionListeners.delete(listener);
    };
  }

  onDisconnected(listener: () => void) {
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of [...this.listeners]) listener();
  }

  private setState(next: CallConnectionState) {
    if (this.stateValue === next) return;
    this.stateValue = next;
    for (const listener of [...this.connectionListeners]) listener(next);
    this.notify();
  }

  async connect() {
    if (this.disposed) return;
    this.setState('connecting');
    await this.waitForSocketConnected();
    if (this.disposed) return;

    this.unsubscribers = [
      this.socket.on('webrtc:peer-joined', (event: PeerJoinedEvent) => {
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
        this.notify();
      }),
      this.socket.on('webrtc:peer-left', (event: PeerLeftEvent) => {
        if (this.disposed || event.callId !== this.callId) return;
        this.removePeer(event.userId);
        this.notify();
      }),
      this.socket.on('webrtc:media-state', (event: MediaStateEvent) => {
        if (this.disposed || event.callId !== this.callId) return;
        const entry = this.peers.get(event.userId);
        if (!entry) return;
        entry.audioEnabled = event.audioEnabled;
        entry.videoEnabled = event.videoEnabled;
        this.notify();
      }),
      this.socket.on('webrtc:signal', (event: SignalEvent) => {
        if (this.disposed || event.callId !== this.callId) return;
        if (event.fromUserId === this.localUserId) return;
        void this.handleSignal(event);
      }),
      this.socket.on('disconnect', () => {
        if (this.disposed || !this.joined) return;
        this.setState('reconnecting');
      }),
      this.socket.on('connect', () => {
        if (this.disposed || !this.joined) return;
        void this.joinSignalingRoom()
          .then(() => {
            if (!this.disposed) this.setState('connected');
          })
          .catch(() => {});
      }),
    ];

    await this.joinSignalingRoom();
    if (this.disposed) return;
    this.joined = true;
    this.setState('connected');
  }

  private async waitForSocketConnected(timeoutMs = 10000) {
    if (this.socket.isConnected()) return;
    void this.socket.connect();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error('Không thể kết nối máy chủ tín hiệu cuộc gọi.'));
      }, timeoutMs);
      const off = this.socket.on('connect', () => {
        clearTimeout(timer);
        off();
        resolve();
      });
    });
  }

  private async joinSignalingRoom() {
    const response = await new Promise<JoinAck>((resolve, reject) => {
      const sent = this.socket.emitWithTimeout(
        10000,
        'webrtc:join',
        {
          callId: this.callId,
          audioEnabled: this.audioEnabled,
          videoEnabled: this.videoEnabled,
        },
        (err: Error | null, ack: JoinAck) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(ack);
        },
      );
      if (!sent) {
        reject(new Error('Chưa kết nối tới máy chủ tín hiệu.'));
      }
    });
    if (!response?.ok || !response.data) {
      throw new Error(
        response?.message || 'Không thể tham gia phòng cuộc gọi WebRTC.',
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
    if (this.disposed || !this.joined || !this.socket.isConnected()) return;
    this.socket.emit('webrtc:media-state', {
      callId: this.callId,
      audioEnabled: this.audioEnabled,
      videoEnabled: this.videoEnabled,
    });
  }

  async setMicrophoneEnabled(enabled: boolean) {
    if (!enabled) {
      if (this.localAudioTrack) {
        this.localAudioTrack.enabled = false;
      }
      this.audioEnabled = false;
      this.emitMediaState();
      this.notify();
      return;
    }
    if (this.localAudioTrack && this.localAudioTrack.readyState !== 'ended') {
      this.localAudioTrack.enabled = true;
      this.audioEnabled = true;
      this.emitMediaState();
      this.notify();
      return;
    }
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('Không thể mở micro.');
    await this.attachLocalAudioTrack(track);
    this.audioEnabled = true;
    this.emitMediaState();
    this.notify();
  }

  async setCameraEnabled(enabled: boolean) {
    if (!enabled) {
      if (this.localVideoTrack) {
        this.localVideoTrack.stop();
        this.localVideoTrack = undefined;
      }
      this.rebuildLocalStream();
      for (const entry of this.peers.values()) {
        if (entry.videoSender) {
          await entry.videoSender.replaceTrack(null).catch(() => {});
        }
      }
      this.videoEnabled = false;
      this.emitMediaState();
      this.notify();
      return;
    }

    const stream = await mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: 960,
        height: 540,
        frameRate: 30,
      },
    });
    const track = stream.getVideoTracks()[0];
    if (!track) throw new Error('Không thể mở camera.');
    await this.attachLocalVideoTrack(track);
    this.videoEnabled = true;
    this.emitMediaState();
    this.notify();
  }

  async switchCamera() {
    const raw = this.localVideoTrack as
      (MediaStreamTrack & { _switchCamera?: () => void }) | undefined;
    if (raw && typeof raw._switchCamera === 'function') {
      raw._switchCamera();
      this.notify();
    }
  }

  private rebuildLocalStream() {
    const tracks: MediaStreamTrack[] = [];
    if (this.localAudioTrack) tracks.push(this.localAudioTrack);
    if (this.localVideoTrack) tracks.push(this.localVideoTrack);
    this.localStreamValue = tracks.length ? new MediaStream(tracks) : undefined;
  }

  private async attachLocalAudioTrack(track: MediaStreamTrack) {
    const prev = this.localAudioTrack;
    this.localAudioTrack = track;
    if (prev && prev !== track) prev.stop();
    this.rebuildLocalStream();
    for (const entry of this.peers.values()) {
      if (entry.audioSender) {
        await entry.audioSender.replaceTrack(track).catch(() => {});
      } else if (this.localStreamValue) {
        entry.audioSender = entry.pc.addTrack(track, this.localStreamValue);
      }
    }
  }

  private async attachLocalVideoTrack(track: MediaStreamTrack) {
    const prev = this.localVideoTrack;
    this.localVideoTrack = track;
    if (prev && prev !== track) prev.stop();
    this.rebuildLocalStream();
    for (const entry of this.peers.values()) {
      if (entry.videoSender) {
        await entry.videoSender.replaceTrack(track).catch(() => {});
      } else if (this.localStreamValue) {
        entry.videoSender = entry.pc.addTrack(track, this.localStreamValue);
      }
    }
  }

  private ensurePeer(
    userId: string,
    displayName: string,
    audioEnabled: boolean,
    videoEnabled: boolean,
  ): PeerEntry {
    const existing = this.peers.get(userId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
      iceCandidatePoolSize: 4,
    });
    const remoteStream = new MediaStream([]);
    const entry: PeerEntry = {
      userId,
      displayName: displayName || 'Thành viên',
      pc,
      remoteStream,
      audioEnabled,
      videoEnabled,
      makingOffer: false,
      ignoreOffer: false,
      polite: this.localUserId > userId,
      pendingCandidates: [],
    };

    if (this.localAudioTrack && this.localStreamValue) {
      entry.audioSender = pc.addTrack(
        this.localAudioTrack,
        this.localStreamValue,
      );
    }
    if (this.localVideoTrack && this.localStreamValue) {
      entry.videoSender = pc.addTrack(
        this.localVideoTrack,
        this.localStreamValue,
      );
    }

    pc.addEventListener('icecandidate', event => {
      if (!event.candidate || this.disposed) return;
      const candidate = event.candidate;
      this.socket.emit('webrtc:signal', {
        callId: this.callId,
        targetUserId: userId,
        type: 'ice-candidate',
        payload:
          typeof candidate.toJSON === 'function'
            ? candidate.toJSON()
            : {
                candidate: candidate.candidate,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex,
              },
      });
    });

    pc.addEventListener('negotiationneeded', () => {
      void this.negotiatePeer(entry);
    });

    pc.addEventListener('track', event => {
      const track = event.track;
      if (!track) return;
      const existingTracks = entry.remoteStream
        .getTracks()
        .filter(item => item.kind === track.kind);
      for (const old of existingTracks) {
        entry.remoteStream.removeTrack(old);
      }
      entry.remoteStream.addTrack(track);
      if (!this.disposed) this.notify();
    });

    pc.addEventListener('iceconnectionstatechange', () => {
      if (this.disposed) return;
      const state = pc.iceConnectionState;
      if (state === 'disconnected' || state === 'failed') {
        this.setState('reconnecting');
        if (state === 'failed' && !entry.polite) {
          pc.restartIce();
        }
      } else if (state === 'connected' || state === 'completed') {
        if (this.socket.isConnected()) {
          this.setState('connected');
        }
      }
    });

    this.peers.set(userId, entry);
    return entry;
  }

  private async negotiatePeer(entry: PeerEntry) {
    if (this.disposed || entry.pc.signalingState === 'closed') return;
    try {
      entry.makingOffer = true;
      const offer = await entry.pc.createOffer({});
      if (this.disposed || entry.pc.signalingState !== 'stable') return;
      await entry.pc.setLocalDescription(offer);
      this.socket.emit('webrtc:signal', {
        callId: this.callId,
        targetUserId: entry.userId,
        type: 'offer',
        payload: {
          type: 'offer',
          sdp: entry.pc.localDescription?.sdp ?? offer.sdp ?? '',
        },
      });
    } catch {
      // Transient glare; resolved by incoming offer or next negotiation.
    } finally {
      entry.makingOffer = false;
    }
  }

  private async handleSignal(event: SignalEvent) {
    const entry = this.ensurePeer(event.fromUserId, 'Thành viên', true, true);
    const { pc } = entry;
    if (pc.signalingState === 'closed') return;

    try {
      if (event.type === 'offer' || event.type === 'answer') {
        const sdp =
          typeof event.payload.sdp === 'string' ? event.payload.sdp : '';
        const offerCollision =
          event.type === 'offer' &&
          (entry.makingOffer || pc.signalingState !== 'stable');
        entry.ignoreOffer = !entry.polite && offerCollision;
        if (entry.ignoreOffer) return;

        if (offerCollision) {
          await pc.setLocalDescription({ type: 'rollback', sdp: '' });
        }
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: event.type, sdp }),
        );
        await this.flushCandidates(entry);

        if (event.type === 'offer') {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.socket.emit('webrtc:signal', {
            callId: this.callId,
            targetUserId: entry.userId,
            type: 'answer',
            payload: {
              type: 'answer',
              sdp: pc.localDescription?.sdp ?? answer.sdp ?? '',
            },
          });
        }
      } else if (event.type === 'ice-candidate') {
        if (!pc.remoteDescription) {
          entry.pendingCandidates.push(event.payload);
          return;
        }
        await pc.addIceCandidate(
          new RTCIceCandidate(
            event.payload as {
              candidate: string;
              sdpMid?: string | null;
              sdpMLineIndex?: number | null;
            },
          ),
        );
      }
    } catch {
      // Ignore transient signaling errors.
    }
  }

  private async flushCandidates(entry: PeerEntry) {
    while (entry.pendingCandidates.length) {
      const candidate = entry.pendingCandidates.shift();
      if (!candidate) continue;
      try {
        await entry.pc.addIceCandidate(
          new RTCIceCandidate(
            candidate as {
              candidate: string;
              sdpMid?: string | null;
              sdpMLineIndex?: number | null;
            },
          ),
        );
      } catch {
        // Ignore stale candidates.
      }
    }
  }

  private removePeer(userId: string) {
    const entry = this.peers.get(userId);
    if (!entry) return;
    this.peers.delete(userId);
    entry.pc.close();
  }

  async disconnect() {
    if (this.disposed) return;
    this.disposed = true;

    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];

    if (this.joined && this.socket.isConnected()) {
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
    this.localStreamValue = undefined;
    this.audioEnabled = false;
    this.videoEnabled = false;
    this.setState('disconnected');
    for (const listener of [...this.disconnectListeners]) listener();
    this.listeners.clear();
    this.connectionListeners.clear();
    this.disconnectListeners.clear();
  }
}
