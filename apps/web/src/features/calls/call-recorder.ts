import type { WebRtcRoom } from './webrtc-room';

const MAX_BYTES = 8 * 1024 * 1024;

/** Mix all subscribed voices and the local microphone, never camera video. */
export class CallRecorder {
  private readonly context = new AudioContext();
  private readonly output = this.context.createMediaStreamDestination();
  private readonly sources = new Map<
    MediaStreamTrack,
    MediaStreamAudioSourceNode
  >();
  private readonly recorder: MediaRecorder;
  private readonly mimeType: string;
  private readonly chunks: Blob[] = [];
  private size = 0;
  private failure?: Error;
  private stopped?: Promise<Blob>;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(
    private readonly room: WebRtcRoom,
    onFailure: (message: string) => void,
  ) {
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(
      (type) => MediaRecorder.isTypeSupported(type),
    );
    if (!mimeType) {
      void this.context.close();
      throw new Error('Trình duyệt chưa hỗ trợ ghi âm cuộc gọi.');
    }
    this.mimeType = mimeType;
    this.timer = setTimeout(
      () => {
        this.failure = new Error(
          'Cuộc gọi vượt giới hạn 30 phút; không tạo bản tóm tắt thiếu nội dung.',
        );
        onFailure(this.failure.message);
        void this.stop().catch(() => {});
      },
      30 * 60 * 1000,
    );
    try {
      this.recorder = new MediaRecorder(this.output.stream, {
        mimeType,
        audioBitsPerSecond: 24000,
      });
      this.recorder.ondataavailable = (event) => {
        this.size += event.data.size;
        if (this.size > MAX_BYTES) {
          this.failure = new Error(
            'Cuộc gọi vượt giới hạn ghi âm 8 MB; không tạo bản tóm tắt thiếu nội dung.',
          );
          onFailure(this.failure.message);
          void this.stop().catch(() => {});
        } else if (!this.failure && event.data.size)
          this.chunks.push(event.data);
      };
      this.recorder.onerror = () => {
        this.failure = new Error(
          'Ghi âm bị gián đoạn; không thể tóm tắt cuộc gọi.',
        );
        onFailure(this.failure.message);
        void this.stop().catch(() => {});
      };
      this.sync();
      this.recorder.start(1000);
    } catch (error) {
      clearTimeout(this.timer);
      for (const source of this.sources.values()) source.disconnect();
      this.sources.clear();
      this.output.stream.getTracks().forEach((track) => track.stop());
      void this.context.close();
      throw error;
    }
    void this.context.resume().catch(() => {
      this.failure = new Error('Không thể thu âm trên trình duyệt này.');
      onFailure(this.failure.message);
      void this.stop().catch(() => {});
    });
  }

  sync() {
    if (this.stopped) return;
    const tracks = new Set<MediaStreamTrack>(this.room.getAllLiveAudioTracks());
    for (const [track, source] of this.sources) {
      if (!tracks.has(track)) {
        source.disconnect();
        this.sources.delete(track);
      }
    }
    for (const track of tracks) {
      if (this.sources.has(track)) continue;
      const source = this.context.createMediaStreamSource(
        new MediaStream([track]),
      );
      source.connect(this.output);
      this.sources.set(track, source);
    }
  }

  invalidate(message: string) {
    this.failure = new Error(message);
  }

  stop(): Promise<Blob> {
    if (this.stopped) return this.stopped;
    clearTimeout(this.timer);
    if (this.context.state === 'suspended') {
      this.failure = new Error(
        'Trình duyệt chưa cho phép thu âm; không thể tạo bản tóm tắt.',
      );
    }
    this.stopped = new Promise<Blob>((resolve, reject) => {
      const finish = () => {
        for (const source of this.sources.values()) source.disconnect();
        this.sources.clear();
        this.output.stream.getTracks().forEach((track) => track.stop());
        void this.context.close();
        if (this.failure) reject(this.failure);
        else
          resolve(
            new Blob(this.chunks, {
              type: this.recorder.mimeType || this.mimeType,
            }),
          );
        this.chunks.length = 0;
      };
      this.recorder.onstop = finish;
      if (this.recorder.state === 'inactive') finish();
      else this.recorder.stop();
    });
    return this.stopped;
  }
}
