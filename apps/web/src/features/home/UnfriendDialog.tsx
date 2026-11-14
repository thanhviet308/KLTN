import { useEffect, useRef } from 'react';
import type { Peer } from '../../lib/types';
import { Avatar } from '../../components/Avatar';
import './unfriend-dialog.css';

export function UnfriendDialog({
  peer,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  peer: Peer;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const trigger = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    cancelRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="unfriend-dialog"
      aria-labelledby="unfriend-title"
      aria-describedby="unfriend-description"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="unfriend-dialog-avatar" aria-hidden="true">
        <Avatar peer={peer} />
      </div>
      <h2 id="unfriend-title">Hủy kết bạn?</h2>
      <p id="unfriend-description">
        Bạn sẽ xóa <strong>{peer.displayName}</strong> khỏi danh sách bạn bè.
        Bạn có thể gửi lại lời mời kết bạn sau này.
      </p>
      {error && (
        <p className="unfriend-dialog-error" role="alert">
          {error}
        </p>
      )}
      <div className="unfriend-dialog-actions">
        <button
          ref={cancelRef}
          type="button"
          disabled={busy}
          onClick={onCancel}
        >
          Giữ kết bạn
        </button>
        <button
          type="button"
          className="unfriend-dialog-confirm"
          disabled={busy}
          onClick={onConfirm}
        >
          {busy ? 'Đang hủy…' : 'Hủy kết bạn'}
        </button>
      </div>
    </dialog>
  );
}
