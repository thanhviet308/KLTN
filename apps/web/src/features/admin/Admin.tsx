import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownRight,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileJson,
  Flag,
  HardDrive,
  LayoutDashboard,
  MessageCircle,
  Minus,
  PhoneCall,
  Printer,
  RotateCw,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import * as api from '../../lib/api';
import type { User } from '../../lib/api';
import { AdminAuditCompliance } from './AdminAuditCompliance';
import { AdminUsers } from './AdminUsers';
import {
  computeChartAxisTicks,
  computeGrowthBadge,
  exportDashboardCsv,
  exportDashboardJson,
  exportUsersListCsv,
  formatBytes,
  formatDateTime,
  formatDurationSeconds,
  printDashboardFormalReport,
  type AdminDashboardData,
  type AdminUserAccount,
} from './admin-export';
import {
  initialUsers,
  sections,
  type AdminSection,
  type AdminUser,
} from './admin-model';
import './admin.css';
import { ReportQueue } from '../reports/ReportQueue';

const icons = {
  overview: LayoutDashboard,
  users: Users,
  reports: Flag,
  activity: ClipboardList,
};

const demoSeries = [32, 47, 38, 62, 51, 73, 64, 85, 69, 93, 82, 108, 96, 124];
type SeriesMetric = 'messages' | 'newUsers' | 'calls' | 'games';

const metricLabels: Record<SeriesMetric, string> = {
  messages: 'Tin nhắn',
  newUsers: 'Đăng ký mới',
  calls: 'Cuộc gọi',
  games: 'Trò chơi',
};

function chartDate(index: number, period: string) {
  return new Date(
    Date.UTC(2026, 10, 13 - Number(period) + index),
  ).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  });
}

const avatarTones = ['peach', 'sage', 'lilac', 'sand'] as const;
function avatarTone(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return avatarTones[Math.abs(hash) % avatarTones.length];
}

function formatShortIsoDate(isoDate: string) {
  const [, m, d] = isoDate.split('-');
  return d && m ? `${d}/${m}` : isoDate;
}

function buildDemoDashboard(
  daysCount: number,
  pendingCount: number,
): AdminDashboardData {
  const slice = demoSeries.slice(-Math.min(daysCount, demoSeries.length));
  return {
    days: daysCount,
    users: {
      total: 2846,
      active: 2790,
      blocked: 42,
      deleted: 14,
      admins: 5,
      active24h: 612,
      active7d: 1840,
      newPeriod: 128,
      newPreviousPeriod: 112,
    },
    totals: {
      messagesToday: 1829,
      messagesPeriod: 18294,
      messagesPreviousPeriod: 16905,
      callsPeriod: 412,
      callsPreviousPeriod: 378,
      gamesPeriod: 196,
      gamesPreviousPeriod: 165,
      groupsTotal: 326,
      directConversationsTotal: 1480,
      pendingReports: pendingCount,
      spamDetectedPeriod: 19,
      recalledMessagesPeriod: 64,
      uploadFilesTotal: 1284,
      uploadBytesTotal: String(428 * 1024 * 1024),
    },
    series: slice.map((val, idx) => ({
      date: `2026-11-${String(Math.max(1, 18 - slice.length + idx + 1)).padStart(2, '0')}`,
      newUsers: Math.max(2, Math.round(val / 10)),
      messages: val * 12,
      calls: Math.max(1, Math.round(val / 3)),
      games: Math.max(1, Math.round(val / 5)),
    })),
    breakdown: {
      messageTypes: {
        text: 14120,
        image: 2460,
        file: 680,
        voice: 520,
        location: 102,
        call: 412,
      },
      calls: {
        audio: 248,
        video: 164,
        completed: 336,
        missedOrRejected: 76,
        totalDurationSeconds: 94200,
        aiSummaries: 82,
      },
      aiJobs: {
        total: 645,
        completed: 638,
        chat: 310,
        summary: 145,
        replySuggestions: 190,
      },
      reports: {
        total: 48,
        open: pendingCount,
        reviewing: 2,
        resolved: 36,
        dismissed: 7,
        byTarget: {
          user: 9,
          message: 26,
          attachment: 8,
          call: 5,
          conversation: 0,
        },
      },
    },
  };
}

export function Admin({ user, onBack }: { user?: User; onBack: () => void }) {
  const isAdmin = user?.role === 'admin';
  const readSection = (): AdminSection =>
    sections.find((s) => `#${s.id}` === location.hash)?.id ?? 'overview';
  const [section, setSection] = useState<AdminSection>(readSection);
  const [users, setUsers] = useState(initialUsers);
  const [pending, setPending] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [period, setPeriod] = useState('14');
  const [seriesMetric, setSeriesMetric] = useState<SeriesMetric>('messages');
  const [logs, setLogs] = useState<{ text: string; time: string }[]>([]);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [focusUserId, setFocusUserId] = useState<string | null>(null);

  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [recentRealUsers, setRecentRealUsers] = useState<AdminUserAccount[]>(
    [],
  );

  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const dashboardRequest = useRef(0);
  const dashboardInFlight = useRef(false);

  const loadDashboard = useCallback(
    async (days = period) => {
      if (!isAdmin) return;
      const request = ++dashboardRequest.current;
      dashboardInFlight.current = true;
      setDashboardLoading(true);
      setDashboardError('');
      try {
        const [dash, recent] = await Promise.all([
          api.authenticated<AdminDashboardData>(
            `/admin/dashboard?days=${Number(days) || 14}`,
          ),
          api.authenticated<{ items: AdminUserAccount[] }>(
            '/admin/users?limit=6',
          ),
        ]);
        if (request !== dashboardRequest.current) return;
        setDashboard(dash);
        setPending(dash.totals.pendingReports);
        setRecentRealUsers(recent.items);
      } catch (e) {
        if (request === dashboardRequest.current)
          setDashboardError(api.errorMessage(e));
      } finally {
        if (request === dashboardRequest.current) {
          dashboardInFlight.current = false;
          setDashboardLoading(false);
        }
      }
    },
    [isAdmin, period],
  );

  useEffect(() => {
    void loadDashboard(period);
    return () => {
      dashboardRequest.current++;
      dashboardInFlight.current = false;
    };
  }, [loadDashboard, period]);

  useEffect(() => {
    if (!isAdmin || section !== 'overview') return;
    const refresh = () => {
      if (document.visibilityState !== 'visible' || dashboardInFlight.current)
        return;
      void loadDashboard();
    };
    refresh();
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [isAdmin, section, loadDashboard]);

  useEffect(() => {
    const sync = () => {
      setSection(readSection());
      setQuery('');
      setPage(1);
    };
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  useEffect(() => {
    if (selected) {
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (dialog.current?.open) {
      dialog.current.close();
    }
  }, [selected]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const current = sections.find((s) => s.id === section)!;
  const filtered = users.filter(
    (u) =>
      `${u.name} ${u.email} ${u.id}`
        .toLocaleLowerCase('vi')
        .includes(query.toLocaleLowerCase('vi')) &&
      (filter === 'all' || u.status === filter),
  );
  const pageSize = section === 'overview' ? 4 : 5;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleUsers = filtered.slice(
    (Math.min(page, pageCount) - 1) * pageSize,
    Math.min(page, pageCount) * pageSize,
  );

  function navigate(id: AdminSection, targetUserId?: string) {
    if (targetUserId) setFocusUserId(targetUserId);
    location.hash = id;
    setSection(id);
    setPage(1);
    setQuery('');
    setFilter('all');
    requestAnimationFrame(() => heading.current?.focus());
  }

  function record(text: string) {
    setLogs((old) => [
      {
        text,
        time: new Date().toLocaleTimeString('vi-VN', {
          timeZone: 'Asia/Ho_Chi_Minh',
        }),
      },
      ...old,
    ]);
    setNotice(`${text} — dữ liệu xem thử.`);
  }

  function activeDashboardSnapshot(): AdminDashboardData {
    if (isAdmin && dashboard) return dashboard;
    return buildDemoDashboard(Number(period) || 14, pending);
  }

  function handleExportReportCsv() {
    const snap = activeDashboardSnapshot();
    exportDashboardCsv(snap, {
      displayName: user?.displayName,
      email: user?.email,
    });
    setNotice(`Đã xuất báo cáo thống kê (${snap.days} ngày) ra tệp CSV.`);
  }

  function handleExportReportJson() {
    const snap = activeDashboardSnapshot();
    exportDashboardJson(snap, {
      displayName: user?.displayName,
      email: user?.email,
    });
    setNotice(`Đã xuất dữ liệu thống kê (${snap.days} ngày) ra tệp JSON.`);
  }

  function handlePrintFormalReport() {
    const snap = activeDashboardSnapshot();
    const opened = printDashboardFormalReport(snap, {
      displayName: user?.displayName,
      email: user?.email,
    });
    if (!opened) {
      setDashboardError(
        'Trình duyệt đang chặn cửa sổ bật lên (popup). Hãy cho phép popup để mở trang In / Lưu PDF.',
      );
      return;
    }
    setNotice('Đã mở bản xem trước Báo cáo thống kê chuẩn A4 (In / Lưu PDF).');
  }

  async function exportOverviewUsers() {
    if (isAdmin) {
      setDashboardLoading(true);
      try {
        const res = await api.authenticated<{ items: AdminUserAccount[] }>(
          '/admin/users?limit=50',
        );
        exportUsersListCsv(res.items);
        setNotice(`Đã xuất ${res.items.length} người dùng ra tệp CSV.`);
      } catch (e) {
        setDashboardError(api.errorMessage(e));
      } finally {
        setDashboardLoading(false);
      }
      return;
    }

    const csvRows = filtered.map((u) => ({
      id: u.id,
      displayName: u.name,
      email: u.email,
      role: (u.role === 'Quản trị viên' ? 'admin' : 'user') as 'admin' | 'user',
      status: u.status,
      lastActiveAt: null,
      createdAt: u.joined,
    }));
    exportUsersListCsv(csvRows, 'pingpong-nguoi-dung-mau.csv');
    record('Đã xuất danh sách người dùng mẫu');
  }

  const activeData = activeDashboardSnapshot();
  const realSeries = isAdmin ? (dashboard?.series ?? []) : activeData.series;
  const realValues = realSeries.map((point) => point[seriesMetric]);
  const realMax = Math.max(0, ...realValues);
  const axisTicks = computeChartAxisTicks(realMax);
  const axisMax = axisTicks[0];
  const periodSum = realValues.reduce((sum, n) => sum + n, 0);
  const avgPerDay = realSeries.length > 0 ? periodSum / realSeries.length : 0;
  const peakPoint = realSeries.reduce<{ date: string; value: number } | null>(
    (best, p) => {
      const val = p[seriesMetric];
      if (!best || val >= best.value) return { date: p.date, value: val };
      return best;
    },
    null,
  );

  const breakdown = activeData.breakdown;
  const msgTypes = breakdown?.messageTypes ?? {
    text: 0,
    image: 0,
    file: 0,
    voice: 0,
    location: 0,
    call: 0,
  };
  const msgTypeTotal =
    msgTypes.text +
    msgTypes.image +
    msgTypes.file +
    msgTypes.voice +
    msgTypes.location +
    msgTypes.call;
  const msgTypeItems = [
    {
      key: 'text',
      label: 'Văn bản (Text)',
      count: msgTypes.text,
      tone: 'accent',
    },
    {
      key: 'image',
      label: 'Hình ảnh (Image)',
      count: msgTypes.image,
      tone: 'sage',
    },
    {
      key: 'file',
      label: 'Tệp tài liệu (File)',
      count: msgTypes.file,
      tone: 'lilac',
    },
    {
      key: 'voice',
      label: 'Tin nhắn thoại (Voice)',
      count: msgTypes.voice,
      tone: 'sand',
    },
    {
      key: 'call',
      label: 'Nhật ký cuộc gọi (Call)',
      count: msgTypes.call,
      tone: 'blue',
    },
    {
      key: 'location',
      label: 'Chia sẻ vị trí (GPS)',
      count: msgTypes.location,
      tone: 'muted',
    },
  ];

  const reportSummary = breakdown?.reports ?? {
    total: activeData.totals.pendingReports,
    open: activeData.totals.pendingReports,
    reviewing: 0,
    resolved: 0,
    dismissed: 0,
    byTarget: { user: 0, message: 0, attachment: 0, call: 0, conversation: 0 },
  };
  const handledReports = reportSummary.resolved + reportSummary.dismissed;
  const resolutionRate =
    reportSummary.total > 0
      ? Math.round((handledReports / reportSummary.total) * 100)
      : 100;

  const callStats = breakdown?.calls ?? {
    audio: 0,
    video: 0,
    completed: 0,
    missedOrRejected: 0,
    totalDurationSeconds: 0,
    aiSummaries: 0,
  };
  const aiStats = breakdown?.aiJobs ?? {
    total: 0,
    completed: 0,
    chat: 0,
    summary: 0,
    replySuggestions: 0,
  };

  const userGrowth = computeGrowthBadge(
    activeData.users.newPeriod,
    activeData.users.newPreviousPeriod,
  );
  const msgGrowth = computeGrowthBadge(
    activeData.totals.messagesPeriod,
    activeData.totals.messagesPreviousPeriod,
  );
  const callGrowth = computeGrowthBadge(
    activeData.totals.callsPeriod,
    activeData.totals.callsPreviousPeriod,
  );

  const kpiCards = [
    {
      title: 'Người dùng hệ thống',
      value: activeData.users.total.toLocaleString('vi-VN'),
      badge: userGrowth.label,
      tone: userGrowth.tone,
      direction: userGrowth.direction,
      icon: Users,
      color: 'peach',
      foot: `${activeData.users.active24h ?? 0} online 24h · ${activeData.users.active7d ?? 0} tuần qua · ${activeData.users.blocked} khóa`,
    },
    {
      title: `Lưu lượng tin nhắn (${activeData.days}d)`,
      value: activeData.totals.messagesPeriod.toLocaleString('vi-VN'),
      badge: msgGrowth.label,
      tone: msgGrowth.tone,
      direction: msgGrowth.direction,
      icon: MessageCircle,
      color: 'sage',
      foot: `Hôm nay: ${activeData.totals.messagesToday.toLocaleString('vi-VN')} · ${activeData.totals.directConversationsTotal ?? 0} chat 1-1 · ${activeData.totals.groupsTotal} nhóm`,
    },
    {
      title: `Đàm thoại & Trò chơi (${activeData.days}d)`,
      value: activeData.totals.callsPeriod.toLocaleString('vi-VN'),
      badge: callGrowth.label,
      tone: callGrowth.tone,
      direction: callGrowth.direction,
      icon: PhoneCall,
      color: 'lilac',
      foot: `${formatDurationSeconds(callStats.totalDurationSeconds)} gọi · ${activeData.totals.gamesPeriod} ván Caro`,
    },
    {
      title: 'Kiểm duyệt & An toàn',
      value: String(activeData.totals.pendingReports).padStart(2, '0'),
      badge:
        activeData.totals.pendingReports > 0
          ? `${activeData.totals.pendingReports} chờ xử lý`
          : '100% đã xử lý',
      tone:
        activeData.totals.pendingReports > 0
          ? ('warning' as const)
          : ('positive' as const),
      direction: 'flat' as const,
      icon: Flag,
      color: 'sand',
      foot: `Tỷ lệ xử lý ${resolutionRate}% · ${activeData.totals.spamDetectedPeriod ?? 0} cảnh báo Spam AI`,
    },
  ];

  const handleClearFocusUser = useCallback(() => {
    setFocusUserId(null);
  }, []);

  return (
    <div className="admin-shell">
      <a className="admin-skip" href="#admin-content">
        Đến nội dung chính
      </a>
      <aside className="admin-sidebar">
        <a
          className="admin-brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onBack();
          }}
        >
          <span>
            <MessageCircle size={23} />
          </span>
          PingPong<span className="admin-brand-dot">.</span>
        </a>
        <div className="admin-space">
          <ShieldCheck size={19} />
          <div>
            <strong>Không gian quản trị</strong>
            <small>Thống kê &amp; Điều hành</small>
          </div>
          <span className="admin-space-dot" />
        </div>
        <p className="admin-nav-label">PHÂN HỆ QUẢN TRỊ</p>
        <nav aria-label="Quản trị">
          {sections.map((s) => {
            const Icon = icons[s.id];
            return (
              <button
                key={s.id}
                className={section === s.id ? 'is-active' : ''}
                aria-current={section === s.id ? 'page' : undefined}
                onClick={() => navigate(s.id)}
              >
                <Icon size={19} />
                {s.label}
                {s.id === 'reports' && pending > 0 && (
                  <span className="admin-count">{pending}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-help">
            <ShieldCheck size={26} />
            <strong>Báo cáo &amp; Kiểm toán</strong>
            <p>
              Hỗ trợ xuất báo cáo thống kê CSV, JSON và biểu mẫu in PDF chuẩn A4
              từ dữ liệu thời gian thực.
            </p>
          </div>
          <button className="admin-return" onClick={onBack}>
            <ArrowLeft size={17} />
            Quay lại ứng dụng
          </button>
          <div className="admin-profile">
            <span className="admin-avatar sand">
              {(user?.displayName ?? 'Admin').slice(0, 1)}
            </span>
            <div>
              <strong>{user?.displayName ?? 'Quản trị viên'}</strong>
              <small>PingPong Admin</small>
            </div>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <div className="admin-breadcrumbs">
            <span>Không gian quản trị</span>
            <ChevronRight size={14} />
            <strong>{current.label}</strong>
          </div>
          <div className="admin-topbar-actions">
            <span className={`admin-preview-pill ${isAdmin ? 'is-live' : ''}`}>
              <i className="admin-live-dot" aria-hidden="true" />
              {isAdmin ? 'Dữ liệu PostgreSQL trực tiếp' : 'Chế độ xem thử'}
            </span>
          </div>
        </header>
        <main id="admin-content" className="admin-main">
          <div className="admin-page-heading">
            <div>
              <p className="admin-eyebrow">PINGPONG / QUẢN TRỊ HỆ THỐNG</p>
              <h1 ref={heading} tabIndex={-1}>
                {current.label}
                <span>.</span>
              </h1>
              <p>{current.description}</p>
            </div>
            {section === 'overview' && (
              <div className="admin-heading-actions">
                <select
                  aria-label="Kỳ thống kê báo cáo"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  <option value="7">Kỳ 7 ngày</option>
                  <option value="14">Kỳ 14 ngày</option>
                  <option value="30">Kỳ 30 ngày</option>
                  {isAdmin && <option value="90">Kỳ 90 ngày</option>}
                </select>
                {isAdmin && (
                  <button
                    type="button"
                    className="admin-button"
                    disabled={dashboardLoading}
                    onClick={() => void loadDashboard(period)}
                  >
                    <RotateCw size={15} />
                    Làm mới
                  </button>
                )}
                <button
                  type="button"
                  className="admin-button"
                  disabled={isAdmin && dashboardLoading && !dashboard}
                  onClick={handleExportReportCsv}
                >
                  <ArrowDownToLine size={16} />
                  Xuất thống kê CSV
                </button>
                <button
                  type="button"
                  className="admin-button"
                  disabled={isAdmin && dashboardLoading && !dashboard}
                  onClick={handleExportReportJson}
                  title="Xuất dữ liệu thống kê định dạng JSON"
                >
                  <FileJson size={16} />
                  JSON
                </button>
                <button
                  type="button"
                  className="admin-button primary"
                  disabled={isAdmin && dashboardLoading && !dashboard}
                  onClick={handlePrintFormalReport}
                >
                  <Printer size={16} />
                  Xuất báo cáo PDF / In
                </button>
              </div>
            )}
            {!isAdmin && section === 'users' && (
              <div className="admin-heading-actions">
                <button
                  type="button"
                  className="admin-button primary"
                  onClick={() => void exportOverviewUsers()}
                >
                  <ArrowDownToLine size={16} />
                  Xuất danh sách mẫu CSV
                </button>
              </div>
            )}
          </div>
          <div className="admin-demo-note">
            <ShieldCheck size={17} />
            <span>
              {isAdmin
                ? 'Số liệu tổng hợp trực tiếp từ cơ sở dữ liệu PostgreSQL, tự động làm mới mỗi 10 giây và hỗ trợ xuất báo cáo đa định dạng (CSV Excel, JSON, PDF/A4).'
                : 'Đang hiển thị dữ liệu mô phỏng để xem trước bố cục và mẫu xuất báo cáo.'}
            </span>
          </div>

          {section === 'overview' && (
            <>
              {isAdmin && dashboardError && (
                <div className="admin-inline-alert danger" role="alert">
                  {dashboardError}
                </div>
              )}
              <div className="admin-metrics">
                {kpiCards.map((m) => (
                  <article className="admin-metric" key={m.title}>
                    <div>
                      <span>{m.title}</span>
                      <span className={`admin-metric-icon ${m.color}`}>
                        <m.icon size={19} />
                      </span>
                    </div>
                    <strong>
                      {isAdmin && dashboardLoading && !dashboard
                        ? '…'
                        : m.value}
                    </strong>
                    <p>
                      <span className={`admin-${m.tone}`}>
                        {m.direction === 'up' && <ArrowUpRight size={13} />}
                        {m.direction === 'down' && <ArrowDownRight size={13} />}
                        {m.direction === 'flat' && <Minus size={12} />}
                        {m.badge}
                      </span>{' '}
                      <span>{m.foot}</span>
                    </p>
                  </article>
                ))}
              </div>

              <div className="admin-insights">
                <section className="admin-panel admin-chart">
                  <div className="admin-panel-heading">
                    <div>
                      <h2>Biểu đồ biến động theo ngày</h2>
                      <p>
                        Theo dõi chuỗi thời gian của{' '}
                        <strong>
                          {metricLabels[seriesMetric].toLowerCase()}
                        </strong>{' '}
                        trong {activeData.days} ngày gần nhất
                      </p>
                    </div>
                    <div
                      className="admin-pill-tabs"
                      role="tablist"
                      aria-label="Chọn chỉ số biểu đồ"
                    >
                      {(Object.keys(metricLabels) as SeriesMetric[]).map(
                        (key) => (
                          <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={seriesMetric === key}
                            className={seriesMetric === key ? 'is-active' : ''}
                            onClick={() => setSeriesMetric(key)}
                          >
                            {metricLabels[key]}
                          </button>
                        ),
                      )}
                    </div>
                  </div>

                  <div className="admin-chart-summary">
                    <div>
                      <span>Tổng trong kỳ ({activeData.days}d)</span>
                      <strong>{periodSum.toLocaleString('vi-VN')}</strong>
                    </div>
                    <div>
                      <span>Trung bình / ngày</span>
                      <strong>
                        {avgPerDay.toLocaleString('vi-VN', {
                          maximumFractionDigits: 1,
                        })}
                      </strong>
                    </div>
                    <div>
                      <span>Đỉnh cao nhất</span>
                      <strong>
                        {peakPoint
                          ? `${peakPoint.value.toLocaleString('vi-VN')} (${formatShortIsoDate(peakPoint.date)})`
                          : '0'}
                      </strong>
                    </div>
                  </div>

                  <div className="admin-plot">
                    <div className="admin-y-axis">
                      {axisTicks.map((tick) => (
                        <span key={tick}>{tick.toLocaleString('vi-VN')}</span>
                      ))}
                    </div>
                    <div className="admin-bars">
                      {realSeries.map((point, i) => {
                        const val = point[seriesMetric];
                        const pct =
                          val > 0
                            ? Math.max(8, Math.min(100, (val / axisMax) * 100))
                            : 3;
                        const labelDate = isAdmin
                          ? formatShortIsoDate(point.date)
                          : chartDate(i, period);
                        const showTick =
                          realSeries.length <= 15 ||
                          i % Math.ceil(realSeries.length / 10) === 0 ||
                          i === realSeries.length - 1;
                        return (
                          <div className="admin-bar-column" key={point.date}>
                            <button
                              type="button"
                              className={
                                i === realSeries.length - 1
                                  ? 'admin-bar latest'
                                  : val === 0
                                    ? 'admin-bar is-zero'
                                    : 'admin-bar'
                              }
                              style={{ height: `${pct}%` }}
                              aria-label={`Ngày ${labelDate}: ${val} ${metricLabels[seriesMetric]}`}
                              title={`${point.date}: ${val.toLocaleString('vi-VN')} ${metricLabels[seriesMetric]}`}
                            >
                              <span>
                                {labelDate}: {val.toLocaleString('vi-VN')}
                              </span>
                            </button>
                            {showTick && <small>{labelDate}</small>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="admin-chart-footer">
                    <span>
                      <span className="admin-positive">
                        Σ {periodSum.toLocaleString('vi-VN')}
                      </span>{' '}
                      {metricLabels[seriesMetric].toLowerCase()} ghi nhận trong{' '}
                      {activeData.days} ngày
                    </span>
                    <span>
                      {isAdmin
                        ? 'Đồng bộ tự động mỗi 10 giây'
                        : 'Dữ liệu mô phỏng'}
                    </span>
                  </div>
                </section>

                <section className="admin-panel admin-safety">
                  <div className="admin-safety-top">
                    <span className="admin-safety-icon">
                      <ShieldCheck size={24} />
                    </span>
                    <div>
                      <p className="admin-eyebrow">KIỂM DUYỆT &amp; AN TOÀN</p>
                      <h2>Tình trạng xử lý báo cáo</h2>
                    </div>
                  </div>

                  <div className="admin-safety-rate">
                    <div>
                      <span>Tỷ lệ hoàn tất giải quyết</span>
                      <strong>{resolutionRate}%</strong>
                    </div>
                    <div className="admin-progress-track">
                      <div
                        className="admin-progress-fill sage"
                        style={{ width: `${resolutionRate}%` }}
                      />
                    </div>
                  </div>

                  <div className="admin-safety-grid">
                    <div>
                      <small>Chờ xử lý</small>
                      <strong className="text-amber">
                        {reportSummary.open}
                      </strong>
                    </div>
                    <div>
                      <small>Đang xem xét</small>
                      <strong className="text-amber">
                        {reportSummary.reviewing}
                      </strong>
                    </div>
                    <div>
                      <small>Đã giải quyết</small>
                      <strong className="text-green">
                        {reportSummary.resolved}
                      </strong>
                    </div>
                    <div>
                      <small>Đã bác bỏ</small>
                      <strong>{reportSummary.dismissed}</strong>
                    </div>
                  </div>

                  <div className="admin-safety-targets">
                    <span>
                      Tin nhắn:{' '}
                      <strong>{reportSummary.byTarget.message}</strong>
                    </span>
                    <span>
                      Tài khoản: <strong>{reportSummary.byTarget.user}</strong>
                    </span>
                    <span>
                      Hình ảnh:{' '}
                      <strong>{reportSummary.byTarget.attachment}</strong>
                    </span>
                    <span>
                      Cuộc gọi: <strong>{reportSummary.byTarget.call}</strong>
                    </span>
                  </div>

                  <button
                    type="button"
                    className="admin-button primary"
                    onClick={() => navigate('reports')}
                  >
                    Mở hàng đợi kiểm duyệt ({pending})
                    <ArrowRight size={16} />
                  </button>
                </section>
              </div>

              <div className="admin-breakdown-grid">
                <section className="admin-panel">
                  <div className="admin-panel-heading">
                    <div>
                      <h2>
                        Cơ cấu loại tin nhắn{' '}
                        <span className="admin-total">
                          {msgTypeTotal.toLocaleString('vi-VN')}
                        </span>
                      </h2>
                      <p>
                        Phân bố tỷ trọng các định dạng nội dung gửi đi trong{' '}
                        {activeData.days} ngày qua.
                      </p>
                    </div>
                  </div>
                  <div className="admin-breakdown-body">
                    <div
                      className="admin-stacked-bar"
                      aria-label="Thanh tỷ trọng loại tin nhắn"
                    >
                      {msgTypeTotal > 0 ? (
                        msgTypeItems
                          .filter((item) => item.count > 0)
                          .map((item) => (
                            <span
                              key={item.key}
                              className={`tone-${item.tone}`}
                              style={{
                                width: `${Math.max(2, (item.count / msgTypeTotal) * 100)}%`,
                              }}
                              title={`${item.label}: ${item.count.toLocaleString('vi-VN')}`}
                            />
                          ))
                      ) : (
                        <span
                          className="tone-muted"
                          style={{ width: '100%' }}
                        />
                      )}
                    </div>
                    <ul className="admin-dist-list">
                      {msgTypeItems.map((item) => {
                        const pct =
                          msgTypeTotal > 0
                            ? ((item.count / msgTypeTotal) * 100).toFixed(1)
                            : '0.0';
                        return (
                          <li key={item.key}>
                            <div className="admin-dist-label">
                              <i className={`tone-${item.tone}`} />
                              <span>{item.label}</span>
                            </div>
                            <div className="admin-dist-bar">
                              <span
                                className={`tone-${item.tone}`}
                                style={{
                                  width:
                                    msgTypeTotal > 0
                                      ? `${(item.count / msgTypeTotal) * 100}%`
                                      : '0%',
                                }}
                              />
                            </div>
                            <div className="admin-dist-val">
                              <strong>
                                {item.count.toLocaleString('vi-VN')}
                              </strong>
                              <small>{pct}%</small>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </section>

                <section className="admin-panel">
                  <div className="admin-panel-heading">
                    <div>
                      <h2>Hạ tầng AI, Cuộc gọi &amp; Lưu trữ</h2>
                      <p>
                        Hiệu suất dịch vụ trợ lý AI, đàm thoại WebRTC và
                        dung lượng tệp mã hóa.
                      </p>
                    </div>
                  </div>
                  <div className="admin-ops-grid">
                    <div className="admin-ops-card">
                      <div className="admin-ops-head">
                        <Bot size={17} />
                        <span>Trợ lý AI thông minh ({activeData.days}d)</span>
                      </div>
                      <strong>
                        {aiStats.total.toLocaleString('vi-VN')} yêu cầu
                      </strong>
                      <small>
                        Chat AI: {aiStats.chat} · Tóm tắt: {aiStats.summary} ·
                        Gợi ý trả lời: {aiStats.replySuggestions}
                      </small>
                    </div>

                    <div className="admin-ops-card">
                      <div className="admin-ops-head">
                        <PhoneCall size={17} />
                        <span>Chất lượng đàm thoại ({activeData.days}d)</span>
                      </div>
                      <strong>
                        {callStats.audio} thoại · {callStats.video} video
                      </strong>
                      <small>
                        Hoàn tất: {callStats.completed} · Nhỡ/Từ chối:{' '}
                        {callStats.missedOrRejected} · AI Note:{' '}
                        {callStats.aiSummaries}
                      </small>
                    </div>

                    <div className="admin-ops-card">
                      <div className="admin-ops-head">
                        <HardDrive size={17} />
                        <span>Lưu trữ Media mã hóa AES-256</span>
                      </div>
                      <strong>
                        {formatBytes(activeData.totals.uploadBytesTotal)}
                      </strong>
                      <small>
                        {activeData.totals.uploadFilesTotal.toLocaleString(
                          'vi-VN',
                        )}{' '}
                        tệp đính kèm ·{' '}
                        {activeData.totals.recalledMessagesPeriod ?? 0} tin thu
                        hồi
                      </small>
                    </div>

                    <div className="admin-ops-card">
                      <div className="admin-ops-head">
                        <Users size={17} />
                        <span>Mức độ gắn kết người dùng</span>
                      </div>
                      <strong>
                        {activeData.users.active24h ?? 0} DAU /{' '}
                        {activeData.users.active7d ?? 0} WAU
                      </strong>
                      <small>
                        Đăng ký mới kỳ này: {activeData.users.newPeriod ?? 0}{' '}
                        tài khoản · {activeData.users.admins} Admin
                      </small>
                    </div>
                  </div>
                </section>
              </div>
            </>
          )}

          {section === 'users' && isAdmin && (
            <AdminUsers
              currentUserId={user?.id}
              focusUserId={focusUserId}
              onFocusHandled={handleClearFocusUser}
              onAuditChanged={() => void loadDashboard(period)}
            />
          )}

          {section === 'overview' && isAdmin && (
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>
                    Tài khoản trong hệ thống{' '}
                    <span className="admin-total">
                      {dashboard?.users.total ?? recentRealUsers.length}
                    </span>
                  </h2>
                  <p>
                    Danh sách thành viên tiêu biểu và lối tắt truy cập hồ sơ chi
                    tiết.
                  </p>
                </div>
                <div className="admin-heading-actions">
                  <button
                    type="button"
                    className="admin-button"
                    disabled={dashboardLoading}
                    onClick={() => void exportOverviewUsers()}
                  >
                    <ArrowDownToLine size={15} />
                    Xuất DS người dùng CSV
                  </button>
                  <button
                    type="button"
                    className="admin-text-button"
                    onClick={() => navigate('users')}
                  >
                    Quản lý tất cả
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">NGƯỜI DÙNG</th>
                      <th scope="col">VAI TRÒ</th>
                      <th scope="col">TRẠNG THÁI</th>
                      <th scope="col">HOẠT ĐỘNG CUỐI</th>
                      <th scope="col">THAO TÁC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRealUsers.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div className="admin-person">
                            <span
                              className={`admin-avatar ${avatarTone(u.id)}`}
                            >
                              {u.displayName.slice(0, 1).toUpperCase()}
                            </span>
                            <div>
                              <strong>
                                {u.displayName}
                                {user?.id === u.id && (
                                  <span className="admin-self-tag">Bạn</span>
                                )}
                              </strong>
                              <small>{u.email}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`admin-role-pill ${u.role === 'admin' ? 'is-admin' : ''}`}
                          >
                            {u.role === 'admin'
                              ? 'Quản trị viên'
                              : 'Thành viên'}
                          </span>
                        </td>
                        <td>
                          <span className={`admin-status ${u.status}`}>
                            <i />
                            {u.status === 'active'
                              ? 'Hoạt động'
                              : u.status === 'blocked'
                                ? 'Đã khóa'
                                : 'Đã xóa mềm'}
                          </span>
                        </td>
                        <td>
                          <div>{formatDateTime(u.lastActiveAt)}</div>
                          <small>Tạo: {formatDateTime(u.createdAt)}</small>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="admin-mini-btn"
                            onClick={() => navigate('users', u.id)}
                          >
                            Hồ sơ &amp; Quản lý
                            <ChevronRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {!isAdmin && (section === 'overview' || section === 'users') && (
            <section className="admin-panel">
              <div className="admin-panel-heading">
                <div>
                  <h2>
                    {section === 'overview'
                      ? 'Thành viên gần đây'
                      : 'Danh sách người dùng'}{' '}
                    <span className="admin-total">{users.length}</span>
                  </h2>
                  <p>Những kết nối làm nên cộng đồng PingPong.</p>
                </div>
                {section === 'overview' && (
                  <button
                    className="admin-text-button"
                    onClick={() => navigate('users')}
                  >
                    Xem tất cả
                    <ArrowRight size={16} />
                  </button>
                )}
              </div>
              <div className="admin-filters">
                <label className="admin-search">
                  <Search size={18} />
                  <span className="admin-sr">Tìm người dùng</span>
                  <input
                    placeholder="Tìm tên, email hoặc mã người dùng…"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(1);
                    }}
                  />
                </label>
                <select
                  aria-label="Lọc trạng thái người dùng"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">Tất cả trạng thái</option>
                  <option value="active">Đang hoạt động</option>
                  <option value="blocked">Đã khóa</option>
                </select>
              </div>
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">NGƯỜI DÙNG</th>
                      <th scope="col">VAI TRÒ</th>
                      <th scope="col">TRẠNG THÁI</th>
                      <th scope="col">NGÀY THAM GIA</th>
                      <th scope="col">
                        <span className="admin-sr">Thao tác</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleUsers.map((u) => (
                      <tr key={u.id}>
                        <td>
                          <div className="admin-person">
                            <span className={`admin-avatar ${u.color}`}>
                              {u.name
                                .split(' ')
                                .slice(-2)
                                .map((s) => s[0])
                                .join('')}
                            </span>
                            <div>
                              <strong>{u.name}</strong>
                              <small>{u.email}</small>
                            </div>
                          </div>
                        </td>
                        <td>{u.role}</td>
                        <td>
                          <span className={`admin-status ${u.status}`}>
                            <i />
                            {u.status === 'active' ? 'Hoạt động' : 'Đã khóa'}
                          </span>
                        </td>
                        <td>{u.joined}</td>
                        <td>
                          <button
                            className="admin-text-button"
                            aria-label={`Quản lý ${u.name}`}
                            onClick={() => setSelected(u)}
                          >
                            Chi tiết
                            <ChevronRight size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filtered.length && (
                  <div className="admin-empty">
                    <Search size={25} />
                    <h3>Không tìm thấy người dùng</h3>
                    <p>Hãy thử tên khác hoặc thay đổi bộ lọc.</p>
                  </div>
                )}
              </div>
              <div className="admin-table-footer">
                <span>
                  Hiển thị{' '}
                  {filtered.length
                    ? (Math.min(page, pageCount) - 1) * pageSize + 1
                    : 0}
                  –
                  {Math.min(
                    Math.min(page, pageCount) * pageSize,
                    filtered.length,
                  )}{' '}
                  trong {filtered.length} người dùng mẫu
                </span>
                <div>
                  <button
                    aria-label="Trang trước"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <span>
                    {Math.min(page, pageCount)} / {pageCount}
                  </span>
                  <button
                    aria-label="Trang sau"
                    disabled={page >= pageCount}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            </section>
          )}

          {section === 'reports' && (
            <ReportQueue user={user} onCount={setPending} />
          )}

          {section === 'activity' &&
            (isAdmin ? (
              <AdminAuditCompliance
                onRetentionApplied={() => void loadDashboard(period)}
              />
            ) : (
              <section className="admin-panel">
                <div className="admin-panel-heading">
                  <div>
                    <h2>Lịch sử trong phiên</h2>
                    <p>Các thao tác thử nghiệm sẽ xuất hiện tại đây.</p>
                  </div>
                  <ClipboardList size={21} />
                </div>
                {!logs.length ? (
                  <div className="admin-empty">
                    <ClipboardList size={32} />
                    <h3>Chưa có hoạt động</h3>
                    <p>Thử quản lý người dùng hoặc xem xét một báo cáo.</p>
                    <button
                      className="admin-button"
                      onClick={() => navigate('users')}
                    >
                      Đến quản lý người dùng
                      <ArrowRight size={16} />
                    </button>
                  </div>
                ) : (
                  <ol className="admin-log">
                    {logs.map((log, i) => (
                      <li key={i}>
                        <span>
                          <Check size={16} />
                        </span>
                        <div>
                          <strong>{log.text}</strong>
                          <small>Thao tác trên dữ liệu mẫu</small>
                        </div>
                        <time>{log.time}</time>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ))}

          <footer className="admin-footer">
            <span>PingPong Admin · Hệ thống Thống kê &amp; Tuân thủ</span>
            <span>Dữ liệu trực tiếp · Xuất báo cáo CSV / JSON / PDF</span>
          </footer>
        </main>
      </div>
      <div className="admin-toast" role="status">
        {notice && (
          <span>
            <Check size={18} />
            {notice}
          </span>
        )}
      </div>
      <dialog
        ref={dialog}
        className="admin-dialog"
        onCancel={() => setSelected(null)}
        onClose={() => setSelected(null)}
      >
        {selected && (
          <>
            <div className="admin-panel-heading">
              <h2>Chi tiết người dùng</h2>
              <button
                className="admin-close"
                aria-label="Đóng chi tiết"
                onClick={() => setSelected(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="admin-dialog-body">
              <div className="admin-person">
                <span className={`admin-avatar ${selected.color}`}>
                  {selected.name.slice(0, 1)}
                </span>
                <div>
                  <strong>{selected.name}</strong>
                  <small>{selected.email}</small>
                </div>
              </div>
              <dl>
                <dt>Mã tài khoản</dt>
                <dd>{selected.id}</dd>
                <dt>Vai trò</dt>
                <dd>{selected.role}</dd>
                <dt>Tham gia</dt>
                <dd>{selected.joined}</dd>
                <dt>Trạng thái</dt>
                <dd>
                  {selected.status === 'active' ? 'Hoạt động' : 'Đã khóa'}
                </dd>
              </dl>
              <p>Thao tác dưới đây chỉ thay đổi dữ liệu mẫu trong phiên này.</p>
              <button
                className={`admin-button ${selected.status === 'active' ? 'danger' : 'primary'}`}
                onClick={() => {
                  setUsers((old) =>
                    old.map((u) =>
                      u.id === selected.id
                        ? {
                            ...u,
                            status:
                              u.status === 'active' ? 'blocked' : 'active',
                          }
                        : u,
                    ),
                  );
                  record(
                    `${selected.status === 'active' ? 'Đã khóa' : 'Đã mở khóa'} tài khoản ${selected.name}`,
                  );
                  setSelected(null);
                }}
              >
                {selected.status === 'active'
                  ? 'Xác nhận khóa tài khoản mẫu'
                  : 'Mở khóa tài khoản mẫu'}
              </button>
            </div>
          </>
        )}
      </dialog>
    </div>
  );
}
