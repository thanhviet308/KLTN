import { useEffect, useRef, useState } from 'react';
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
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const alive = useRef(true);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      setRecording(true);
      timer.current = setTimeout(() => {
        if (next.state === 'recording') next.stop();
      }, 60000);
    } catch {
      stream.current?.getTracks().forEach((track) => track.stop());
      if (alive.current)
        onError('Không thể ghi âm. Kiểm tra quyền truy cập micro.');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function locate() {
    if (!navigator.geolocation) {
      onError('Trình duyệt không hỗ trợ vị trí.');
      return;
    }
    setBusy(true);
    const version = generation.current;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!alive.current || version !== generation.current) return;
        void send({
          type: 'location',
          location: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
        });
      },
      () => {
        if (!alive.current) return;
        setBusy(false);
        onError('Không lấy được vị trí. Kiểm tra quyền truy cập vị trí.');
      },
      { timeout: 10000, maximumAge: 0, enableHighAccuracy: false },
    );
  }
  return (
    <div className="media-tools">
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
        type="button"
        disabled={disabled || busy || recording}
        onClick={() => input.current?.click()}
      >
        Ảnh / Tệp
      </button>
      {recording ? (
        <>
          <button type="button" onClick={() => recorder.current?.stop()}>
            Dừng và gửi bản ghi âm
          </button>
          <button
            type="button"
            onClick={() => {
              generation.current++;
              recorder.current?.stop();
              clearTimeout(timer.current);
              stream.current?.getTracks().forEach((track) => track.stop());
              setRecording(false);
            }}
          >
            Hủy ghi âm
          </button>
          <span>Đang ghi âm · tối đa 60 giây</span>
        </>
      ) : (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void record()}
        >
          Ghi âm
        </button>
      )}
      <button
        type="button"
        disabled={disabled || busy || recording}
        onClick={locate}
      >
        Chia sẻ vị trí hiện tại
      </button>
      {busy && <span>Đang xử lý…</span>}
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
    <div ref={holder} className="message-media">
      {message.type === 'image' && url ? (
        <a href={url} target="_blank" rel="noopener noreferrer">
          <img src={url} alt={message.content?.fileName ?? 'Ảnh được gửi'} />
        </a>
      ) : message.type === 'voice' && url ? (
        <audio controls preload="metadata" src={url} />
      ) : (
        <button
          type="button"
          disabled={loading}
          onClick={() => void load(message.type === 'file')}
        >
          {loading
            ? 'Đang tải…'
            : message.type === 'voice'
              ? '▶ Nghe tin nhắn thoại'
              : message.type === 'image'
                ? 'Xem ảnh'
                : `↓ ${message.content?.fileName ?? 'Tải tệp'}`}
        </button>
      )}
      {message.content?.size && (
        <small>{(message.content.size / 1024).toFixed(1)} KB</small>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
