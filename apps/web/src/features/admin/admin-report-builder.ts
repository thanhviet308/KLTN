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

export interface AdminDashboardBreakdown {
  messageTypes: {
    text: number;
    image: number;
    file: number;
    voice: number;
    location: number;
    call: number;
  };
  calls: {
    audio: number;
    video: number;
    completed: number;
    missedOrRejected: number;
    totalDurationSeconds: number;
    aiSummaries: number;
  };
  aiJobs: {
    total: number;
    completed: number;
    chat: number;
    summary: number;
    replySuggestions: number;
  };
  reports: {
    total: number;
    open: number;
    reviewing: number;
    resolved: number;
    dismissed: number;
    byTarget: {
      user: number;
      message: number;
      attachment: number;
      call: number;
      conversation: number;
    };
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
    active24h?: number;
    active7d?: number;
    newPeriod?: number;
    newPreviousPeriod?: number;
  };
  totals: {
    messagesToday: number;
    messagesPeriod: number;
    messagesPreviousPeriod?: number;
    callsPeriod: number;
    callsPreviousPeriod?: number;
    gamesPeriod: number;
    gamesPreviousPeriod?: number;
    groupsTotal: number;
    directConversationsTotal?: number;
    pendingReports: number;
    spamDetectedPeriod?: number;
    recalledMessagesPeriod?: number;
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
  breakdown?: AdminDashboardBreakdown;
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

export interface AdminReportExportItem {
  id: string;
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  reviewerId: string | null;
  resolution: string | null;
  createdAt: string;
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

export function formatDurationSeconds(seconds?: number | null) {
  const total = Math.max(0, Math.round(Number(seconds ?? 0)));
  if (total <= 0) return '0 phút';
  const hours = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}g ${String(mins).padStart(2, '0')}p`;
  if (mins > 0) return secs > 0 ? `${mins}p ${secs}s` : `${mins} phút`;
  return `${secs} giây`;
}

export function computeGrowthBadge(
  current: number | undefined,
  previous: number | undefined,
): {
  label: string;
  tone: 'positive' | 'warning' | 'neutral';
  direction: 'up' | 'down' | 'flat';
} {
  const cur = Number(current ?? 0);
  const prev = Number(previous ?? 0);
  if (prev <= 0) {
    if (cur <= 0) {
      return { label: 'Ổn định', tone: 'neutral', direction: 'flat' };
    }
    return {
      label: `+${cur.toLocaleString('vi-VN')} mới`,
      tone: 'positive',
      direction: 'up',
    };
  }
  const pct = ((cur - prev) / prev) * 100;
  if (Math.abs(pct) < 0.05) {
    return { label: '0% kỳ trước', tone: 'neutral', direction: 'flat' };
  }
  const formatted = Math.abs(pct).toLocaleString('vi-VN', {
    maximumFractionDigits: 1,
  });
  if (pct > 0) {
    return {
      label: `+${formatted}%`,
      tone: 'positive',
      direction: 'up',
    };
  }
  return {
    label: `-${formatted}%`,
    tone: 'warning',
    direction: 'down',
  };
}

export function computeChartAxisTicks(
  maxValue: number,
): [number, number, number, number] {
  const safeMax = Math.max(0, Math.ceil(Number(maxValue) || 0));
  const axisMax = Math.max(3, Math.ceil(safeMax / 3) * 3);
  return [axisMax, (axisMax * 2) / 3, axisMax / 3, 0];
}

export function escapeCsvCell(value: unknown) {
  const raw = value == null ? '' : String(value);
  const safe = /^[=@\t\r]|^[+-](?!\d)/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function toCsvDocument(rows: unknown[][]) {
  return (
    '\uFEFF' + rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')
  );
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sharePercent(part: number, total: number) {
  if (total <= 0 || part <= 0) return '0%';
  return `${((part / total) * 100).toLocaleString('vi-VN', {
    maximumFractionDigits: 1,
  })}%`;
}

export function buildDashboardCsvContent(
  dashboard: AdminDashboardData,
  exportedBy?: { displayName?: string; email?: string },
) {
  const b = dashboard.breakdown;
  const msgTypes = b?.messageTypes ?? {
    text: 0,
    image: 0,
    file: 0,
    voice: 0,
    location: 0,
    call: 0,
  };
  const msgTypeSum =
    msgTypes.text +
    msgTypes.image +
    msgTypes.file +
    msgTypes.voice +
    msgTypes.location +
    msgTypes.call;
  const reports = b?.reports ?? {
    total: dashboard.totals.pendingReports,
    open: dashboard.totals.pendingReports,
    reviewing: 0,
    resolved: 0,
    dismissed: 0,
    byTarget: { user: 0, message: 0, attachment: 0, call: 0, conversation: 0 },
  };
  const calls = b?.calls ?? {
    audio: 0,
    video: 0,
    completed: 0,
    missedOrRejected: 0,
    totalDurationSeconds: 0,
    aiSummaries: 0,
  };
  const ai = b?.aiJobs ?? {
    total: 0,
    completed: 0,
    chat: 0,
    summary: 0,
    replySuggestions: 0,
  };

  const userDelta = computeGrowthBadge(
    dashboard.users.newPeriod,
    dashboard.users.newPreviousPeriod,
  ).label;
  const msgDelta = computeGrowthBadge(
    dashboard.totals.messagesPeriod,
    dashboard.totals.messagesPreviousPeriod,
  ).label;
  const callDelta = computeGrowthBadge(
    dashboard.totals.callsPeriod,
    dashboard.totals.callsPreviousPeriod,
  ).label;

  const seriesTotals = dashboard.series.reduce(
    (acc, p) => ({
      newUsers: acc.newUsers + p.newUsers,
      messages: acc.messages + p.messages,
      calls: acc.calls + p.calls,
      games: acc.games + p.games,
    }),
    { newUsers: 0, messages: 0, calls: 0, games: 0 },
  );
  const dayCount = Math.max(1, dashboard.series.length || dashboard.days);

  const rows: unknown[][] = [
    ['BÁO CÁO THỐNG KÊ VẬN HÀNH HỆ THỐNG PINGPONG'],
    ['Thời điểm xuất báo cáo', formatDateTime(new Date().toISOString())],
    [
      'Người xuất báo cáo',
      exportedBy?.displayName
        ? `${exportedBy.displayName} (${exportedBy.email ?? ''})`
        : 'Quản trị viên hệ thống',
    ],
    ['Kỳ thống kê', `${dashboard.days} ngày gần nhất`],
    [],
    ['I. TỔNG QUAN CHỈ SỐ HỆ THỐNG (KPI)', 'GIÁ TRỊ', 'SO SÁNH / GHI CHÚ'],
    ['Tổng tài khoản đăng ký', dashboard.users.total, 'Toàn hệ thống'],
    ['Tài khoản đang hoạt động', dashboard.users.active, 'Trạng thái active'],
    [
      'Tài khoản bị khóa / xóa mềm',
      `${dashboard.users.blocked} / ${dashboard.users.deleted}`,
      'Bị chặn hoặc thu hồi',
    ],
    ['Quản trị viên (Admin)', dashboard.users.admins, 'Quyền quản trị'],
    [
      'Người dùng hoạt động 24 giờ qua (DAU)',
      dashboard.users.active24h ?? 0,
      'Tương tác gần nhất',
    ],
    [
      'Người dùng hoạt động 7 ngày qua (WAU)',
      dashboard.users.active7d ?? 0,
      'Tương tác tuần',
    ],
    [
      `Đăng ký mới (${dashboard.days} ngày)`,
      dashboard.users.newPeriod ?? seriesTotals.newUsers,
      `So với kỳ trước: ${userDelta}`,
    ],
    [
      'Tin nhắn trong ngày hôm nay',
      dashboard.totals.messagesToday,
      'Từ 00:00 hôm nay',
    ],
    [
      `Tổng tin nhắn (${dashboard.days} ngày)`,
      dashboard.totals.messagesPeriod,
      `So với kỳ trước: ${msgDelta}`,
    ],
    [
      'Hội thoại trực tiếp (1-1) / Nhóm chat',
      `${dashboard.totals.directConversationsTotal ?? 0} / ${dashboard.totals.groupsTotal}`,
      'Đang hoạt động',
    ],
    [
      `Tổng cuộc gọi (${dashboard.days} ngày)`,
      dashboard.totals.callsPeriod,
      `So với kỳ trước: ${callDelta}`,
    ],
    [
      'Tổng thời lượng đàm thoại hoàn tất',
      formatDurationSeconds(calls.totalDurationSeconds),
      `${calls.completed} cuộc gọi hoàn tất`,
    ],
    [
      `Phiên trò chơi tương tác (${dashboard.days} ngày)`,
      dashboard.totals.gamesPeriod,
      'Trò chơi trong phòng chat',
    ],
    [
      'Tệp đính kèm & Lưu trữ media',
      dashboard.totals.uploadFilesTotal,
      formatBytes(dashboard.totals.uploadBytesTotal),
    ],
    [
      'Tác vụ AI thông minh trong kỳ',
      ai.total,
      `Hoàn tất: ${ai.completed} (Chat: ${ai.chat}, Tóm tắt: ${ai.summary}, Gợi ý: ${ai.replySuggestions})`,
    ],
    [
      'Tin nhắn nghi vấn Spam (AI phát hiện)',
      dashboard.totals.spamDetectedPeriod ?? 0,
      `Tin đã thu hồi/xóa: ${dashboard.totals.recalledMessagesPeriod ?? 0}`,
    ],
    [],
    [
      `II. CƠ CẤU LOẠI TIN NHẮN (${dashboard.days} NGÀY)`,
      'SỐ LƯỢNG',
      'TỶ TRỌNG',
    ],
    [
      'Tin nhắn văn bản (Text)',
      msgTypes.text,
      sharePercent(msgTypes.text, msgTypeSum),
    ],
    [
      'Hình ảnh (Image)',
      msgTypes.image,
      sharePercent(msgTypes.image, msgTypeSum),
    ],
    [
      'Tệp tài liệu (File)',
      msgTypes.file,
      sharePercent(msgTypes.file, msgTypeSum),
    ],
    [
      'Tin nhắn thoại (Voice)',
      msgTypes.voice,
      sharePercent(msgTypes.voice, msgTypeSum),
    ],
    [
      'Chia sẻ vị trí (Location)',
      msgTypes.location,
      sharePercent(msgTypes.location, msgTypeSum),
    ],
    [
      'Sự kiện cuộc gọi (Call log)',
      msgTypes.call,
      sharePercent(msgTypes.call, msgTypeSum),
    ],
    [],
    ['III. THỐNG KÊ KIỂM DUYỆT & AN TOÀN CỘNG ĐỒNG', 'SỐ LƯỢNG', 'GHI CHÚ'],
    ['Tổng báo cáo vi phạm ghi nhận', reports.total, 'Toàn thời gian'],
    ['Đang chờ xử lý (Open)', reports.open, 'Cần quản trị viên tiếp nhận'],
    ['Đang xem xét (Reviewing)', reports.reviewing, 'Đang xác minh bằng chứng'],
    ['Đã giải quyết (Resolved)', reports.resolved, 'Đã xử lý vi phạm'],
    ['Đã bác bỏ (Dismissed)', reports.dismissed, 'Không đủ căn cứ vi phạm'],
    [
      'Phân loại theo đối tượng bị báo cáo',
      `Tin nhắn: ${reports.byTarget.message} | Người dùng: ${reports.byTarget.user} | Ảnh: ${reports.byTarget.attachment} | Cuộc gọi: ${reports.byTarget.call}`,
      sharePercent(reports.resolved + reports.dismissed, reports.total) +
        ' tỷ lệ hoàn tất xử lý',
    ],
    [],
    [
      `IV. BIẾN ĐỘNG CHI TIẾT THEO NGÀY (${dashboard.days} NGÀY)`,
      'ĐĂNG KÝ MỚI',
      'TIN NHẮN',
      'CUỘC GỌI',
      'TRÒ CHƠI',
    ],
    ...dashboard.series.map((point) => [
      point.date,
      point.newUsers,
      point.messages,
      point.calls,
      point.games,
    ]),
    [
      'TỔNG CỘNG TRONG KỲ',
      seriesTotals.newUsers,
      seriesTotals.messages,
      seriesTotals.calls,
      seriesTotals.games,
    ],
    [
      'TRUNG BÌNH / NGÀY',
      (seriesTotals.newUsers / dayCount).toFixed(2),
      (seriesTotals.messages / dayCount).toFixed(2),
      (seriesTotals.calls / dayCount).toFixed(2),
      (seriesTotals.games / dayCount).toFixed(2),
    ],
  ];

  return toCsvDocument(rows);
}

export function buildFormalReportHtml(
  dashboard: AdminDashboardData,
  exportedBy?: { displayName?: string; email?: string },
) {
  const nowText = formatDateTime(new Date().toISOString());
  const firstDate = dashboard.series[0]?.date ?? '—';
  const lastDate = dashboard.series[dashboard.series.length - 1]?.date ?? '—';
  const adminLabel = exportedBy?.displayName
    ? `${exportedBy.displayName}${exportedBy.email ? ` (${exportedBy.email})` : ''}`
    : 'Quản trị viên Hệ thống';

  const b = dashboard.breakdown;
  const msgTypes = b?.messageTypes ?? {
    text: 0,
    image: 0,
    file: 0,
    voice: 0,
    location: 0,
    call: 0,
  };
  const msgTotal =
    msgTypes.text +
    msgTypes.image +
    msgTypes.file +
    msgTypes.voice +
    msgTypes.location +
    msgTypes.call;
  const calls = b?.calls ?? {
    audio: 0,
    video: 0,
    completed: 0,
    missedOrRejected: 0,
    totalDurationSeconds: 0,
    aiSummaries: 0,
  };
  const ai = b?.aiJobs ?? {
    total: 0,
    completed: 0,
    chat: 0,
    summary: 0,
    replySuggestions: 0,
  };
  const reports = b?.reports ?? {
    total: dashboard.totals.pendingReports,
    open: dashboard.totals.pendingReports,
    reviewing: 0,
    resolved: 0,
    dismissed: 0,
    byTarget: { user: 0, message: 0, attachment: 0, call: 0, conversation: 0 },
  };

  const seriesTotals = dashboard.series.reduce(
    (acc, p) => ({
      newUsers: acc.newUsers + p.newUsers,
      messages: acc.messages + p.messages,
      calls: acc.calls + p.calls,
      games: acc.games + p.games,
    }),
    { newUsers: 0, messages: 0, calls: 0, games: 0 },
  );
  const dayCount = Math.max(1, dashboard.series.length || dashboard.days);

  const userDelta = computeGrowthBadge(
    dashboard.users.newPeriod,
    dashboard.users.newPreviousPeriod,
  ).label;
  const msgDelta = computeGrowthBadge(
    dashboard.totals.messagesPeriod,
    dashboard.totals.messagesPreviousPeriod,
  ).label;
  const callDelta = computeGrowthBadge(
    dashboard.totals.callsPeriod,
    dashboard.totals.callsPreviousPeriod,
  ).label;
  const resolutionRate = sharePercent(
    reports.resolved + reports.dismissed,
    reports.total,
  );

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>Báo cáo thống kê hệ thống PingPong (${escapeHtml(dashboard.days)} ngày)</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px 36px 44px;
      font-family: "Times New Roman", "Be Vietnam Pro", Georgia, serif;
      color: #1c1917;
      background: #f5f2ed;
      line-height: 1.5;
      font-size: 13.5px;
    }
    .sheet {
      max-width: 920px;
      margin: 0 auto;
      background: #ffffff;
      padding: 36px 44px;
      border: 1px solid #d6cfc7;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.08);
    }
    .toolbar {
      max-width: 920px;
      margin: 0 auto 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .toolbar button {
      padding: 9px 18px;
      border-radius: 8px;
      border: 1px solid #9a3f17;
      background: #b75020;
      color: #fff;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
    }
    .toolbar span { font-size: 13px; color: #57534e; }
    .doc-header {
      display: flex;
      justify-content: space-between;
      border-bottom: 2px solid #292524;
      padding-bottom: 14px;
      margin-bottom: 20px;
      gap: 16px;
    }
    .doc-org strong {
      display: block;
      font-size: 13px;
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }
    .doc-org small { color: #57534e; font-size: 12px; }
    .doc-title {
      text-align: center;
      margin: 16px 0 22px;
    }
    .doc-title h1 {
      margin: 0 0 6px;
      font-size: 20px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .doc-title p {
      margin: 2px 0;
      color: #44403c;
      font-size: 13px;
    }
    h2 {
      font-size: 14.5px;
      text-transform: uppercase;
      margin: 22px 0 10px;
      padding-bottom: 4px;
      border-bottom: 1px solid #d6d3d1;
      color: #292524;
    }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 16px;
    }
    .kpi-box {
      border: 1px solid #d6d3d1;
      padding: 10px 12px;
      background: #fafaf9;
    }
    .kpi-box span { display: block; font-size: 11.5px; color: #57534e; }
    .kpi-box strong { display: block; font-size: 20px; margin: 3px 0; }
    .kpi-box small { font-size: 11.5px; color: #78716c; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 12.8px;
    }
    th, td {
      border: 1px solid #d6d3d1;
      padding: 7px 10px;
      text-align: left;
    }
    th {
      background: #f5f5f4;
      font-weight: 700;
    }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    tr.summary-row td {
      font-weight: 700;
      background: #fafaf9;
    }
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .signatures {
      margin-top: 32px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      text-align: center;
      gap: 24px;
    }
    .signatures p { margin: 4px 0 56px; font-style: italic; color: #57534e; font-size: 12.5px; }
    @media print {
      body { background: #ffffff; padding: 0; }
      .toolbar { display: none !important; }
      .sheet { border: 0; box-shadow: none; padding: 12px 18px; max-width: none; }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span>Bản xem trước báo cáo chuẩn A4 — Chọn <strong>In / Lưu dưới dạng PDF</strong> trong hộp thoại in.</span>
    <button type="button" onclick="window.print()">In báo cáo / Lưu PDF</button>
  </div>
  <div class="sheet">
    <div class="doc-header">
      <div class="doc-org">
        <strong>HỆ THỐNG TRÒ CHUYỆN TRỰC TUYẾN PINGPONG</strong>
        <small>Phân hệ Quản trị, Thống kê &amp; Tuân thủ An toàn Thông tin</small>
      </div>
      <div class="doc-org" style="text-align:right">
        <strong>BÁO CÁO SỐ LIỆU THỰC TẾ</strong>
        <small>Trích xuất lúc: ${escapeHtml(nowText)}</small>
      </div>
    </div>

    <div class="doc-title">
      <h1>Báo Cáo Thống Kê Vận Hành &amp; Kiểm Duyệt Hệ Thống</h1>
      <p>Kỳ thống kê: <strong>${escapeHtml(dashboard.days)} ngày gần nhất</strong> (từ ${escapeHtml(firstDate)} đến ${escapeHtml(lastDate)})</p>
      <p>Người trích xuất: <strong>${escapeHtml(adminLabel)}</strong></p>
    </div>

    <h2>1. Chỉ số tổng quan hệ thống (KPI)</h2>
    <div class="kpi-grid">
      <div class="kpi-box">
        <span>Tổng tài khoản</span>
        <strong>${escapeHtml(dashboard.users.total.toLocaleString('vi-VN'))}</strong>
        <small>${escapeHtml(dashboard.users.active)} hoạt động · ${escapeHtml(userDelta)} kỳ này</small>
      </div>
      <div class="kpi-box">
        <span>Tin nhắn (${escapeHtml(dashboard.days)} ngày)</span>
        <strong>${escapeHtml(dashboard.totals.messagesPeriod.toLocaleString('vi-VN'))}</strong>
        <small>Hôm nay: ${escapeHtml(dashboard.totals.messagesToday)} · ${escapeHtml(msgDelta)}</small>
      </div>
      <div class="kpi-box">
        <span>Cuộc gọi &amp; Đàm thoại</span>
        <strong>${escapeHtml(dashboard.totals.callsPeriod.toLocaleString('vi-VN'))}</strong>
        <small>${escapeHtml(formatDurationSeconds(calls.totalDurationSeconds))} · ${escapeHtml(callDelta)}</small>
      </div>
      <div class="kpi-box">
        <span>Kiểm duyệt &amp; Lưu trữ</span>
        <strong>${escapeHtml(dashboard.totals.pendingReports)} chờ</strong>
        <small>Xử lý ${escapeHtml(resolutionRate)} · ${escapeHtml(formatBytes(dashboard.totals.uploadBytesTotal))}</small>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Hạng mục thống kê</th>
          <th class="num">Số liệu</th>
          <th>Chi tiết / Đánh giá</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Người dùng hoạt động (DAU 24h / WAU 7 ngày)</td>
          <td class="num">${escapeHtml(dashboard.users.active24h ?? 0)} / ${escapeHtml(dashboard.users.active7d ?? 0)}</td>
          <td>Bị khóa: ${escapeHtml(dashboard.users.blocked)} · Xóa mềm: ${escapeHtml(dashboard.users.deleted)} · Quản trị viên: ${escapeHtml(dashboard.users.admins)}</td>
        </tr>
        <tr>
          <td>Không gian hội thoại đang hoạt động</td>
          <td class="num">${escapeHtml(((dashboard.totals.directConversationsTotal ?? 0) + dashboard.totals.groupsTotal).toLocaleString('vi-VN'))}</td>
          <td>Trò chuyện trực tiếp (1-1): ${escapeHtml(dashboard.totals.directConversationsTotal ?? 0)} · Nhóm trò chuyện: ${escapeHtml(dashboard.totals.groupsTotal)}</td>
        </tr>
        <tr>
          <td>Đa phương tiện &amp; Tệp đính kèm</td>
          <td class="num">${escapeHtml(dashboard.totals.uploadFilesTotal.toLocaleString('vi-VN'))} tệp</td>
          <td>Tổng dung lượng lưu trữ mã hóa: ${escapeHtml(formatBytes(dashboard.totals.uploadBytesTotal))}</td>
        </tr>
        <tr>
          <td>Trí tuệ nhân tạo (AI Assistant &amp; Chống Spam)</td>
          <td class="num">${escapeHtml(ai.total.toLocaleString('vi-VN'))} tác vụ</td>
          <td>Chat AI: ${escapeHtml(ai.chat)} · Tóm tắt: ${escapeHtml(ai.summary)} · Gợi ý trả lời: ${escapeHtml(ai.replySuggestions)} · Cảnh báo Spam: ${escapeHtml(dashboard.totals.spamDetectedPeriod ?? 0)}</td>
        </tr>
      </tbody>
    </table>

    <div class="two-col">
      <div>
        <h2>2. Cơ cấu loại tin nhắn (${escapeHtml(dashboard.days)} ngày)</h2>
        <table>
          <thead>
            <tr>
              <th>Loại nội dung</th>
              <th class="num">Số lượng</th>
              <th class="num">Tỷ trọng</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Văn bản (Text)</td><td class="num">${escapeHtml(msgTypes.text)}</td><td class="num">${escapeHtml(sharePercent(msgTypes.text, msgTotal))}</td></tr>
            <tr><td>Hình ảnh (Image)</td><td class="num">${escapeHtml(msgTypes.image)}</td><td class="num">${escapeHtml(sharePercent(msgTypes.image, msgTotal))}</td></tr>
            <tr><td>Tệp đính kèm (File)</td><td class="num">${escapeHtml(msgTypes.file)}</td><td class="num">${escapeHtml(sharePercent(msgTypes.file, msgTotal))}</td></tr>
            <tr><td>Tin nhắn thoại (Voice)</td><td class="num">${escapeHtml(msgTypes.voice)}</td><td class="num">${escapeHtml(sharePercent(msgTypes.voice, msgTotal))}</td></tr>
            <tr><td>Vị trí (Location)</td><td class="num">${escapeHtml(msgTypes.location)}</td><td class="num">${escapeHtml(sharePercent(msgTypes.location, msgTotal))}</td></tr>
            <tr><td>Bản ghi cuộc gọi (Call)</td><td class="num">${escapeHtml(msgTypes.call)}</td><td class="num">${escapeHtml(sharePercent(msgTypes.call, msgTotal))}</td></tr>
          </tbody>
        </table>
      </div>
      <div>
        <h2>3. Kiểm duyệt &amp; Cuộc gọi</h2>
        <table>
          <thead>
            <tr>
              <th>Chỉ tiêu</th>
              <th class="num">Số lượng</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Cuộc gọi Thoại / Video</td><td class="num">${escapeHtml(calls.audio)} / ${escapeHtml(calls.video)}</td><td>Hoàn tất: ${escapeHtml(calls.completed)}</td></tr>
            <tr><td>Cuộc gọi có AI tóm tắt</td><td class="num">${escapeHtml(calls.aiSummaries)}</td><td>Nhỡ/Hủy: ${escapeHtml(calls.missedOrRejected)}</td></tr>
            <tr><td>Báo cáo Chờ / Đang xử lý</td><td class="num">${escapeHtml(reports.open)} / ${escapeHtml(reports.reviewing)}</td><td>Ưu tiên kiểm duyệt</td></tr>
            <tr><td>Báo cáo Đã giải quyết / Bác bỏ</td><td class="num">${escapeHtml(reports.resolved)} / ${escapeHtml(reports.dismissed)}</td><td>Hoàn tất: ${escapeHtml(resolutionRate)}</td></tr>
            <tr><td>Đối tượng bị báo cáo</td><td class="num">${escapeHtml(reports.total)}</td><td>Tin: ${escapeHtml(reports.byTarget.message)}, User: ${escapeHtml(reports.byTarget.user)}, Ảnh: ${escapeHtml(reports.byTarget.attachment)}</td></tr>
            <tr><td>Phiên trò chơi tương tác</td><td class="num">${escapeHtml(dashboard.totals.gamesPeriod)}</td><td>Hoạt động giải trí</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <h2>4. Thống kê chi tiết biến động theo ngày</h2>
    <table>
      <thead>
        <tr>
          <th>Ngày</th>
          <th class="num">Đăng ký mới</th>
          <th class="num">Tin nhắn</th>
          <th class="num">Cuộc gọi</th>
          <th class="num">Phiên trò chơi</th>
        </tr>
      </thead>
      <tbody>
        ${dashboard.series
          .map(
            (point) => `<tr>
          <td>${escapeHtml(point.date)}</td>
          <td class="num">${escapeHtml(point.newUsers.toLocaleString('vi-VN'))}</td>
          <td class="num">${escapeHtml(point.messages.toLocaleString('vi-VN'))}</td>
          <td class="num">${escapeHtml(point.calls.toLocaleString('vi-VN'))}</td>
          <td class="num">${escapeHtml(point.games.toLocaleString('vi-VN'))}</td>
        </tr>`,
          )
          .join('')}
        <tr class="summary-row">
          <td>TỔNG CỘNG (${escapeHtml(dashboard.days)} NGÀY)</td>
          <td class="num">${escapeHtml(seriesTotals.newUsers.toLocaleString('vi-VN'))}</td>
          <td class="num">${escapeHtml(seriesTotals.messages.toLocaleString('vi-VN'))}</td>
          <td class="num">${escapeHtml(seriesTotals.calls.toLocaleString('vi-VN'))}</td>
          <td class="num">${escapeHtml(seriesTotals.games.toLocaleString('vi-VN'))}</td>
        </tr>
        <tr class="summary-row">
          <td>TRUNG BÌNH / NGÀY</td>
          <td class="num">${escapeHtml((seriesTotals.newUsers / dayCount).toFixed(1))}</td>
          <td class="num">${escapeHtml((seriesTotals.messages / dayCount).toFixed(1))}</td>
          <td class="num">${escapeHtml((seriesTotals.calls / dayCount).toFixed(1))}</td>
          <td class="num">${escapeHtml((seriesTotals.games / dayCount).toFixed(1))}</td>
        </tr>
      </tbody>
    </table>

    <div class="signatures">
      <div>
        <strong>NGƯỜI LẬP BÁO CÁO</strong>
        <p>(Ký, ghi rõ họ tên)</p>
        <strong>${escapeHtml(exportedBy?.displayName ?? 'Quản trị viên')}</strong>
      </div>
      <div>
        <strong>XÁC NHẬN QUẢN TRỊ HỆ THỐNG</strong>
        <p>(Ký, đóng dấu xác nhận)</p>
        <strong>Hệ thống PingPong</strong>
      </div>
    </div>
  </div>
</body>
</html>`;
}
