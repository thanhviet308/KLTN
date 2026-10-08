import { useEffect, useRef, useState } from 'react';
import { UiIcon } from './UiIcon';
import { LocationMap } from './LocationMap';
import * as api from './api';
import type { Message } from './chat-model';

export interface MediaDraft {
  type: 'image' | 'file' | 'voice' | 'location';
  file?: File;
  location?: { latitude: number; longitude: number };
}

export function MediaTools({
  disabled,
  onSend,
  onError,
}: {
  disabled: boolean;
  onSend: (draft: MediaDraft) => Promise<void>;
  onError: (error: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [location, setLocation] = useState<MediaDraft['location']>();
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationError, setLocationError] = useState('');
  const locationDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (locationOpen && !disabled) locationDialog.current?.showModal();
    else locationDialog.current?.close();
  }, [locationOpen, disabled]);
  const input = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const alive = useRef(true);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    const tick = setInterval(
      () => setSeconds(Math.floor((Date.now() - startedAt) / 1000)),
      250,
    );
    return () => clearInterval(tick);
  }, [recording]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      clearTimeout(timer.current);
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    if (!disabled) return;
    generation.current++;
    clearTimeout(timer.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
    setBusy(false);
    setLocation(undefined);
    setLocationOpen(false);
  }, [disabled]);
  const send = async (draft: MediaDraft) => {
    if (
      draft.file &&
      (draft.file.size === 0 || draft.file.size > 10 * 1024 * 1024)
    ) {
      onError('Chọn tệp có dung lượng từ 1 byte đến 10 MB.');
      return;
    }
    setBusy(true);
    try {
      await onSend(draft);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  async function record() {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === 'undefined'
    ) {
      onError(
        'Trình duyệt này chưa hỗ trợ ghi âm. Hãy dùng HTTPS hoặc localhost.',
      );
      return;
    }
    setBusy(true);
    const version = generation.current;
    setStarting(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current || version !== generation.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = media;
      const mime = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/mp4',
      ].find((value) => MediaRecorder.isTypeSupported(value));
      if (!mime) throw new Error('Unsupported recorder');
      const next = new MediaRecorder(media, { mimeType: mime });
      const chunks: Blob[] = [];
      let size = 0;
      next.ondataavailable = (event) => {
        chunks.push(event.data);
        size += event.data.size;
        if (size > 10 * 1024 * 1024 && next.state === 'recording') next.stop();
      };
      next.onerror = () => {
        generation.current++;
        media.getTracks().forEach((track) => track.stop());
        clearTimeout(timer.current);
        if (alive.current) {
          setRecording(false);
          onError('Không thể ghi âm.');
        }
      };
      next.onstop = () => {
        clearTimeout(timer.current);
        media.getTracks().forEach((track) => track.stop());
        if (!alive.current || version !== generation.current) return;
        setRecording(false);
        const extension = mime.startsWith('audio/mp4')
          ? 'm4a'
          : mime.startsWith('audio/ogg')
            ? 'ogg'
            : 'webm';
        void send({
          type: 'voice',
          file: new File(chunks, `voice-${Date.now()}.${extension}`, {
            type: mime,
          }),
        });
      };
      recorder.current = next;
      next.start(1000);
      setSeconds(0);
      setRecording(true);
      timer.current = setTimeout(() => {
        if (next.state === 'recording') next.stop();
      }, 60000);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (alive.current)
        onError('Không thể ghi âm. Kiểm tra quyền truy cập micro.');
    } finally {
      if (alive.current) {
        setBusy(false);
        setStarting(false);
      }
    }
  }
  function locate() {
    if (!navigator.geolocation) {
      onError('Trình duyệt không hỗ trợ vị trí.');
      return;
    }
    setBusy(true);
    setLocation(undefined);
    setLocationError('');
    setLocationOpen(true);
    // Fetch the code in parallel with geolocation, without requesting map tiles.
    void import('leaflet').catch(() => {});
    const version = generation.current;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!alive.current || version !== generation.current) return;
        setBusy(false);
        setLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        if (!alive.current || version !== generation.current) return;
        setBusy(false);
        setLocationError(
          error.code === 1
            ? 'Hãy cho phép trình duyệt truy cập vị trí rồi thử lại.'
            : 'Chưa lấy được vị trí. Kiểm tra kết nối và thử lại.',
        );
      },
      { timeout: 10000, maximumAge: 30000, enableHighAccuracy: false },
    );
  }
  function closeLocation() {
    generation.current++;
    setLocationOpen(false);
    setLocation(undefined);
    setBusy(false);
  }
  return (
    <div className={`media-tools${recording ? ' is-recording' : ''}`}>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file)
            void send({
              file,
              type: /^image\/(png|jpeg|webp)$/.test(file.type)
                ? 'image'
                : 'file',
            });
        }}
      />
      <button
        className="media-file-button"
        type="button"
        disabled={disabled || busy || recording}
        onClick={() => input.current?.click()}
        aria-label="Gửi ảnh hoặc tệp"
        title="Gửi ảnh hoặc tệp"
      >
        <UiIcon name="image" />
      </button>
      {recording ? (
        <>
          <button
            className="record-stop"
            type="button"
            aria-label="Dừng và gửi bản ghi âm"
            title="Dừng và gửi bản ghi âm"
            onClick={() => recorder.current?.stop()}
          >
            <UiIcon name="stop" />
            <span>Dừng và gửi</span>
          </button>
          <button
            className="record-cancel"
            type="button"
            aria-label="Hủy ghi âm"
            title="Hủy ghi âm"
            onClick={() => {
              generation.current++;
              recorder.current?.stop();
              clearTimeout(timer.current);
              stream.current?.getTracks().forEach((track) => track.stop());
              setRecording(false);
            }}
          >
            <UiIcon name="close" />
            <span>Hủy</span>
          </button>
          <div
            className="recording-info"
            role="status"
            aria-label="Đang ghi âm"
          >
            <span className="recording-dot" aria-hidden="true" />
            <span>
              Đang ghi âm{' '}
              <strong>
                {Math.floor(seconds / 60)}:
                {String(seconds % 60).padStart(2, '0')}
              </strong>
              <small> / 1:00</small>
            </span>
          </div>
        </>
      ) : (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void record()}
          className="record-button"
          aria-label="Ghi âm"
          title="Ghi âm"
        >
          <UiIcon name="microphone" />
        </button>
      )}
      <button
        className="media-location-button"
        type="button"
        disabled={disabled || busy || recording}
        onClick={locate}
        aria-label="Chia sẻ vị trí hiện tại"
        title="Chia sẻ vị trí hiện tại"
      >
        <UiIcon name="location" />
      </button>
      {busy && (
        <span className="media-status" role="status">
          {starting ? 'Đang chờ quyền truy cập micro…' : 'Đang xử lý…'}
        </span>
      )}
      <dialog
        ref={locationDialog}
        className="location-preview"
        aria-labelledby="location-preview-title"
        onCancel={closeLocation}
      >
        {locationOpen && (
          <>
            <header>
              <h2 id="location-preview-title">Chia sẻ vị trí hiện tại</h2>
              <button
                type="button"
                aria-label="Đóng bản đồ"
                disabled={busy && !!location}
                onClick={closeLocation}
              >
                <UiIcon name="close" />
              </button>
            </header>
            {location ? (
              <>
                <LocationMap
                  latitude={location.latitude}
                  longitude={location.longitude}
                />
                <p>Kiểm tra vị trí trên bản đồ trước khi chia sẻ.</p>
                <small>
                  {location.latitude.toFixed(5)},{' '}
                  {location.longitude.toFixed(5)}
                  {' · '}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Mở bản đồ
                  </a>
                </small>
              </>
            ) : (
              <div className="location-pending" role="status">
                {locationError ||
                  'Đang lấy vị trí… Nếu được hỏi, hãy cho phép truy cập vị trí.'}
                {locationError && (
                  <button type="button" onClick={locate}>
                    Thử lại
                  </button>
                )}
              </div>
            )}
            <footer>
              <button
                type="button"
                disabled={busy && !!location}
                onClick={closeLocation}
              >
                Hủy
              </button>
              <button
                type="button"
                className="location-share"
                disabled={disabled || busy || !location}
                onClick={async () => {
                  try {
                    if (!location) return;
                    await send({ type: 'location', location });
                    if (alive.current) closeLocation();
                  } catch (error) {
                    if (alive.current) onError(api.errorMessage(error));
                  }
                }}
              >
                {busy && location ? 'Đang gửi…' : 'Chia sẻ'}
              </button>
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}

function VoicePlayer({
  url,
  onLoad,
}: {
  url: string;
  onLoad: () => Promise<string | undefined>;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function toggle() {
    if (!audio.current || loading) return;
    if (playing) {
      audio.current.pause();
      return;
    }
    setError('');
    setLoading(true);
    try {
      const source = url || (await onLoad());
      if (!source || !audio.current) return;
      // Keep source assignment imperative: a React src update after loading
      // would restart the element and interrupt the pending play() promise.
      if (audio.current.getAttribute('src') !== source)
        audio.current.src = source;
      await audio.current.play();
    } catch (cause) {
      if (audio.current)
        setError(
          cause instanceof DOMException && cause.name === 'NotAllowedError'
            ? 'Trình duyệt chưa cho phát âm thanh. Bấm phát lại.'
            : 'Không phát được bản ghi âm. Hãy thử lại.',
        );
    } finally {
      if (audio.current) setLoading(false);
    }
  }
  const time = (value: number) =>
    `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  return (
    <div className="voice-player">
      <audio
        ref={audio}
        preload="metadata"
        onLoadedMetadata={() => {
          const value = audio.current?.duration;
          if (value && Number.isFinite(value)) setDuration(value);
        }}
        onDurationChange={() => {
          const value = audio.current?.duration;
          if (value && Number.isFinite(value)) setDuration(value);
        }}
        onTimeUpdate={() => setCurrent(audio.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setError('Không phát được bản ghi âm.')}
      />
      <button
        type="button"
        className="voice-play"
        disabled={loading}
        aria-busy={loading}
        aria-label={
          loading
            ? 'Đang tải bản ghi âm'
            : playing
              ? 'Tạm dừng bản ghi âm'
              : 'Phát bản ghi âm'
        }
        onClick={() => void toggle()}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          {loading ? (
            <circle
              className="voice-loading"
              cx="12"
              cy="12"
              r="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray="35 15"
            />
          ) : playing ? (
            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
          ) : (
            <path d="m7 4 14 8-14 8z" />
          )}
        </svg>
      </button>
      <input
        type="range"
        aria-label="Vị trí phát bản ghi âm"
        min={0}
        max={duration || 1}
        step={0.1}
        value={Math.min(current, duration || 1)}
        disabled={!duration}
        onChange={(event) => {
          if (audio.current)
            audio.current.currentTime = Number(event.target.value);
        }}
      />
      <span className="voice-time">
        {time(playing || current > 0 ? current : duration)}
      </span>
      {error && (
        <small className="voice-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function MessageMedia({ message }: { message: Message }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const objectUrl = useRef('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);
  async function load(download = false) {
    setLoading(true);
    setError('');
    try {
      const blob = await api.chatFile(message.conversationId, message.id);
      if (!alive.current) return;
      const next = URL.createObjectURL(blob);
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = next;
      setUrl(next);
      if (download) {
        const anchor = document.createElement('a');
        anchor.href = next;
        anchor.download = message.content?.fileName ?? 'file';
        anchor.click();
      }
      return next;
    } catch (error) {
      if (alive.current) setError(api.errorMessage(error));
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (message.type !== 'image' || !holder.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        void load();
      }
    });
    observer.observe(holder.current);
    return () => observer.disconnect();
    // A message's file is immutable; fetch only when the image is visible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message.id]);
  if (message.type === 'location') {
    const lat = message.content?.latitude;
    const lon = message.content?.longitude;
    if (lat === undefined || lon === undefined)
      return <span>Vị trí không khả dụng</span>;
    return (
      <a
        className="location-message"
        target="_blank"
        rel="noopener noreferrer"
        href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`}
      >
        📍 Vị trí được chia sẻ
        <br />
        <small>
          {lat.toFixed(5)}, {lon.toFixed(5)} · Mở bản đồ
        </small>
      </a>
    );
  }
  return (
    <div
      ref={holder}
      className={`message-media${message.type === 'voice' ? ' voice-message' : ''}`}
    >
      {message.type === 'image' && url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={message.content?.fileName ?? 'Ảnh được gửi'} />
        </a>
      ) : message.type === 'voice' ? (
        <VoicePlayer url={url} onLoad={() => load()} />
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(message.type === 'file')}
        >
          {loading
            ? 'Đang tải…'
            : message.type === 'image'
              ? 'Xem ảnh'
              : `↓ ${message.content?.fileName ?? 'Tải tệp'}`}
        </button>
      )}
      {message.type !== 'voice' && message.content?.size && (
        <small>{(message.content.size / 1024).toFixed(1)} KB</small>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
