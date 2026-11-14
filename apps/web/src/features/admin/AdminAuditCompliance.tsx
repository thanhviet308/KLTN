import { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ClipboardList,
  Database,
  Lock,
  Search,
  ShieldAlert,
} from 'lucide-react';
import * as api from '../../lib/api';
import {
  exportUserLogFile,
  formatDateTime,
  type AdminAuditLogItem,
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
    async (next?: string) => {
      const trimmedActor = actorId.trim();
      const trimmedTarget = targetId.trim();
      if (trimmedActor && !UUID_RE.test(trimmedActor)) {
        setError('Actor ID phải là UUID v4 hợp lệ.');
        return;
      }
      if (trimmedTarget && !UUID_RE.test(trimmedTarget)) {
        setError('Target ID phải là UUID v4 hợp lệ.');
        return;
      }
      if (from && to && from > to) {
        setError('Ngày bắt đầu không được lớn hơn ngày kết thúc.');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams({ limit: '25' });
        if (trimmedActor) params.set('actorId', trimmedActor);
        if (targetType) params.set('targetType', targetType);
        if (trimmedTarget) params.set('targetId', trimmedTarget);
        if (action.trim()) params.set('action', action.trim());
        if (from) params.set('from', from);
        if (to) params.set('to', to);
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

  async function runExport(format: 'json' | 'csv') {
    const id = exportUserId.trim();
    if (!UUID_RE.test(id)) {
      setComplianceError('Nhập đúng UUID của người dùng cần xuất log.');
      return;
    }
    setComplianceBusy(true);
    setComplianceError('');
    setComplianceMsg('');
    try {
      await exportUserLogFile(id, format);
      setComplianceMsg(
        `Đã xuất hồ sơ khiếu nại (${format.toUpperCase()}) cho user ${id}.`,
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

  return (
    <div className="admin-compliance-stack">
      <div className="admin-compliance-grid">
        <section
          className="admin-panel"
          aria-label="Export log hỗ trợ khiếu nại"
        >
          <div className="admin-panel-heading">
            <div>
              <h2>Export log theo người dùng</h2>
              <p>
                Xuất toàn bộ hồ sơ, phiên đăng nhập, báo cáo và audit liên quan
                phục vụ giải quyết khiếu nại.
              </p>
            </div>
            <ArrowDownToLine size={19} />
          </div>
          <div className="admin-compliance-body">
            <label className="admin-field">
              <span>Mã người dùng (UUID)</span>
              <input
                value={exportUserId}
                placeholder="vd: 10000000-0000-4000-8000-000000000001"
                onChange={(e) => setExportUserId(e.target.value)}
              />
            </label>
            <div className="admin-compliance-actions">
              <button
                type="button"
                className="admin-button primary"
                disabled={complianceBusy}
                onClick={() => void runExport('json')}
              >
                <ArrowDownToLine size={15} />
                Xuất JSON
              </button>
              <button
                type="button"
                className="admin-button"
                disabled={complianceBusy}
                onClick={() => void runExport('csv')}
              >
                <ArrowDownToLine size={15} />
                Xuất CSV
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
              <h2>Chính sách lưu trữ (Retention)</h2>
              <p>
                Xóa mềm tin nhắn và/hoặc thu hồi media cũ hơn N ngày theo quy
                định tuân thủ.
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
                  <option value="both">Tin nhắn &amp; Media</option>
                  <option value="messages">Chỉ tin nhắn</option>
                  <option value="attachments">Chỉ media / tệp</option>
                </select>
              </label>
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
              Tra cứu theo người thực hiện (actor), đối tượng (target), loại
              hành động và khoảng thời gian.
            </p>
          </div>
          <ClipboardList size={20} />
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
            <option value="attachment">Tệp (attachment)</option>
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
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            type="date"
            aria-label="Đến ngày"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
          <button
            type="submit"
            className="admin-button primary"
            disabled={loading}
          >
            <Search size={15} />
            Tra cứu
          </button>
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
                        <code className="admin-uuid admin-block-sub">
                          {log.targetId}
                        </code>
                      </div>
                    ) : (
                      <span>Hệ thống</span>
                    )}
                  </td>
                  <td>
                    <code className="admin-meta-json">
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
                Các hành động khóa user, xử lý report, xóa nội dung hoặc
                retention sẽ hiển thị tại đây.
              </p>
            </div>
          )}
        </div>

        <div className="admin-table-footer">
          <span>Đang hiển thị {items.length} bản ghi (chỉ đọc)</span>
          {cursor && (
            <button
              type="button"
              className="admin-button"
              style={{ width: 'auto', paddingInline: 14 }}
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
