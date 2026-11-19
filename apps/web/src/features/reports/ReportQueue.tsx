import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  CheckCircle2,
  Flag,
  Image as ImageIcon,
  RotateCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import * as api from '../../lib/api';
import { exportReportsCsv } from '../admin/admin-export';
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

const statuses: Record<Report['status'], string> = {
  open: 'Chờ xử lý',
  reviewing: 'Đang xem xét',
  resolved: 'Đã xử lý',
  dismissed: 'Đã bác bỏ',
};

const types: Record<string, string> = {
  user: 'Người dùng',
  conversation: 'Hội thoại',
  message: 'Tin nhắn',
  call: 'Cuộc gọi',
  attachment: 'Ảnh đính kèm',
};

const statusTabs: { value: '' | Report['status']; label: string }[] = [
  { value: '', label: 'Tất cả' },
  { value: 'open', label: 'Chờ xử lý' },
  { value: 'reviewing', label: 'Đang xem xét' },
  { value: 'resolved', label: 'Đã xử lý' },
  { value: 'dismissed', label: 'Đã bác bỏ' },
];

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
    fileName: 'Tên tệp / ảnh',
    mimeType: 'Định dạng',
    size: 'Dung lượng (byte)',
    type: 'Loại nội dung',
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
      <summary>Bằng chứng tại thời điểm báo cáo (Snapshot)</summary>
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
        <div className="report-evidence-media">
          <button
            type="button"
            className="admin-button"
            disabled={loading}
            onClick={() => void showImage()}
          >
            <ImageIcon size={15} />
            {loading ? 'Đang tải ảnh…' : 'Xem ảnh bằng chứng'}
          </button>
          {url && (
            <img
              className="report-evidence-image"
              src={url}
              alt="Ảnh được báo cáo để kiểm duyệt"
            />
          )}
          {error && (
            <p className="report-inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
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
      setError('Nhập kết luận xử lý tối thiểu 3 ký tự.');
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
      setError('Nhập kết luận xử lý tối thiểu 3 ký tự.');
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

  if (row.status === 'resolved' || row.status === 'dismissed') {
    return (
      <div className="report-resolution-box is-closed">
        <CheckCircle2 size={16} />
        <div>
          <strong>Kết luận kiểm duyệt:</strong>{' '}
          {row.resolution || 'Đã hoàn tất'}
        </div>
      </div>
    );
  }
  if (row.reporterId === userId) {
    return (
      <div className="report-resolution-box is-note">
        Cần một quản trị viên độc lập khác xử lý báo cáo do chính bạn gửi.
      </div>
    );
  }
  if (row.reviewerId && row.reviewerId !== userId) {
    return (
      <div className="report-resolution-box is-note">
        Báo cáo này đang được một quản trị viên khác tiếp nhận xử lý.
      </div>
    );
  }

  const canDeleteContent =
    row.targetType === 'message' || row.targetType === 'attachment';

  return (
    <div className="report-review-form">
      <label htmlFor={`resolution-${row.id}`}>Kết luận &amp; hướng xử lý</label>
      <textarea
        id={`resolution-${row.id}`}
        value={resolution}
        rows={2}
        maxLength={2000}
        disabled={busy}
        onChange={(event) => setResolution(event.target.value)}
        placeholder="Ghi rõ kết quả xác minh bằng chứng và biện pháp xử lý (tối thiểu 3 ký tự)…"
      />
      <div className="report-review-actions">
        {row.status === 'open' && (
          <button
            type="button"
            className="admin-button"
            disabled={busy}
            onClick={() => void review('reviewing')}
          >
            Nhận xem xét
          </button>
        )}
        <button
          type="button"
          className="admin-button primary"
          disabled={busy}
          onClick={() => void review('resolved')}
        >
          Xác nhận đã xử lý
        </button>
        {canDeleteContent && (
          <button
            type="button"
            className="admin-button danger"
            disabled={busy}
            onClick={() => void deleteContentAndResolve()}
          >
            <Trash2 size={14} />
            Xóa nội dung vi phạm &amp; Đóng
          </button>
        )}
        <button
          type="button"
          className="admin-button"
          disabled={busy}
          onClick={() => void review('dismissed')}
        >
          Bác bỏ báo cáo
        </button>
      </div>
      {error && (
        <p className="report-inline-error" role="alert">
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
  const [statusFilter, setStatusFilter] = useState<'' | Report['status']>('');
  const [targetFilter, setTargetFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (next?: string, status = statusFilter, targetType = targetFilter) => {
      if (!user) return;
      const req = ++requestSeq.current;
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (next) params.set('cursor', next);
        if (status) params.set('status', status);
        if (targetType) params.set('targetType', targetType);
        const page = await api.authenticated<{
          items: Report[];
          nextCursor: string | null;
          pendingCount: number;
        }>(`/admin/reports?${params.toString()}`);
        if (!alive.current || req !== requestSeq.current) return;
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
        if (alive.current && req === requestSeq.current) {
          setError(reportError(cause));
        }
      } finally {
        if (alive.current && req === requestSeq.current) {
          setLoading(false);
        }
      }
    },
    [user, onCount, statusFilter, targetFilter],
  );

  useEffect(() => {
    alive.current = true;
    void load(undefined, statusFilter, targetFilter);
    return () => {
      alive.current = false;
    };
  }, [load, statusFilter, targetFilter]);

  return (
    <section className="admin-panel" aria-label="Hàng đợi kiểm duyệt báo cáo">
      <div className="admin-panel-heading">
        <div>
          <h2>
            Hàng đợi kiểm duyệt{' '}
            <span className="admin-total">{pending} chờ xử lý</span>
          </h2>
          <p>
            {user
              ? 'Xác minh bằng chứng snapshot, thu hồi nội dung vi phạm và ghi nhận kết luận kiểm toán.'
              : 'Đăng nhập bằng tài khoản quản trị viên để xem báo cáo thật.'}
          </p>
        </div>
        <div className="admin-heading-actions">
          <button
            type="button"
            className="admin-button"
            disabled={!user || loading}
            onClick={() => void load(undefined, statusFilter, targetFilter)}
          >
            <RotateCw size={15} />
            Làm mới
          </button>
          <button
            type="button"
            className="admin-button primary"
            disabled={!items.length}
            onClick={() => exportReportsCsv(items)}
          >
            <ArrowDownToLine size={15} />
            Xuất báo cáo CSV
          </button>
        </div>
      </div>

      {user && (
        <div className="admin-report-toolbar">
          <div
            className="admin-pill-tabs"
            role="tablist"
            aria-label="Lọc theo trạng thái báo cáo"
          >
            {statusTabs.map((tab) => (
              <button
                key={tab.value || 'all'}
                type="button"
                role="tab"
                aria-selected={statusFilter === tab.value}
                className={statusFilter === tab.value ? 'is-active' : ''}
                onClick={() => setStatusFilter(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <select
            aria-label="Lọc theo loại đối tượng báo cáo"
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value)}
          >
            <option value="">Tất cả loại đối tượng</option>
            <option value="message">Tin nhắn</option>
            <option value="attachment">Ảnh đính kèm</option>
            <option value="user">Người dùng</option>
            <option value="call">Cuộc gọi</option>
          </select>
        </div>
      )}

      {error && (
        <div className="admin-inline-alert danger" role="alert">
          {error}
        </div>
      )}

      {!user ? (
        <div className="admin-empty">
          <ShieldCheck size={30} />
          <h3>Yêu cầu quyền Quản trị viên</h3>
          <p>
            Vui lòng đăng nhập tài khoản Admin để truy cập hàng đợi báo cáo.
          </p>
        </div>
      ) : loading && !items.length ? (
        <div className="admin-empty" role="status">
          <Flag size={28} />
          <h3>Đang tải danh sách báo cáo…</h3>
          <p>Đang đồng bộ dữ liệu kiểm duyệt từ máy chủ PostgreSQL.</p>
        </div>
      ) : !loading && !error && !items.length ? (
        <div className="admin-empty">
          <ShieldCheck size={30} />
          <h3>Không có báo cáo vi phạm nào trong bộ lọc này</h3>
          <p>
            Cộng đồng đang hoạt động an toàn. Bạn có thể chuyển tab trạng thái
            để tra cứu lịch sử xử lý trước đó.
          </p>
        </div>
      ) : (
        <div className="admin-report-list">
          {items.map((row) => (
            <article className="admin-report" key={row.id}>
              <div>
                <div className="admin-report-top">
                  <small>
                    <span className="admin-report-type-badge">
                      {types[row.targetType] ?? row.targetType}
                    </span>{' '}
                    · {new Date(row.createdAt).toLocaleString('vi-VN')}
                  </small>
                  <span className={`admin-status ${row.status}`}>
                    <i />
                    {statuses[row.status]}
                  </span>
                </div>
                <h3>{row.reason}</h3>
                <div className="admin-report-meta">
                  <span>
                    <strong>Mã báo cáo:</strong>{' '}
                    <code className="admin-uuid">{row.id}</code>
                  </span>
                  <span>
                    <strong>Người gửi:</strong>{' '}
                    <code className="admin-uuid">{row.reporterId}</code>
                  </span>
                  <span>
                    <strong>Đối tượng:</strong>{' '}
                    <code className="admin-uuid">{row.targetId}</code>
                  </span>
                </div>
                <ReportEvidence row={row} />
                <ReportReview
                  row={row}
                  userId={user.id}
                  onDone={() => load(undefined, statusFilter, targetFilter)}
                />
              </div>
            </article>
          ))}
        </div>
      )}

      {user && (items.length > 0 || cursor) && (
        <div className="admin-table-footer">
          <span>
            Đang hiển thị {items.length} báo cáo · {pending} báo cáo đang chờ xử
            lý
          </span>
          {cursor && (
            <button
              type="button"
              className="admin-button"
              disabled={loading}
              onClick={() => void load(cursor, statusFilter, targetFilter)}
            >
              Xem thêm báo cáo
            </button>
          )}
        </div>
      )}
    </section>
  );
}
