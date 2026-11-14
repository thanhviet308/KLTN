import * as api from '../../lib/api';

export interface AdminUserAccount {
  id: string;
  displayName: string;
  email: string;
  role: 'user' | 'admin';
  status: 'active' | 'blocked' | 'deleted';
  lastActiveAt?: string | null;
  createdAt: string;
}

export interface UserOverviewData {
  user: AdminUserAccount & { updatedAt?: string };
  friends: {
    id: string;
    email: string;
    displayName: string;
    status: string;
    role: string;
    since: string;
  }[];
  conversations: {
    id: string;
    type: 'direct' | 'group';
    title: string | null;
    lastMessageSequence: string;
    createdAt: string;
    memberRole: string;
    joinedAt: string;
    memberCount: number;
  }[];
  uploads: {
    fileCount: number;
    totalBytes: string;
    recent: {
      id: string;
      fileName: string;
      mimeType: string;
      size: string;
      status: string;
      messageId: string | null;
      createdAt: string;
    }[];
  };
}

export interface AdminDashboardData {
  days: number;
  users: {
    total: number;
    active: number;
    blocked: number;
    deleted: number;
    admins: number;
  };
  totals: {
    messagesToday: number;
    messagesPeriod: number;
    callsPeriod: number;
    gamesPeriod: number;
    groupsTotal: number;
    pendingReports: number;
    uploadFilesTotal: number;
    uploadBytesTotal: string;
  };
  series: {
    date: string;
    newUsers: number;
    messages: number;
    calls: number;
    games: number;
  }[];
}

export interface AdminAuditLogItem {
  id: string;
  actorId: string | null;
  actor: { id: string; email: string; displayName: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

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

export function formatBytes(value: string | number | undefined) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeCsvCell(value: unknown) {
  const text = value == null ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
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
      payload.user.createdAt,
      `${payload.user.displayName} (${payload.user.email}) · ${payload.user.role} · ${payload.user.status}`,
    ],
    ...payload.sessions.map((s) => [
      'Phiên đăng nhập',
      s.id,
      s.createdAt,
      `${s.deviceName ?? 'Thiết bị'} · ${s.revokedAt ? `Thu hồi: ${s.revokedAt}` : `Hết hạn: ${s.expiresAt}`}`,
    ]),
    ...payload.friends.map((f) => [
      'Bạn bè',
      f.id,
      f.createdAt,
      `${f.requesterId} -> ${f.recipientId} (${f.status})`,
    ]),
    ...payload.conversations.map((c) => [
      'Hội thoại',
      c.conversationId,
      c.joinedAt,
      `${c.type}${c.title ? ` "${c.title}"` : ''} · vai trò ${c.memberRole}${c.leftAt ? ` · rời lúc ${c.leftAt}` : ''}`,
    ]),
    ...payload.uploads.map((u) => [
      'Tệp tải lên',
      u.id,
      u.createdAt,
      `${u.fileName} (${u.mimeType}, ${u.size} bytes, ${u.status})`,
    ]),
    ...payload.reports.map((r) => [
      'Báo cáo',
      r.id,
      r.createdAt,
      `${r.targetType}:${r.targetId} · ${r.status} · "${r.reason}"${r.resolution ? ` -> ${r.resolution}` : ''}`,
    ]),
    ...payload.auditLogs.map((a) => [
      'Audit Log',
      a.id,
      a.createdAt,
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
