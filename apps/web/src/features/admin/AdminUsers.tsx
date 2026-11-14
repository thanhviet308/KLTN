import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Ban,
  Check,
  Eye,
  FileArchive,
  FolderOpen,
  RotateCcw,
  Search,
  Shield,
  ShieldOff,
  Trash2,
  UserCheck,
  Users as UsersIcon,
  X,
} from 'lucide-react';
import * as api from '../../lib/api';
import {
  exportUserLogFile,
  formatBytes,
  formatDateTime,
  type AdminUserAccount,
  type UserOverviewData,
} from './admin-export';

const statusLabels: Record<AdminUserAccount['status'], string> = {
  active: 'Hoạt động',
  blocked: 'Bị chặn',
  deleted: 'Đã xóa mềm',
};

export function AdminUsers({
  currentUserId,
  onAuditChanged,
}: {
  currentUserId?: string;
  onAuditChanged?: () => void;
}) {
  const [items, setItems] = useState<AdminUserAccount[]>([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [pendingAction, setPendingAction] = useState<{
    account: AdminUserAccount;
    kind: 'status' | 'role';
    value: string;
  } | null>(null);

  const [overview, setOverview] = useState<UserOverviewData | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  const load = useCallback(
    async (next?: string, q = query, st = statusFilter, rl = roleFilter) => {
      setBusy(true);
      setError('');
      try {
        const params = new URLSearchParams({ limit: '25' });
        if (q.trim()) params.set('query', q.trim());
        if (st) params.set('status', st);
        if (rl) params.set('role', rl);
        if (next) params.set('cursor', next);
        const result = await api.authenticated<{
          items: AdminUserAccount[];
          nextCursor: string | null;
        }>(`/admin/users?${params.toString()}`);
        setItems((old) =>
          next
            ? [
                ...old,
                ...result.items.filter(
                  (item) => !old.some((existing) => existing.id === item.id),
                ),
              ]
            : result.items,
        );
        setCursor(result.nextCursor);
      } catch (e) {
        setError(api.errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [query, statusFilter, roleFilter],
  );

  useEffect(() => {
    void load(undefined, '', '', '');
  }, []);

  useEffect(() => {
    if (overview || overviewLoading) {
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (dialog.current?.open) {
      dialog.current.close();
    }
  }, [overview, overviewLoading]);

  async function executeAction() {
    if (!pendingAction) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { account, kind, value } = pendingAction;
      if (kind === 'status') {
        await api.authenticated(
          `/admin/users/${account.id}/status`,
          { status: value },
          'PATCH',
        );
        setNotice(
          value === 'blocked'
            ? `Đã khóa tài khoản ${account.displayName} và thu hồi phiên đăng nhập.`
            : value === 'deleted'
              ? `Đã xóa mềm tài khoản ${account.displayName}.`
              : `Đã kích hoạt lại tài khoản ${account.displayName}.`,
        );
      } else {
        await api.authenticated(
          `/admin/users/${account.id}/role`,
          { role: value },
          'PATCH',
        );
        setNotice(
          value === 'admin'
            ? `Đã gán quyền Quản trị viên cho ${account.displayName}.`
            : `Đã gỡ quyền Quản trị viên khỏi ${account.displayName}.`,
        );
      }
      setPendingAction(null);
      await load();
      onAuditChanged?.();
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function openOverview(userId: string) {
    setOverviewLoading(true);
    setOverviewError('');
    setOverview(null);
    try {
      const data = await api.authenticated<UserOverviewData>(
        `/admin/users/${userId}/overview`,
      );
      setOverview(data);
    } catch (e) {
      setOverviewError(api.errorMessage(e));
    } finally {
      setOverviewLoading(false);
    }
  }

  async function removeAttachment(attachmentId: string) {
    if (!overview) return;
    setBusy(true);
    setOverviewError('');
    try {
      await api.authenticated(
        `/admin/content/attachment/${attachmentId}`,
        undefined,
        'DELETE',
      );
      setNotice('Đã xóa tệp vi phạm và ghi nhật ký kiểm toán.');
      await openOverview(overview.user.id);
      onAuditChanged?.();
    } catch (e) {
      setOverviewError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleExport(userId: string, format: 'json' | 'csv') {
    setBusy(true);
    setError('');
    try {
      await exportUserLogFile(userId, format);
      setNotice(`Đã xuất log ${format.toUpperCase()} cho tài khoản ${userId}.`);
      onAuditChanged?.();
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel" aria-label="Quản lý người dùng">
      <div className="admin-panel-heading">
        <div>
          <h2>
            Danh sách người dùng{' '}
            <span className="admin-total">{items.length}</span>
          </h2>
          <p>
            Tìm theo email, tên hiển thị hoặc ID; quản lý khóa/xóa mềm, phân
            quyền admin và kiểm tra metadata tài khoản.
          </p>
        </div>
        <button
          type="button"
          className="admin-button"
          disabled={busy}
          onClick={() => void load()}
        >
          Làm mới
        </button>
      </div>

      <form
        className="admin-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void load(undefined, query, statusFilter, roleFilter);
        }}
      >
        <label className="admin-search">
          <Search size={17} />
          <span className="admin-sr">
            Tìm người dùng theo tên, email hoặc ID
          </span>
          <input
            value={query}
            maxLength={100}
            placeholder="Tìm theo tên, email hoặc UUID…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          aria-label="Lọc theo trạng thái"
          value={statusFilter}
          onChange={(e) => {
            const nextStatus = e.target.value;
            setStatusFilter(nextStatus);
            void load(undefined, query, nextStatus, roleFilter);
          }}
        >
          <option value="">Tất cả trạng thái</option>
          <option value="active">Hoạt động</option>
          <option value="blocked">Bị chặn</option>
          <option value="deleted">Đã xóa mềm</option>
        </select>
        <select
          aria-label="Lọc theo vai trò"
          value={roleFilter}
          onChange={(e) => {
            const nextRole = e.target.value;
            setRoleFilter(nextRole);
            void load(undefined, query, statusFilter, nextRole);
          }}
        >
          <option value="">Tất cả vai trò</option>
          <option value="user">Thành viên</option>
          <option value="admin">Quản trị viên</option>
        </select>
        <button type="submit" className="admin-button primary" disabled={busy}>
          Tìm kiếm
        </button>
      </form>

      {error && (
        <div className="admin-inline-alert danger" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="admin-inline-alert success" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}

      {pendingAction && (
        <div className="admin-confirm-bar" role="alertdialog">
          <p>
            {pendingAction.kind === 'role'
              ? pendingAction.value === 'admin'
                ? `Gán quyền Quản trị viên (Admin) cho `
                : `Gỡ quyền Quản trị viên khỏi `
              : pendingAction.value === 'blocked'
                ? `Khóa tài khoản và đăng xuất mọi phiên của `
                : pendingAction.value === 'deleted'
                  ? `Xóa mềm (deleted) tài khoản `
                  : `Khôi phục / mở khóa tài khoản `}
            <strong>{pendingAction.account.displayName}</strong> (
            {pendingAction.account.email})?
          </p>
          <div className="admin-confirm-actions">
            <button
              type="button"
              className="admin-button danger"
              disabled={busy}
              onClick={() => void executeAction()}
            >
              Xác nhận
            </button>
            <button
              type="button"
              className="admin-button"
              disabled={busy}
              onClick={() => setPendingAction(null)}
            >
              Hủy
            </button>
          </div>
        </div>
      )}

      <div className="admin-table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">NGƯỜI DÙNG & ID</th>
              <th scope="col">VAI TRÒ</th>
              <th scope="col">TRẠNG THÁI</th>
              <th scope="col">HOẠT ĐỘNG CUỐI</th>
              <th scope="col">THAO TÁC QUẢN TRỊ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => {
              const isSelf = currentUserId === u.id;
              return (
                <tr key={u.id}>
                  <td>
                    <div className="admin-person">
                      <span className="admin-avatar peach">
                        {u.displayName.slice(0, 1).toUpperCase()}
                      </span>
                      <div>
                        <strong>{u.displayName}</strong>
                        <small>{u.email}</small>
                        <code className="admin-uuid">{u.id}</code>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className={`admin-role-pill ${u.role === 'admin' ? 'is-admin' : ''}`}
                    >
                      {u.role === 'admin' ? 'Admin' : 'Thành viên'}
                    </span>
                  </td>
                  <td>
                    <span className={`admin-status ${u.status}`}>
                      <i />
                      {statusLabels[u.status] ?? u.status}
                    </span>
                  </td>
                  <td>
                    <div>{formatDateTime(u.lastActiveAt)}</div>
                    <small>Tạo: {formatDateTime(u.createdAt)}</small>
                  </td>
                  <td>
                    <div className="admin-row-actions">
                      <button
                        type="button"
                        className="admin-mini-btn"
                        disabled={busy}
                        title="Xem bạn bè, hội thoại & dung lượng upload"
                        onClick={() => void openOverview(u.id)}
                      >
                        <Eye size={14} />
                        Chi tiết
                      </button>
                      <button
                        type="button"
                        className="admin-mini-btn"
                        disabled={busy}
                        title="Xuất JSON log phục vụ khiếu nại"
                        onClick={() => void handleExport(u.id, 'json')}
                      >
                        <ArrowDownToLine size={14} />
                        JSON
                      </button>
                      {u.status !== 'deleted' ? (
                        <>
                          <button
                            type="button"
                            className={`admin-mini-btn ${u.status === 'blocked' ? 'is-positive' : 'is-warn'}`}
                            disabled={busy || isSelf || u.role === 'admin'}
                            onClick={() =>
                              setPendingAction({
                                account: u,
                                kind: 'status',
                                value:
                                  u.status === 'blocked' ? 'active' : 'blocked',
                              })
                            }
                          >
                            {u.status === 'blocked' ? (
                              <>
                                <UserCheck size={14} />
                                Mở khóa
                              </>
                            ) : (
                              <>
                                <Ban size={14} />
                                Khóa
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            className="admin-mini-btn is-danger"
                            disabled={busy || isSelf || u.role === 'admin'}
                            onClick={() =>
                              setPendingAction({
                                account: u,
                                kind: 'status',
                                value: 'deleted',
                              })
                            }
                          >
                            <Trash2 size={14} />
                            Xóa mềm
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="admin-mini-btn is-positive"
                          disabled={busy || isSelf}
                          onClick={() =>
                            setPendingAction({
                              account: u,
                              kind: 'status',
                              value: 'active',
                            })
                          }
                        >
                          <RotateCcw size={14} />
                          Khôi phục
                        </button>
                      )}
                      <button
                        type="button"
                        className="admin-mini-btn"
                        disabled={
                          busy ||
                          isSelf ||
                          (u.role === 'user' && u.status !== 'active')
                        }
                        onClick={() =>
                          setPendingAction({
                            account: u,
                            kind: 'role',
                            value: u.role === 'admin' ? 'user' : 'admin',
                          })
                        }
                      >
                        {u.role === 'admin' ? (
                          <>
                            <ShieldOff size={14} />
                            Gỡ Admin
                          </>
                        ) : (
                          <>
                            <Shield size={14} />
                            Gán Admin
                          </>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!busy && !items.length && (
          <div className="admin-empty">
            <Search size={24} />
            <h3>Không có người dùng phù hợp</h3>
            <p>Thử thay đổi từ khóa tìm kiếm hoặc bộ lọc trạng thái/vai trò.</p>
          </div>
        )}
      </div>

      <div className="admin-table-footer">
        <span>Đang hiển thị {items.length} tài khoản</span>
        {cursor && (
          <button
            type="button"
            className="admin-button"
            style={{ width: 'auto', paddingInline: 14 }}
            disabled={busy}
            onClick={() => void load(cursor)}
          >
            Xem thêm
          </button>
        )}
      </div>

      <dialog
        ref={dialog}
        className="admin-dialog admin-dialog-wide"
        onCancel={() => {
          setOverview(null);
          setOverviewLoading(false);
        }}
        onClose={() => {
          setOverview(null);
          setOverviewLoading(false);
        }}
      >
        <div className="admin-panel-heading">
          <h2>Hồ sơ & Metadata tài khoản</h2>
          <button
            type="button"
            className="admin-close"
            aria-label="Đóng"
            onClick={() => {
              setOverview(null);
              setOverviewLoading(false);
            }}
          >
            <X size={19} />
          </button>
        </div>

        <div className="admin-dialog-body">
          {overviewLoading && <p role="status">Đang tải thông tin tổng hợp…</p>}
          {overviewError && <p role="alert">{overviewError}</p>}
          {overview && (
            <>
              <div className="admin-person">
                <span className="admin-avatar peach">
                  {overview.user.displayName.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{overview.user.displayName}</strong>
                  <small>{overview.user.email}</small>
                  <code className="admin-uuid">{overview.user.id}</code>
                </div>
              </div>

              <div className="admin-overview-stats">
                <div>
                  <UsersIcon size={15} />
                  <span>{overview.friends.length} bạn bè</span>
                </div>
                <div>
                  <FolderOpen size={15} />
                  <span>
                    {overview.conversations.length} hội thoại tham gia
                  </span>
                </div>
                <div>
                  <FileArchive size={15} />
                  <span>
                    {overview.uploads.fileCount} tệp ·{' '}
                    {formatBytes(overview.uploads.totalBytes)}
                  </span>
                </div>
              </div>

              <div className="admin-overview-section">
                <h3>Bạn bè đã kết nối ({overview.friends.length})</h3>
                {!overview.friends.length ? (
                  <p className="admin-muted-note">Chưa có bạn bè.</p>
                ) : (
                  <ul className="admin-meta-list">
                    {overview.friends.map((f) => (
                      <li key={f.id}>
                        <div>
                          <strong>{f.displayName}</strong>
                          <small>{f.email}</small>
                        </div>
                        <span>{formatDateTime(f.since)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="admin-overview-section">
                <h3>
                  Hội thoại tham gia — chỉ metadata (
                  {overview.conversations.length})
                </h3>
                {!overview.conversations.length ? (
                  <p className="admin-muted-note">
                    Chưa tham gia hội thoại nào.
                  </p>
                ) : (
                  <ul className="admin-meta-list">
                    {overview.conversations.map((c) => (
                      <li key={c.id}>
                        <div>
                          <strong>
                            {c.type === 'group'
                              ? c.title || 'Nhóm trò chuyện'
                              : 'Trò chuyện trực tiếp (Direct)'}
                          </strong>
                          <small>
                            {c.memberCount} thành viên · vai trò {c.memberRole}{' '}
                            · {c.lastMessageSequence} tin
                          </small>
                        </div>
                        <code className="admin-uuid">{c.id.slice(0, 8)}…</code>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="admin-overview-section">
                <h3>
                  Dung lượng upload gần đây ({overview.uploads.fileCount} tệp ·{' '}
                  {formatBytes(overview.uploads.totalBytes)})
                </h3>
                {!overview.uploads.recent.length ? (
                  <p className="admin-muted-note">Chưa có tệp tải lên.</p>
                ) : (
                  <ul className="admin-meta-list">
                    {overview.uploads.recent.map((file) => (
                      <li key={file.id}>
                        <div>
                          <strong>{file.fileName}</strong>
                          <small>
                            {file.mimeType} · {formatBytes(file.size)} ·{' '}
                            {formatDateTime(file.createdAt)}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="admin-mini-btn is-danger"
                          disabled={busy}
                          onClick={() => void removeAttachment(file.id)}
                        >
                          <Trash2 size={13} />
                          Xóa
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="admin-dialog-actions">
                <button
                  type="button"
                  className="admin-button primary"
                  disabled={busy}
                  onClick={() => void handleExport(overview.user.id, 'json')}
                >
                  <ArrowDownToLine size={15} />
                  Export JSON
                </button>
                <button
                  type="button"
                  className="admin-button"
                  disabled={busy}
                  onClick={() => void handleExport(overview.user.id, 'csv')}
                >
                  <ArrowDownToLine size={15} />
                  Export CSV
                </button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </section>
  );
}
