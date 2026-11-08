import { useEffect, useRef, useState } from 'react';
import * as api from '../../lib/api';
import type { Message } from '../../lib/chat-model';

export function SharedFileRow({ message }: { message: Message }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const url = useRef('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);
  const name = message.content?.fileName ?? message.body ?? 'Tệp đính kèm';
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const kind =
    extension === 'pdf'
      ? 'pdf'
      : ['doc', 'docx'].includes(extension)
        ? 'word'
        : ['xls', 'xlsx', 'csv'].includes(extension)
          ? 'sheet'
          : 'other';
  const label = { pdf: 'PDF', word: 'W', sheet: 'X', other: 'FILE' }[kind];
  const size = message.content?.size;
  const date = new Date(message.createdAt);
  async function download() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const blob = await api.chatFile(message.conversationId, message.id);
      if (!alive.current) return;
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url.current;
      link.download = name;
      link.click();
    } catch (error) {
      if (alive.current) setError(api.errorMessage(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="shared-file-item">
      <button
        type="button"
        className="shared-file-row"
        onClick={() => void download()}
        disabled={busy}
        title={name}
        aria-label={`Tải tệp ${name}`}
      >
        <span className={`shared-file-icon ${kind}`} aria-hidden="true">
          {label}
        </span>
        <span className="shared-file-copy">
          <span className="shared-file-name">{busy ? 'Đang tải…' : name}</span>
          <span className="shared-file-meta">
            <span>
              {size == null
                ? 'Tệp đính kèm'
                : size >= 1048576
                  ? `${(size / 1048576).toFixed(2)} MB`
                  : `${(size / 1024).toFixed(1)} KB`}
            </span>
            <time dateTime={message.createdAt}>
              {Number.isNaN(date.getTime())
                ? ''
                : date.toLocaleDateString('vi-VN')}
            </time>
          </span>
        </span>
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
