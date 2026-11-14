import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../../lib/api';
import { reportError } from './ReportDialog';

interface Report {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  reviewerId: string | null;
  resolution: string | null;
  createdAt: string;
  snapshot: Record<string, unknown>;
}
const statuses = {
  open: 'Chờ xử lý',
  reviewing: 'Đang xem xét',
  resolved: 'Đã xử lý',
  dismissed: 'Đã bác bỏ',
};
const types: Record<string, string> = {
  user: 'Người dùng',
  message: 'Tin nhắn',
  call: 'Cuộc gọi',
  attachment: 'Ảnh',
};

function ReportEvidence({ row }: { row: Report }) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const blobUrl = useRef('');
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      URL.revokeObjectURL(blobUrl.current);
    };
  }, []);
  const labels: Record<string, string> = {
    displayName: 'Tên hiển thị',
    body: 'Nội dung tin nhắn',
    fileName: 'Tên ảnh',
    mimeType: 'Định dạng',
    size: 'Dung lượng (byte)',
    type: 'Loại',
    status: 'Trạng thái cuộc gọi',
    createdAt: 'Thời gian tạo',
  };
  const values: Record<string, string> = {
    text: 'Văn bản',
    image: 'Ảnh',
    video: 'Video',
    audio: 'Thoại',
    ringing: 'Đang đổ chuông',
    active: 'Đang gọi',
    ended: 'Đã kết thúc',
    rejected: 'Đã từ chối',
    missed: 'Cuộc gọi nhỡ',
    cancelled: 'Đã hủy',
  };
  async function showImage() {
    setLoading(true);
    setError('');
    try {
      const blob = await api.reportImage(row.id);
      if (!alive.current) return;
      URL.revokeObjectURL(blobUrl.current);
      blobUrl.current = URL.createObjectURL(blob);
      setUrl(blobUrl.current);
    } catch {
      if (alive.current)
        setError(
          'Không tải được ảnh. Ảnh có thể đã bị thu hồi hoặc không còn khả dụng.',
        );
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  return (
    <details>
      <summary>Nội dung tại thời điểm báo cáo</summary>
      <dl className="report-queue-detail">
        {Object.entries(labels)
          .filter(([key]) => row.snapshot[key] != null)
          .map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                {key === 'createdAt'
                  ? new Date(String(row.snapshot[key])).toLocaleString('vi-VN')
                  : key === 'type' || key === 'status'
                    ? (values[String(row.snapshot[key])] ??
                      String(row.snapshot[key]))
                    : String(row.snapshot[key])}
              </dd>
            </div>
          ))}
      </dl>
      {(row.targetType === 'attachment' || row.snapshot.type === 'image') && (
        <>
          <button
            className="admin-button"
            disabled={loading}
            onClick={() => void showImage()}
          >
            {loading ? 'Đang tải ảnh…' : 'Xem ảnh được báo cáo'}
          </button>
          {url && (
            <img
              className="report-evidence-image"
              src={url}
              alt="Ảnh được báo cáo để kiểm duyệt"
            />
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </details>
  );
}

function ReportReview({
  row,
  userId,
  onDone,
}: {
  row: Report;
  userId: string;
  onDone: () => Promise<void>;
}) {
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function review(status: 'reviewing' | 'resolved' | 'dismissed') {
    if (lock.current) return;
    if (status !== 'reviewing' && resolution.trim().length < 3) {
      setError('Nhập kết luận tối thiểu 3 ký tự.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.authenticated(
        `/admin/reports/${row.id}`,
        {
          status,
          resolution:
            status === 'reviewing' ? 'Đang xem xét' : resolution.trim(),
        },
        'PATCH',
      );
      await onDone();
    } catch (cause) {
      setError(reportError(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function deleteContentAndResolve() {
    if (lock.current) return;
    if (resolution.trim().length > 0 && resolution.trim().length < 3) {
      setError('Nhập kết luận tối thiểu 3 ký tự.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.authenticated(
        `/admin/content/${row.targetType}/${row.targetId}`,
        undefined,
        'DELETE',
      );
      await api.authenticated(
        `/admin/reports/${row.id}`,
        {
          status: 'resolved',
          resolution:
            resolution.trim().length >= 3
              ? resolution.trim()
              : 'Đã xóa nội dung vi phạm',
        },
        'PATCH',
      );
      await onDone();
    } catch (cause) {
      setError(reportError(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (row.status === 'resolved' || row.status === 'dismissed')
    return <p>Kết luận: {row.resolution}</p>;
  if (row.reporterId === userId)
    return <p>Cần quản trị viên khác xử lý báo cáo do bạn gửi.</p>;
  if (row.reviewerId && row.reviewerId !== userId)
    return <p>Đang được quản trị viên khác xử lý.</p>;
  const canDeleteContent =
    row.targetType === 'message' || row.targetType === 'attachment';
  return (
    <div className="report-review-form">
      <label htmlFor={`resolution-${row.id}`}>Kết luận xử lý</label>
      <textarea
        id={`resolution-${row.id}`}
        value={resolution}
        maxLength={2000}
        disabled={busy}
        onChange={(event) => setResolution(event.target.value)}
        placeholder="Ghi rõ kết quả xác minh và hướng xử lý…"
      />
      {row.status === 'open' && (
        <button
          className="admin-button"
          disabled={busy}
          onClick={() => void review('reviewing')}
        >
          Nhận xem xét
        </button>
      )}
      {canDeleteContent && (
        <button
          className="admin-button danger"
          disabled={busy}
          onClick={() => void deleteContentAndResolve()}
        >
          Xóa nội dung vi phạm &amp; Xử lý
        </button>
      )}
      <button
        className="admin-button"
        disabled={busy}
        onClick={() => void review('resolved')}
      >
        Đã xử lý
      </button>
      <button
        className="admin-button"
        disabled={busy}
        onClick={() => void review('dismissed')}
      >
        Bác bỏ
      </button>
      {error && (
        <p className="report-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function ReportQueue({
  user,
  onCount,
}: {
  user?: api.User;
  onCount: (count: number) => void;
}) {
  const [items, setItems] = useState<Report[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const loadingRef = useRef(false);
  const load = useCallback(
    async (next?: string) => {
      if (!user || loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      setError('');
      try {
        const page = await api.authenticated<{
          items: Report[];
          nextCursor: string | null;
          pendingCount: number;
        }>(`/admin/reports?limit=20${next ? `&cursor=${next}` : ''}`);
        if (!alive.current) return;
        setItems((previous) =>
          next
            ? [
                ...previous,
                ...page.items.filter(
                  (item) => !previous.some((old) => old.id === item.id),
                ),
              ]
            : page.items,
        );
        setCursor(page.nextCursor);
        setPending(page.pendingCount);
        onCount(page.pendingCount);
      } catch (cause) {
        if (alive.current) setError(reportError(cause));
      } finally {
        loadingRef.current = false;
        if (alive.current) setLoading(false);
      }
    },
    [user, onCount],
  );
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [load]);
  return (
    <section className="admin-panel">
      <div className="admin-panel-heading">
        <div>
          <h2>Hàng đợi kiểm duyệt</h2>
          <p>
            {user
              ? `${pending} báo cáo đang chờ xử lý`
              : 'Đăng nhập bằng tài khoản quản trị viên để xem báo cáo thật.'}
          </p>
        </div>
        <button
          className="admin-button"
          disabled={!user || loading}
          onClick={() => void load()}
        >
          Tải lại
        </button>
      </div>
      {error && (
        <p className="report-error" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">Đang tải báo cáo…</p>}
      {!loading && !error && user && !items.length && (
        <p>Chưa có báo cáo vi phạm.</p>
      )}
      <div className="admin-report-list">
        {items.map((row) => (
          <article className="admin-report" key={row.id}>
            <div>
              <small>
                {types[row.targetType] ?? row.targetType} ·{' '}
                {new Date(row.createdAt).toLocaleString('vi-VN')}
              </small>
              <h3>{row.reason}</h3>
              <span className="admin-status">{statuses[row.status]}</span>
              <p>
                Mã báo cáo: {row.id}
                <br />
                Người gửi: {row.reporterId}
                <br />
                Đối tượng: {row.targetId}
              </p>
              <ReportEvidence row={row} />
              <ReportReview row={row} userId={user!.id} onDone={() => load()} />
            </div>
          </article>
        ))}
      </div>
      {cursor && (
        <button
          className="admin-button"
          disabled={loading}
          onClick={() => void load(cursor)}
        >
          Xem thêm báo cáo
        </button>
      )}
    </section>
  );
}
