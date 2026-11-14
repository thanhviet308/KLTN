import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Flag, X } from 'lucide-react';
import * as api from '../../lib/api';
import './reports.css';

export interface ReportTarget {
  targetType: 'user' | 'message' | 'call' | 'attachment';
  targetId: string;
  label: string;
}
export function reportError(error: unknown) {
  if (error instanceof api.ApiError) {
    const messages: Record<string, string> = {
      REPORT_TARGET_UNAVAILABLE:
        'Nội dung không còn khả dụng hoặc bạn không có quyền xem.',
      REPORT_SELF: 'Bạn không thể báo cáo chính mình.',
      REPORT_RATE_LIMIT:
        'Bạn đã gửi nhiều báo cáo. Vui lòng thử lại sau một giờ.',
      ADMIN_REQUIRED: 'Chỉ quản trị viên được xem hàng đợi báo cáo.',
      REPORT_SELF_REVIEW: 'Bạn không thể xử lý báo cáo do chính mình gửi.',
      REPORT_CLOSED: 'Báo cáo đã được xử lý. Hãy tải lại danh sách.',
      REPORT_ASSIGNED: 'Một quản trị viên khác đang xử lý báo cáo này.',
    };
    if (messages[error.code]) return messages[error.code];
  }
  return api.errorMessage(error);
}

export function ReportDialog({
  target,
  onClose,
}: {
  target: ReportTarget;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [category, setCategory] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current!;
    element.showModal();
    return () => {
      element.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const reason = [category, detail.trim()].filter(Boolean).join(': ');
    if (!category || (category === 'Khác' && detail.trim().length < 3)) {
      setError('Chọn lý do; nếu chọn Khác, hãy mô tả ít nhất 3 ký tự.');
      return;
    }
    if (reason.length > 2000) {
      setError('Nội dung báo cáo tối đa 2.000 ký tự.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api.authenticated<{ duplicate: boolean }>(
        '/reports',
        { targetType: target.targetType, targetId: target.targetId, reason },
      );
      setSuccess(
        result.duplicate
          ? 'Bạn đã báo cáo nội dung này. Quản trị viên đang chờ xử lý.'
          : 'Đã gửi báo cáo đến quản trị viên. Cảm ơn bạn đã phản ánh.',
      );
    } catch (cause) {
      setError(reportError(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return createPortal(
    <dialog
      className="report-dialog"
      ref={dialog}
      aria-labelledby="report-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="report-heading">
        <h2 id="report-title">Báo cáo vi phạm</h2>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          aria-label="Đóng báo cáo"
        >
          <X size={20} />
        </button>
      </div>
      <p className="report-target">{target.label}</p>
      {success ? (
        <>
          <p role="status">{success}</p>
          <button className="report-submit" onClick={onClose}>
            Đóng
          </button>
        </>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <p>
            Quản trị viên sẽ xem nội dung được báo cáo để xác minh. Gửi báo cáo
            không tự động xóa nội dung hay khóa tài khoản.
          </p>
          <label htmlFor="report-category">Lý do báo cáo</label>
          <select
            id="report-category"
            required
            value={category}
            disabled={busy}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">Chọn lý do</option>
            {[
              'Spam hoặc quảng cáo',
              'Quấy rối hoặc xúc phạm',
              'Lừa đảo hoặc giả mạo',
              'Nội dung không phù hợp',
              'Đe dọa hoặc bạo lực',
              'Khác',
            ].map((reason) => (
              <option key={reason}>{reason}</option>
            ))}
          </select>
          <label htmlFor="report-detail">
            Mô tả thêm {category === 'Khác' ? '(bắt buộc)' : '(không bắt buộc)'}
          </label>
          <textarea
            id="report-detail"
            rows={4}
            maxLength={1900}
            required={category === 'Khác'}
            disabled={busy}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            placeholder="Mô tả sự việc để quản trị viên có thể xem xét…"
          />
          <small>{detail.length}/1.900 ký tự</small>
          {error && (
            <p className="report-error" role="alert">
              {error}
            </p>
          )}
          <div className="report-footer">
            <button type="button" disabled={busy} onClick={onClose}>
              Hủy
            </button>
            <button className="report-submit" disabled={busy || !category}>
              {busy ? 'Đang gửi…' : 'Gửi báo cáo'}
            </button>
          </div>
        </form>
      )}
    </dialog>,
    document.body,
  );
}

export function ReportButton({
  target,
  compact = false,
}: {
  target: ReportTarget;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`report-trigger${compact ? ' is-compact' : ''}`}
        title={target.label}
        data-tooltip={compact ? target.label : undefined}
        aria-label={target.label}
        onClick={() => setOpen(true)}
      >
        <Flag size={15} aria-hidden="true" />
        {!compact && <span>Báo cáo</span>}
      </button>
      {open && <ReportDialog target={target} onClose={() => setOpen(false)} />}
    </>
  );
}
