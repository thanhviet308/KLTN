import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ClipboardList,
  Database,
  Lock,
  RotateCcw,
  Search,
  ShieldAlert,
  UserCheck,
} from 'lucide-react';
import * as api from '../../lib/api';
import {
  exportAuditLogsCsv,
  exportUserLogFile,
  formatDateTime,
  type AdminAuditLogItem,
  type AdminUserAccount,
} from './admin-export';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const targetLabels: Record<string, string> = {
  user: 'Người dùng',
  report: 'Báo cáo',
  message: 'Tin nhắn',
  attachment: 'Tệp đính kèm',
  call: 'Cuộc gọi',
  conversation: 'Hội thoại',
};

export function AdminAuditCompliance({
  onRetentionApplied,
}: {
  onRetentionApplied?: () => void;
}) {
  const [items, setItems] = useState<AdminAuditLogItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [actorId, setActorId] = useState('');
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const [userLookup, setUserLookup] = useState('');
  const [userCandidates, setUserCandidates] = useState<AdminUserAccount[]>([]);
  const [selectedExportUser, setSelectedExportUser] =
    useState<AdminUserAccount | null>(null);
  const [exportUserId, setExportUserId] = useState('');
  const [complianceBusy, setComplianceBusy] = useState(false);
  const [complianceMsg, setComplianceMsg] = useState('');
  const [complianceError, setComplianceError] = useState('');

  const [retentionDays, setRetentionDays] = useState('90');
  const [retentionScope, setRetentionScope] = useState<
    'both' | 'messages' | 'attachments'
  >('both');
  const [confirmRetention, setConfirmRetention] = useState(false);

  const loadLogs = useCallback(
    async (
      next?: string,
      overrides?: {
        actorId?: string;
        targetType?: string;
        targetId?: string;
        action?: string;
        from?: string;
        to?: string;
      },
    ) => {
      const curActor = (overrides?.actorId ?? actorId).trim();
      const curTargetType = overrides?.targetType ?? targetType;
      const curTarget = (overrides?.targetId ?? targetId).trim();
      const curAction = (overrides?.action ?? action).trim();
      const curFrom = overrides?.from ?? from;
      const curTo = overrides?.to ?? to;

      if (curActor && !UUID_RE.test(curActor)) {
        setError('Actor ID phải là UUID v4 hợp lệ.');
        return;
      }
      if (curTarget && !UUID_RE.test(curTarget)) {
        setError('Target ID phải là UUID v4 hợp lệ.');
        return;
      }
      if (curFrom && curTo && curFrom > curTo) {
        setError('Ngày bắt đầu không được lớn hơn ngày kết thúc.');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ limit: '25' });
        if (curActor) params.set('actorId', curActor);
        if (curTargetType) params.set('targetType', curTargetType);
        if (curTarget) params.set('targetId', curTarget);
        if (curAction) params.set('action', curAction);
        if (curFrom) params.set('from', curFrom);
        if (curTo) params.set('to', curTo);
        if (next) params.set('cursor', next);
        const page = await api.authenticated<{
          items: AdminAuditLogItem[];
          nextCursor: string | null;
        }>(`/admin/audit-logs?${params.toString()}`);
        setItems((old) =>
          next
            ? [
                ...old,
                ...page.items.filter(
                  (item) => !old.some((existing) => existing.id === item.id),
                ),
              ]
            : page.items,
        );
        setCursor(page.nextCursor);
      } catch (e) {
        setError(api.errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [actorId, targetType, targetId, action, from, to],
  );

  useEffect(() => {
    void loadLogs();
  }, []);

  useEffect(() => {
    let active = true;
    const term = userLookup.trim();
    const timer = window.setTimeout(
      () => {
        const params = new URLSearchParams({ limit: '5' });
        if (term) params.set('query', term);
        void api
          .authenticated<{ items: AdminUserAccount[] }>(
            `/admin/users?${params.toString()}`,
          )
          .then((res) => {
            if (active) setUserCandidates(res.items);
          })
          .catch(() => {
            if (active) setUserCandidates([]);
          });
      },
      term ? 220 : 0,
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [userLookup]);

  async function runExport(format: 'json' | 'csv') {
    const id = exportUserId.trim();
    if (!UUID_RE.test(id)) {
      setComplianceError(
        'Vui lòng chọn người dùng bên dưới hoặc nhập đúng mã UUID v4.',
      );
      return;
    }
    setComplianceBusy(true);
    setComplianceError('');
    setComplianceMsg('');
    try {
      await exportUserLogFile(id, format);
      setComplianceMsg(
        `Đã xuất hồ sơ khiếu nại (${format.toUpperCase()}) cho ${selectedExportUser ? `${selectedExportUser.displayName} (${id.slice(0, 8)}…)` : `user ${id}`}.`,
      );
      void loadLogs();
    } catch (e) {
      setComplianceError(api.errorMessage(e));
    } finally {
      setComplianceBusy(false);
    }
  }

  async function runRetention() {
    const days = Number(retentionDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      setComplianceError('Số ngày lưu trữ phải là số nguyên từ 1 đến 3650.');
      return;
    }
    setComplianceBusy(true);
    setComplianceError('');
    setComplianceMsg('');
    try {
      const res = await api.authenticated<{
        days: number;
        scope: string;
        deletedMessages: number;
        expiredAttachments: number;
      }>(
        '/admin/compliance/retention',
        { days, scope: retentionScope },
        'POST',
      );
      setConfirmRetention(false);
      setComplianceMsg(
        `Đã thực thi retention (> ${res.days} ngày): xóa mềm ${res.deletedMessages} tin nhắn và thu hồi ${res.expiredAttachments} tệp đính kèm.`,
      );
      void loadLogs();
      onRetentionApplied?.();
    } catch (e) {
      setComplianceError(api.errorMessage(e));
    } finally {
      setComplianceBusy(false);
    }
  }

  const hasAuditFilters = Boolean(
    actorId.trim() ||
    targetType ||
    targetId.trim() ||
    action.trim() ||
    from ||
    to,
  );

  return (
    <div className="admin-compliance-stack">
      <div className="admin-compliance-grid">
        <section
          className="admin-panel"
          aria-label="Export log hỗ trợ khiếu nại"
        >
          <div className="admin-panel-heading">
            <div>
              <h2>Trích xuất hồ sơ người dùng</h2>
              <p>
                Xuất toàn bộ tài khoản, phiên đăng nhập, báo cáo và audit liên
                quan phục vụ đối soát &amp; khiếu nại.
              </p>
            </div>
            <ArrowDownToLine size={19} />
          </div>
          <div className="admin-compliance-body">
            <label className="admin-field">
              <span>Tìm nhanh theo tên / email</span>
              <input
                value={userLookup}
                placeholder="Nhập tên hoặc email để chọn nhanh tài khoản…"
                onChange={(e) => setUserLookup(e.target.value)}
              />
            </label>
            {userCandidates.length > 0 && (
              <div
                className="admin-user-picker"
                aria-label="Gợi ý người dùng hệ thống"
              >
                {userCandidates.map((u) => {
                  const isPicked = exportUserId === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      className={`admin-user-chip ${isPicked ? 'is-picked' : ''}`}
                      onClick={() => {
                        setExportUserId(u.id);
                        setSelectedExportUser(u);
                        setComplianceError('');
                      }}
                    >
                      <UserCheck size={13} />
                      <span>{u.displayName}</span>
                      <small>{u.email}</small>
                    </button>
                  );
                })}
              </div>
            )}
            <label className="admin-field">
              <span>Mã định danh tài khoản (UUID)</span>
              <input
                value={exportUserId}
                placeholder="vd: 10000000-0000-4000-8000-000000000001"
                onChange={(e) => {
                  setExportUserId(e.target.value);
                  if (
                    selectedExportUser &&
                    e.target.value !== selectedExportUser.id
                  ) {
                    setSelectedExportUser(null);
                  }
                }}
              />
            </label>
            <div className="admin-compliance-actions">
              <button
                type="button"
                className="admin-button primary"
                disabled={complianceBusy}
                onClick={() => void runExport('csv')}
              >
                <ArrowDownToLine size={15} />
                Xuất hồ sơ CSV (Excel)
              </button>
              <button
                type="button"
                className="admin-button"
                disabled={complianceBusy}
                onClick={() => void runExport('json')}
              >
                <ArrowDownToLine size={15} />
                Xuất hồ sơ JSON
              </button>
            </div>
          </div>
        </section>

        <section
          className="admin-panel"
          aria-label="Chính sách lưu trữ dữ liệu"
        >
          <div className="admin-panel-heading">
            <div>
              <h2>Chính sách lưu trữ (Data Retention)</h2>
              <p>
                Tự động xóa mềm tin nhắn và/hoặc thu hồi media cũ hơn N ngày
                theo quy định bảo mật dữ liệu.
              </p>
            </div>
            <Database size={19} />
          </div>
          <div className="admin-compliance-body">
            <div className="admin-retention-fields">
              <label className="admin-field">
                <span>Xóa dữ liệu cũ hơn (ngày)</span>
                <input
                  type="number"
                  min={1}
                  max={3650}
                  value={retentionDays}
                  onChange={(e) => setRetentionDays(e.target.value)}
                />
              </label>
              <label className="admin-field">
                <span>Phạm vi áp dụng</span>
                <select
                  value={retentionScope}
                  onChange={(e) =>
                    setRetentionScope(
                      e.target.value as 'both' | 'messages' | 'attachments',
                    )
                  }
                >
                  <option value="both">Tin nhắn &amp; Media đính kèm</option>
                  <option value="messages">Chỉ nội dung tin nhắn</option>
                  <option value="attachments">Chỉ media / tệp tải lên</option>
                </select>
              </label>
            </div>
            <div className="admin-retention-hint">
              Mọi thao tác dọn dẹp đều được ghi bất biến vào bảng{' '}
              <code>audit_logs</code> kèm số lượng bản ghi bị thu hồi.
            </div>
            {!confirmRetention ? (
              <button
                type="button"
                className="admin-button danger"
                disabled={complianceBusy}
                onClick={() => setConfirmRetention(true)}
              >
                <ShieldAlert size={15} />
                Thực thi dọn dẹp theo chính sách
              </button>
            ) : (
              <div className="admin-confirm-bar inline">
                <p>
                  Xác nhận xóa mềm dữ liệu cũ hơn{' '}
                  <strong>{retentionDays} ngày</strong>?
                </p>
                <div className="admin-confirm-actions">
                  <button
                    type="button"
                    className="admin-button danger"
                    disabled={complianceBusy}
                    onClick={() => void runRetention()}
                  >
                    Xác nhận xóa
                  </button>
                  <button
                    type="button"
                    className="admin-button"
                    disabled={complianceBusy}
                    onClick={() => setConfirmRetention(false)}
                  >
                    Hủy
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {complianceError && (
        <div className="admin-inline-alert danger" role="alert">
          {complianceError}
        </div>
      )}
      {complianceMsg && (
        <div className="admin-inline-alert success" role="status">
          {complianceMsg}
        </div>
      )}

      <section
        className="admin-panel"
        aria-label="Nhật ký kiểm toán audit_logs"
      >
        <div className="admin-panel-heading">
          <div>
            <h2>
              Nhật ký kiểm toán (audit_logs){' '}
              <span className="admin-readonly-badge">
                <Lock size={11} />
                Chỉ đọc · DB chặn sửa/xóa
              </span>
            </h2>
            <p>
              Tra cứu bất biến theo người thực hiện (actor), đối tượng (target),
              loại hành động và mốc thời gian.
            </p>
          </div>
          <div className="admin-heading-actions">
            <button
              type="button"
              className="admin-button"
              disabled={loading}
              onClick={() => void loadLogs()}
            >
              Làm mới
            </button>
            <button
              type="button"
              className="admin-button primary"
              disabled={!items.length}
              onClick={() => exportAuditLogsCsv(items)}
            >
              <ArrowDownToLine size={15} />
              Xuất Audit CSV
            </button>
          </div>
        </div>

        <form
          className="admin-audit-filters"
          onSubmit={(e) => {
            e.preventDefault();
            void loadLogs();
          }}
        >
          <input
            value={actorId}
            placeholder="Actor UUID…"
            aria-label="Lọc theo Actor ID"
            onChange={(e) => setActorId(e.target.value)}
          />
          <select
            aria-label="Lọc theo loại đối tượng"
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
          >
            <option value="">Tất cả đối tượng</option>
            <option value="user">Người dùng (user)</option>
            <option value="report">Báo cáo (report)</option>
            <option value="message">Tin nhắn (message)</option>
            <option value="attachment">Tệp đính kèm (attachment)</option>
            <option value="call">Cuộc gọi (call)</option>
            <option value="conversation">Hội thoại (conversation)</option>
          </select>
          <input
            value={targetId}
            placeholder="Target UUID…"
            aria-label="Lọc theo Target ID"
            onChange={(e) => setTargetId(e.target.value)}
          />
          <input
            value={action}
            placeholder="Hành động (vd: user.blocked, report.resolved)…"
            aria-label="Lọc theo tên action"
            onChange={(e) => setAction(e.target.value)}
          />
          <input
            type="date"
            aria-label="Từ ngày"
            title="Từ ngày"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            type="date"
            aria-label="Đến ngày"
            title="Đến ngày"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <div className="admin-audit-filter-btns">
            <button
              type="submit"
              className="admin-button primary"
              disabled={loading}
            >
              <Search size={15} />
              Tra cứu
            </button>
            {hasAuditFilters && (
              <button
                type="button"
                className="admin-button"
                disabled={loading}
                onClick={() => {
                  setActorId('');
                  setTargetType('');
                  setTargetId('');
                  setAction('');
                  setFrom('');
                  setTo('');
                  void loadLogs(undefined, {
                    actorId: '',
                    targetType: '',
                    targetId: '',
                    action: '',
                    from: '',
                    to: '',
                  });
                }}
              >
                <RotateCcw size={14} />
                Đặt lại
              </button>
            )}
          </div>
        </form>

        {error && (
          <div className="admin-inline-alert danger" role="alert">
            {error}
          </div>
        )}

        <div className="admin-table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">THỜI GIAN</th>
                <th scope="col">ACTOR</th>
                <th scope="col">HÀNH ĐỘNG</th>
                <th scope="col">ĐỐI TƯỢNG (TARGET)</th>
                <th scope="col">CHI TIẾT (METADATA)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((log) => (
                <tr key={log.id}>
                  <td>{formatDateTime(log.createdAt)}</td>
                  <td>
                    {log.actor ? (
                      <div>
                        <strong>{log.actor.displayName}</strong>
                        <small className="admin-block-sub">
                          {log.actor.email}
                        </small>
                      </div>
                    ) : (
                      <code className="admin-uuid">
                        {log.actorId ?? 'system'}
                      </code>
                    )}
                  </td>
                  <td>
                    <span className="admin-action-pill">{log.action}</span>
                  </td>
                  <td>
                    {log.targetType ? (
                      <div>
                        <span>
                          {targetLabels[log.targetType] ?? log.targetType}
                        </span>
                        {log.targetId && (
                          <code className="admin-uuid admin-block-sub">
                            {log.targetId}
                          </code>
                        )}
                      </div>
                    ) : (
                      <span>Hệ thống</span>
                    )}
                  </td>
                  <td>
                    <code
                      className="admin-meta-json"
                      title={JSON.stringify(log.metadata ?? {})}
                    >
                      {JSON.stringify(log.metadata ?? {})}
                    </code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && !items.length && (
            <div className="admin-empty">
              <ClipboardList size={28} />
              <h3>Chưa có bản ghi audit phù hợp</h3>
              <p>
                Các hành động khóa user, xử lý report, xóa nội dung, trích xuất
                hồ sơ hoặc retention sẽ hiển thị tại đây.
              </p>
            </div>
          )}
        </div>

        <div className="admin-table-footer">
          <span>Đang hiển thị {items.length} bản ghi kiểm toán (chỉ đọc)</span>
          {cursor && (
            <button
              type="button"
              className="admin-button"
              disabled={loading}
              onClick={() => void loadLogs(cursor)}
            >
              Xem thêm
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
