import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { UiIcon } from '../../components/UiIcon';
import { LocationMap } from './LocationMap';
import {
  decodeVoiceDuration,
  validVoiceDuration,
  voiceTimeline,
} from './voice-timeline';
import * as api from '../../lib/api';
import type { Message } from '../../lib/chat-model';
import {
  classifyChatUpload,
  MAX_CHAT_FILE_BYTES,
  prepareChatUploadFile,
} from './image-upload';
import {
  DEFAULT_MAP_LOCATION,
  formatGeolocationError,
  getGeolocationAttemptOptions,
  isEmbeddedInAppBrowser,
} from './location-helper';

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
  const [locationDenied, setLocationDenied] = useState(false);
  const [manualLocation, setManualLocation] = useState(false);
  const locationDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = locationDialog.current;
    if (!dialog) return;
    if (locationOpen && !disabled) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [locationOpen, disabled]);
  const input = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const alive = useRef(true);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const locationWatchdog = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
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
      clearTimeout(locationWatchdog.current);
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    if (!disabled) return;
    generation.current++;
    clearTimeout(timer.current);
    clearTimeout(locationWatchdog.current);
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    setRecording(false);
    setBusy(false);
    setLocation(undefined);
    setManualLocation(false);
    setLocationOpen(false);
  }, [disabled]);
  const send = async (draft: MediaDraft) => {
    if (draft.file && draft.file.size === 0) {
      onError('Chọn tệp có dung lượng từ 1 byte đến 10 MB.');
      return;
    }
    if (
      draft.file &&
      draft.type !== 'image' &&
      draft.file.size > MAX_CHAT_FILE_BYTES
    ) {
      onError('Chọn tệp có dung lượng từ 1 byte đến 10 MB.');
      return;
    }
    setBusy(true);
    try {
      let nextDraft = draft;
      if (draft.file && draft.type === 'image') {
        const prepared = await prepareChatUploadFile(draft.file);
        if (
          prepared.file.size === 0 ||
          prepared.file.size > MAX_CHAT_FILE_BYTES
        ) {
          if (alive.current) {
            onError('Chọn tệp có dung lượng từ 1 byte đến 10 MB.');
          }
          return;
        }
        nextDraft = { ...draft, file: prepared.file, type: prepared.type };
      }
      await onSend(nextDraft);
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
    const version = ++generation.current;
    clearTimeout(locationWatchdog.current);
    setLocationDenied(false);
    if (!navigator.geolocation) {
      setLocation(undefined);
      setManualLocation(false);
      setLocationError(
        'Trình duyệt không hỗ trợ lấy vị trí tự động. Bạn vẫn có thể chọn vị trí trực tiếp trên bản đồ.',
      );
      setLocationOpen(true);
      void import('leaflet').catch(() => {});
      return;
    }
    const embedded = isEmbeddedInAppBrowser(navigator.userAgent);
    const userAgent = navigator.userAgent;
    clearTimeout(locationWatchdog.current);
    setManualLocation(false);
    setLocation(undefined);
    setLocationError('');
    setLocationOpen(true);

    if (window.isSecureContext === false) {
      setBusy(false);
      setLocationError(
        formatGeolocationError({ embedded, secureContext: false }),
      );
      void import('leaflet').catch(() => {});
      return;
    }

    setBusy(true);
    // Fetch the code in parallel with geolocation, without requesting map tiles.
    void import('leaflet').catch(() => {});
    const policyDocument = document as Document & {
      permissionsPolicy?: { allowsFeature: (feature: string) => boolean };
      featurePolicy?: { allowsFeature: (feature: string) => boolean };
    };
    const policy =
      policyDocument.permissionsPolicy ?? policyDocument.featurePolicy;
    const policyAllowed = policy?.allowsFeature('geolocation');
    if (policyAllowed === false) {
      setBusy(false);
      setLocationError(formatGeolocationError({ embedded, policyAllowed }));
      return;
    }
    let permissionState: PermissionState | undefined;
    let lastFailure: { code?: number; browserMessage?: string } | undefined;
    // Query alongside the request: do not await and lose the button's user gesture.
    try {
      void navigator.permissions
        ?.query({ name: 'geolocation' })
        .then((status) => {
          if (!alive.current || version !== generation.current) return;
          permissionState = status.state;
          if (lastFailure)
            setLocationError(
              formatGeolocationError({
                ...lastFailure,
                userAgent,
                embedded,
                permissionState,
                policyAllowed,
              }),
            );
        })
        .catch(() => {});
    } catch {
      /* Older browsers may not support querying this permission. */
    }
    const requestPosition = (highAccuracy: boolean) => {
      let settled = false;
      const attempt = getGeolocationAttemptOptions(embedded, highAccuracy);
      const failAttempt = (code?: number, browserMessage?: string) => {
        if (settled || !alive.current || version !== generation.current) return;
        settled = true;
        clearTimeout(locationWatchdog.current);
        // If coarse/network location fails or stalls, try high-accuracy once before giving up.
        if (code !== 1 && !highAccuracy) {
          locationWatchdog.current = setTimeout(() => {
            if (alive.current && version === generation.current)
              requestPosition(true);
          }, 300);
          return;
        }
        setBusy(false);
        setLocationDenied(code === 1);
        lastFailure = { code, browserMessage };
        setLocationError(
          formatGeolocationError({
            code,
            embedded,
            secureContext: window.isSecureContext,
            permissionState,
            policyAllowed,
            browserMessage,
            userAgent,
          }),
        );
      };

      // Guard against WebViews that silently ignore getCurrentPosition without calling error().
      locationWatchdog.current = setTimeout(() => {
        failAttempt(3);
      }, attempt.watchdogMs);

      try {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (settled || !alive.current || version !== generation.current)
              return;
            settled = true;
            clearTimeout(locationWatchdog.current);
            setBusy(false);
            setManualLocation(false);
            setLocation({
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            });
          },
          (error) => failAttempt(error.code, error.message),
          {
            timeout: attempt.timeoutMs,
            maximumAge: attempt.maximumAgeMs,
            enableHighAccuracy: attempt.enableHighAccuracy,
          },
        );
      } catch {
        failAttempt(2);
      }
    };
    requestPosition(false);
  }
  function pickLocationManually() {
    generation.current++;
    clearTimeout(locationWatchdog.current);
    setBusy(false);
    setLocationError('');
    setManualLocation(true);
    setLocation(DEFAULT_MAP_LOCATION);
  }
  function closeLocation() {
    generation.current++;
    clearTimeout(locationWatchdog.current);
    setLocationOpen(false);
    setLocation(undefined);
    setManualLocation(false);
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
              type: classifyChatUpload(file),
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
      {busy && !locationOpen && (
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
                  zoom={manualLocation ? 12 : 16}
                  onSelect={setLocation}
                />
                <p>
                  {manualLocation
                    ? 'Nhấp hoặc chạm vào bản đồ để đặt ghim vị trí muốn chia sẻ.'
                    : 'Kiểm tra hoặc chạm vào bản đồ để điều chỉnh vị trí trước khi chia sẻ.'}
                </p>
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
                <span>
                  {locationError ||
                    'Đang lấy vị trí… Hãy cho phép truy cập khi trình duyệt hỏi. Nếu không thấy hộp thoại, kiểm tra biểu tượng vị trí ở bên phải thanh địa chỉ.'}
                </span>
                {locationError && (
                  <div className="location-pending-actions">
                    <button type="button" onClick={locate}>
                      {locationDenied
                        ? 'Đã bật quyền, kiểm tra lại'
                        : 'Thử lại'}
                    </button>
                    <button
                      type="button"
                      className="location-share"
                      onClick={pickLocationManually}
                    >
                      Chọn trên bản đồ
                    </button>
                  </div>
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
  const durationRequest = useRef<AbortController | null>(null);
  const decodedDuration = useRef(0);
  useEffect(() => () => durationRequest.current?.abort(), []);

  function syncDuration() {
    const element = audio.current;
    if (!element) return;
    if (validVoiceDuration(element.duration)) {
      setDuration(decodedDuration.current || element.duration);
      return;
    }
    if (!element.src || durationRequest.current) return;
    const controller = new AbortController();
    durationRequest.current = controller;
    void decodeVoiceDuration(element.src, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && audio.current === element && value) {
          decodedDuration.current = value;
          setDuration(value);
        }
      })
      .catch(() => {
        // Playback still works when decoding is unsupported. Keep the seek
        // control unavailable until the media element learns its duration.
      });
  }
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
      if (audio.current.getAttribute('src') !== source) {
        durationRequest.current?.abort();
        durationRequest.current = null;
        decodedDuration.current = 0;
        setCurrent(0);
        setDuration(0);
        audio.current.src = source;
      }
      if (audio.current.ended) audio.current.currentTime = 0;
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
  const timeline = voiceTimeline(current, duration);
  return (
    <div className="voice-player">
      <audio
        ref={audio}
        preload="metadata"
        onLoadedMetadata={syncDuration}
        onDurationChange={syncDuration}
        onTimeUpdate={() => setCurrent(audio.current?.currentTime ?? 0)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          const element = audio.current;
          if (element) {
            setCurrent(element.currentTime);
            if (!validVoiceDuration(duration) && element.currentTime > 0)
              setDuration(element.currentTime);
          }
        }}
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
        max={timeline.max}
        step={0.1}
        value={timeline.value}
        disabled={!timeline.known}
        aria-valuetext={`${time(timeline.elapsed)} / ${timeline.known ? time(duration) : 'Đang xác định thời lượng'}`}
        onChange={(event) => {
          if (audio.current) {
            audio.current.currentTime = Number(event.target.value);
            setCurrent(audio.current.currentTime);
          }
        }}
      />
      <span className="voice-time">
        {time(timeline.elapsed)} / {timeline.known ? time(duration) : '--:--'}
      </span>
      {error && (
        <small className="voice-error" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}

export function MessageMedia({
  message,
  transcribing = false,
  transcribed = false,
  onTranscribe,
}: {
  message: Message;
  transcribing?: boolean;
  transcribed?: boolean;
  onTranscribe?: () => void;
}) {
  if (message.type === 'call') {
    const seconds = Math.max(0, message.content?.durationSeconds ?? 0);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    const duration = [
      hours ? `${hours} giờ` : '',
      minutes ? `${minutes} phút` : '',
      remainingSeconds || (!hours && !minutes)
        ? `${remainingSeconds} giây`
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    const type = message.content?.callType === 'video' ? 'video' : 'thoại';
    const status = message.content?.callStatus;
    const occurredAt = new Intl.DateTimeFormat('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(message.createdAt));
    const label =
      status === 'missed'
        ? `Cuộc gọi ${type} bị nhỡ`
        : status === 'rejected'
          ? `Cuộc gọi ${type} bị từ chối`
          : status === 'cancelled'
            ? `Cuộc gọi ${type} đã hủy`
            : `Cuộc gọi ${type}`;
    return (
      <span className={`call-message${status === 'missed' ? ' missed' : ''}`}>
        <UiIcon
          name={message.content?.callType === 'video' ? 'video' : 'phone'}
        />
        <span>
          <strong>{label}</strong>
          {status === 'ended' && <small>{duration}</small>}
          {status === 'missed' && (
            <time className="call-message-time" dateTime={message.createdAt}>
              {occurredAt}
            </time>
          )}
        </span>
      </span>
    );
  }
  const [url, setUrl] = useState(() =>
    message.type === 'image' || message.type === 'voice'
      ? api.peekChatFileUrl(message.conversationId, message.id)
      : '',
  );
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const ephemeralUrl = useRef('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (ephemeralUrl.current) URL.revokeObjectURL(ephemeralUrl.current);
    };
  }, []);
  async function load(download = false) {
    setLoading(true);
    setError('');
    try {
      const result = await api.chatFileUrl(message.conversationId, message.id);
      if (!alive.current) {
        if (result.ephemeral) URL.revokeObjectURL(result.url);
        return;
      }
      if (ephemeralUrl.current && ephemeralUrl.current !== result.url) {
        URL.revokeObjectURL(ephemeralUrl.current);
        ephemeralUrl.current = '';
      }
      if (result.ephemeral) ephemeralUrl.current = result.url;
      setUrl(result.url);
      if (download) {
        const anchor = document.createElement('a');
        anchor.href = result.url;
        anchor.download = message.content?.fileName ?? 'file';
        anchor.click();
      }
      return result.url;
    } catch (error) {
      if (alive.current) setError(api.errorMessage(error));
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (message.type !== 'image' || !holder.current) return;
    const cached = api.peekChatFileUrl(message.conversationId, message.id);
    if (cached) {
      setUrl(cached);
      return;
    }
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
        <>
          <VoicePlayer url={url} onLoad={() => load()} />
          {onTranscribe && !transcribed && (
            <button
              type="button"
              className="voice-transcribe-trigger"
              disabled={transcribing}
              onClick={onTranscribe}
            >
              <Sparkles size={12} aria-hidden="true" />
              <span>{transcribing ? 'Đang chép…' : 'Chép lời'}</span>
            </button>
          )}
        </>
      ) : (
        <button
          type="button"
          className={
            message.type === 'image'
              ? 'message-media-image-placeholder'
              : undefined
          }
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
