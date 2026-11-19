import * as api from '../../lib/api';
import {
  buildDashboardCsvContent,
  buildFormalReportHtml,
  computeChartAxisTicks,
  computeGrowthBadge,
  escapeCsvCell,
  formatBytes,
  formatDateTime,
  formatDurationSeconds,
  toCsvDocument,
  type AdminAuditLogItem,
  type AdminDashboardBreakdown,
  type AdminDashboardData,
  type AdminReportExportItem,
  type AdminUserAccount,
  type UserOverviewData,
} from './admin-report-builder';

export {
  buildDashboardCsvContent,
  buildFormalReportHtml,
  computeChartAxisTicks,
  computeGrowthBadge,
  formatBytes,
  formatDateTime,
  formatDurationSeconds,
  type AdminAuditLogItem,
  type AdminDashboardBreakdown,
  type AdminDashboardData,
  type AdminReportExportItem,
  type AdminUserAccount,
  type UserOverviewData,
};

export interface UserExportPayload {
  exportedAt: string;
  exportedBy: { id: string; email: string };
  user: AdminUserAccount;
  sessions: {
    id: string;
    deviceName: string | null;
    createdAt: string;
    expiresAt: string;
    revokedAt: string | null;
  }[];
  friends: {
    id: string;
    requesterId: string;
    recipientId: string;
    status: string;
    createdAt: string;
  }[];
  conversations: {
    conversationId: string;
    type: string;
    title: string | null;
    memberRole: string;
    joinedAt: string;
    leftAt: string | null;
  }[];
  uploads: {
    id: string;
    conversationId: string;
    fileName: string;
    mimeType: string;
    size: string;
    status: string;
    createdAt: string;
  }[];
  reports: {
    id: string;
    reporterId: string;
    reportedUserId: string | null;
    targetType: string;
    targetId: string;
    reason: string;
    status: string;
    resolution: string | null;
    createdAt: string;
    reviewedAt: string | null;
  }[];
  auditLogs: {
    id: string;
    actorId: string | null;
    action: string;
    targetType: string | null;
    targetId: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
  }[];
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function todaySlug() {
  return new Date().toISOString().slice(0, 10);
}

export function exportDashboardCsv(
  dashboard: AdminDashboardData,
  exportedBy?: { displayName?: string; email?: string },
) {
  const csv = buildDashboardCsvContent(dashboard, exportedBy);
  downloadBlob(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    `pingpong-bao-cao-thong-ke-${dashboard.days}ngay-${todaySlug()}.csv`,
  );
}

export function exportDashboardJson(
  dashboard: AdminDashboardData,
  exportedBy?: { displayName?: string; email?: string },
) {
  const payload = {
    reportTitle: 'Báo cáo thống kê vận hành hệ thống PingPong',
    exportedAt: new Date().toISOString(),
    exportedBy: exportedBy ?? { displayName: 'Quản trị viên' },
    ...dashboard,
  };
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8;',
    }),
    `pingpong-thong-ke-${dashboard.days}ngay-${todaySlug()}.json`,
  );
}

export function printDashboardFormalReport(
  dashboard: AdminDashboardData,
  exportedBy?: { displayName?: string; email?: string },
): boolean {
  const html = buildFormalReportHtml(dashboard, exportedBy);
  const win = window.open('', '_blank');
  if (!win) return false;
  win.opener = null;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  return true;
}

export function exportUsersListCsv(
  users: AdminUserAccount[],
  filename = `pingpong-danh-sach-nguoi-dung-${todaySlug()}.csv`,
) {
  const statusMap: Record<string, string> = {
    active: 'Hoạt động',
    blocked: 'Bị chặn',
    deleted: 'Đã xóa mềm',
  };
  const rows: unknown[][] = [
    [
      'Mã người dùng (UUID)',
      'Tên hiển thị',
      'Email',
      'Vai trò',
      'Trạng thái',
      'Hoạt động gần nhất',
      'Ngày tạo tài khoản',
    ],
    ...users.map((u) => [
      u.id,
      u.displayName,
      u.email,
      u.role === 'admin' ? 'Quản trị viên' : 'Thành viên',
      statusMap[u.status] ?? u.status,
      formatDateTime(u.lastActiveAt),
      formatDateTime(u.createdAt),
    ]),
  ];
  downloadBlob(
    new Blob([toCsvDocument(rows)], { type: 'text/csv;charset=utf-8;' }),
    filename,
  );
}

export function exportReportsCsv(reports: AdminReportExportItem[]) {
  const statusLabels: Record<string, string> = {
    open: 'Chờ xử lý',
    reviewing: 'Đang xem xét',
    resolved: 'Đã giải quyết',
    dismissed: 'Đã bác bỏ',
  };
  const targetLabels: Record<string, string> = {
    user: 'Người dùng',
    message: 'Tin nhắn',
    attachment: 'Ảnh đính kèm',
    call: 'Cuộc gọi',
    conversation: 'Hội thoại',
  };
  const rows: unknown[][] = [
    [
      'Mã báo cáo',
      'Thời gian gửi',
      'Loại đối tượng',
      'ID đối tượng',
      'ID người báo cáo',
      'Lý do báo cáo',
      'Trạng thái',
      'ID người xử lý',
      'Kết luận xử lý',
    ],
    ...reports.map((r) => [
      r.id,
      formatDateTime(r.createdAt),
      targetLabels[r.targetType] ?? r.targetType,
      r.targetId,
      r.reporterId,
      r.reason,
      statusLabels[r.status] ?? r.status,
      r.reviewerId ?? '—',
      r.resolution ?? '—',
    ]),
  ];
  downloadBlob(
    new Blob([toCsvDocument(rows)], { type: 'text/csv;charset=utf-8;' }),
    `pingpong-bao-cao-vi-pham-${todaySlug()}.csv`,
  );
}

export function exportAuditLogsCsv(logs: AdminAuditLogItem[]) {
  const rows: unknown[][] = [
    [
      'Mã Audit',
      'Thời gian ghi nhận',
      'Người thực hiện (Actor)',
      'Email Actor',
      'Hành động',
      'Loại đối tượng',
      'ID đối tượng',
      'Metadata JSON',
    ],
    ...logs.map((log) => [
      log.id,
      formatDateTime(log.createdAt),
      log.actor?.displayName ?? log.actorId ?? 'system',
      log.actor?.email ?? '—',
      log.action,
      log.targetType ?? 'system',
      log.targetId ?? '—',
      JSON.stringify(log.metadata ?? {}),
    ]),
  ];
  downloadBlob(
    new Blob([toCsvDocument(rows)], { type: 'text/csv;charset=utf-8;' }),
    `pingpong-nhat-ky-audit-${todaySlug()}.csv`,
  );
}

export async function exportUserLogFile(
  userId: string,
  format: 'json' | 'csv',
) {
  const payload = await api.authenticated<UserExportPayload>(
    `/admin/users/${userId}/export`,
  );
  const shortId = userId.slice(0, 8);
  if (format === 'json') {
    downloadBlob(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json;charset=utf-8;',
      }),
      `pingpong-ho-so-${shortId}.json`,
    );
    return payload;
  }
  const rows: string[][] = [
    ['Loại bản ghi', 'Mã / ID', 'Thời gian', 'Chi tiết'],
    [
      'Tài khoản',
      payload.user.id,
      formatDateTime(payload.user.createdAt),
      `${payload.user.displayName} (${payload.user.email}) · ${payload.user.role} · ${payload.user.status}`,
    ],
    ...payload.sessions.map((s) => [
      'Phiên đăng nhập',
      s.id,
      formatDateTime(s.createdAt),
      `${s.deviceName ?? 'Thiết bị'} · ${s.revokedAt ? `Thu hồi: ${formatDateTime(s.revokedAt)}` : `Hết hạn: ${formatDateTime(s.expiresAt)}`}`,
    ]),
    ...payload.friends.map((f) => [
      'Bạn bè',
      f.id,
      formatDateTime(f.createdAt),
      `${f.requesterId} -> ${f.recipientId} (${f.status})`,
    ]),
    ...payload.conversations.map((c) => [
      'Hội thoại',
      c.conversationId,
      formatDateTime(c.joinedAt),
      `${c.type}${c.title ? ` "${c.title}"` : ''} · vai trò ${c.memberRole}${c.leftAt ? ` · rời lúc ${formatDateTime(c.leftAt)}` : ''}`,
    ]),
    ...payload.uploads.map((u) => [
      'Tệp tải lên',
      u.id,
      formatDateTime(u.createdAt),
      `${u.fileName} (${u.mimeType}, ${formatBytes(u.size)}, ${u.status})`,
    ]),
    ...payload.reports.map((r) => [
      'Báo cáo',
      r.id,
      formatDateTime(r.createdAt),
      `${r.targetType}:${r.targetId} · ${r.status} · "${r.reason}"${r.resolution ? ` -> ${r.resolution}` : ''}`,
    ]),
    ...payload.auditLogs.map((a) => [
      'Audit Log',
      a.id,
      formatDateTime(a.createdAt),
      `${a.action} · ${a.targetType ?? 'system'}:${a.targetId ?? '-'} · ${JSON.stringify(a.metadata ?? {})}`,
    ]),
  ];
  const csv =
    '\uFEFF' + rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
  downloadBlob(
    new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    `pingpong-ho-so-${shortId}.csv`,
  );
  return payload;
}
