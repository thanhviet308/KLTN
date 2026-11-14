import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Flag,
  LayoutDashboard,
  MessageCircle,
  PhoneCall,
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
  formatBytes,
  formatDateTime,
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
type SeriesMetric = 'newUsers' | 'messages' | 'calls' | 'games';

const metricLabels: Record<SeriesMetric, string> = {
  newUsers: 'Đăng ký mới',
  messages: 'Tin nhắn',
  calls: 'Cuộc gọi',
  games: 'Phiên trò chơi',
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

  const [dashboard, setDashboard] = useState<AdminDashboardData | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [recentRealUsers, setRecentRealUsers] = useState<AdminUserAccount[]>(
    [],
  );

  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const loadDashboard = useCallback(
    async (days = period) => {
      if (!isAdmin) return;
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
        setDashboard(dash);
        setPending(dash.totals.pendingReports);
        setRecentRealUsers(recent.items);
      } catch (e) {
        setDashboardError(api.errorMessage(e));
      } finally {
        setDashboardLoading(false);
      }
    },
    [isAdmin, period],
  );

  useEffect(() => {
    void loadDashboard(period);
  }, [loadDashboard, period]);

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

  function navigate(id: AdminSection) {
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

  async function exportOverviewUsers() {
    if (isAdmin) {
      setDashboardLoading(true);
      try {
        const res = await api.authenticated<{ items: AdminUserAccount[] }>(
          '/admin/users?limit=50',
        );
        const csv =
          '\uFEFF' +
          [
            [
              'ID',
              'Tên hiển thị',
              'Email',
              'Vai trò',
              'Trạng thái',
              'Ngày tạo',
            ],
            ...res.items.map((u) => [
              u.id,
              u.displayName,
              u.email,
              u.role,
              u.status,
              u.createdAt,
            ]),
          ]
            .map((row) =>
              row.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(','),
            )
            .join('\r\n');
        const url = URL.createObjectURL(
          new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = 'pingpong-users.csv';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNotice(`Đã xuất ${res.items.length} người dùng ra CSV.`);
      } catch (e) {
        setDashboardError(api.errorMessage(e));
      } finally {
        setDashboardLoading(false);
      }
      return;
    }

    const csv =
      '\uFEFF' +
      [
        ['Mã', 'Họ tên', 'Email', 'Vai trò', 'Trạng thái'],
        ...filtered.map((u) => [
          u.id,
          u.name,
          u.email,
          u.role,
          u.status === 'active' ? 'Hoạt động' : 'Đã khóa',
        ]),
      ]
        .map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(','))
        .join('\r\n');
    const url = URL.createObjectURL(
      new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'pingpong-nguoi-dung-mau.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    record('Đã xuất danh sách người dùng mẫu');
  }

  const realSeries = dashboard?.series ?? [];
  const realValues = realSeries.map((point) => point[seriesMetric]);
  const realMax = Math.max(1, ...realValues);
  const periodSum = realValues.reduce((sum, n) => sum + n, 0);

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
            <small>Quản lý hệ thống</small>
          </div>
          <span className="admin-space-dot" />
        </div>
        <p className="admin-nav-label">KHÔNG GIAN LÀM VIỆC</p>
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
            <strong>Một cộng đồng tốt đẹp</strong>
            <p>Bắt đầu từ những cuộc trò chuyện an toàn và tử tế.</p>
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
              {isAdmin ? 'Hệ thống trực tiếp' : 'Bản xem thử'}
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
            <div className="admin-heading-actions">
              {isAdmin && section === 'overview' && (
                <button
                  type="button"
                  className="admin-button"
                  disabled={dashboardLoading}
                  onClick={() => void loadDashboard(period)}
                >
                  Làm mới số liệu
                </button>
              )}
              <button
                type="button"
                className="admin-button primary"
                disabled={dashboardLoading}
                onClick={() => void exportOverviewUsers()}
              >
                <ArrowDownToLine size={17} />
                Xuất danh sách CSV
              </button>
            </div>
          </div>
          <div className="admin-demo-note">
            <ShieldCheck size={17} />
            <span>
              {isAdmin
                ? 'Đang kết nối dữ liệu quản trị hệ thống trực tiếp từ PostgreSQL.'
                : 'Đang hiển thị dữ liệu mẫu. Thay đổi chỉ áp dụng trong phiên xem thử.'}
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
                {(isAdmin && dashboard
                  ? [
                      {
                        title: 'Người dùng hệ thống',
                        value: dashboard.users.total.toLocaleString('vi-VN'),
                        change: `${dashboard.users.active} active`,
                        icon: Users,
                        foot: `· ${dashboard.users.blocked} khóa · ${dashboard.users.deleted} xóa · ${dashboard.users.admins} admin`,
                        color: 'peach',
                        warn: false,
                      },
                      {
                        title: 'Tin nhắn & Nhóm',
                        value:
                          dashboard.totals.messagesToday.toLocaleString(
                            'vi-VN',
                          ),
                        change: `${dashboard.totals.messagesPeriod.toLocaleString('vi-VN')} / ${dashboard.days}d`,
                        icon: MessageCircle,
                        foot: `· ${dashboard.totals.groupsTotal} nhóm chat`,
                        color: 'sage',
                        warn: false,
                      },
                      {
                        title: 'Cuộc gọi & Trò chơi',
                        value: `${dashboard.totals.callsPeriod} / ${dashboard.totals.gamesPeriod}`,
                        change: `${dashboard.totals.uploadFilesTotal} tệp`,
                        icon: PhoneCall,
                        foot: `(${formatBytes(dashboard.totals.uploadBytesTotal)})`,
                        color: 'lilac',
                        warn: false,
                      },
                      {
                        title: 'Báo cáo chờ xử lý',
                        value: String(dashboard.totals.pendingReports).padStart(
                          2,
                          '0',
                        ),
                        change: 'Cần xem xét',
                        icon: Flag,
                        foot: 'giữ cộng đồng an toàn',
                        color: 'sand',
                        warn: true,
                      },
                    ]
                  : [
                      {
                        title: 'Tổng người dùng',
                        value: '2.846',
                        change: '+12,8%',
                        icon: Users,
                        foot: 'so với kỳ trước',
                        color: 'peach',
                        warn: false,
                      },
                      {
                        title: 'Tin nhắn hôm nay',
                        value: '18.294',
                        change: '+8,2%',
                        icon: MessageCircle,
                        foot: 'so với hôm trước',
                        color: 'sage',
                        warn: false,
                      },
                      {
                        title: 'Nhóm trò chuyện',
                        value: '326',
                        change: '+6,4%',
                        icon: LayoutDashboard,
                        foot: 'so với kỳ trước',
                        color: 'lilac',
                        warn: false,
                      },
                      {
                        title: 'Báo cáo chờ xử lý',
                        value: String(pending).padStart(2, '0'),
                        change: 'Cần xem xét',
                        icon: Flag,
                        foot: 'giữ cộng đồng an toàn',
                        color: 'sand',
                        warn: true,
                      },
                    ]
                ).map((m) => (
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
                      <span
                        className={m.warn ? 'admin-warning' : 'admin-positive'}
                      >
                        {!m.warn && <ArrowUpRight size={13} />}
                        {m.change}
                      </span>{' '}
                      {m.foot}
                    </p>
                  </article>
                ))}
              </div>
              <div className="admin-insights">
                <section className="admin-panel admin-chart">
                  <div className="admin-panel-heading">
                    <div>
                      <h2>Nhịp sống hệ thống</h2>
                      <p>
                        {isAdmin
                          ? `${metricLabels[seriesMetric]} theo ngày · ${period} ngày qua (dữ liệu thật)`
                          : 'Lượt người dùng hoạt động mỗi ngày · dữ liệu mẫu'}
                      </p>
                    </div>
                    <div className="admin-chart-controls">
                      {isAdmin && (
                        <select
                          aria-label="Chỉ số biểu đồ"
                          value={seriesMetric}
                          onChange={(e) =>
                            setSeriesMetric(e.target.value as SeriesMetric)
                          }
                        >
                          <option value="newUsers">Đăng ký mới</option>
                          <option value="messages">Tin nhắn</option>
                          <option value="calls">Cuộc gọi</option>
                          <option value="games">Phiên trò chơi</option>
                        </select>
                      )}
                      <select
                        aria-label="Khoảng thời gian biểu đồ"
                        value={period}
                        onChange={(e) => setPeriod(e.target.value)}
                      >
                        <option value="7">7 ngày qua</option>
                        <option value="14">14 ngày qua</option>
                        {isAdmin && <option value="30">30 ngày qua</option>}
                      </select>
                    </div>
                  </div>
                  <div className="admin-chart-key">
                    <span />
                    {isAdmin
                      ? `${metricLabels[seriesMetric]} (${periodSum.toLocaleString('vi-VN')} trong ${period} ngày)`
                      : 'Người dùng hoạt động'}
                  </div>
                  <div className="admin-plot">
                    {isAdmin ? (
                      <>
                        <div className="admin-y-axis">
                          <span>{realMax}</span>
                          <span>{Math.ceil((realMax * 2) / 3)}</span>
                          <span>{Math.ceil(realMax / 3)}</span>
                          <span>0</span>
                        </div>
                        <div className="admin-bars">
                          {realSeries.map((point, i) => {
                            const val = point[seriesMetric];
                            const pct =
                              realMax > 0
                                ? Math.max(
                                    val > 0 ? 8 : 3,
                                    (val / realMax) * 100,
                                  )
                                : 3;
                            return (
                              <div
                                className="admin-bar-column"
                                key={point.date}
                              >
                                <button
                                  type="button"
                                  className={
                                    i === realSeries.length - 1
                                      ? 'admin-bar latest'
                                      : 'admin-bar'
                                  }
                                  style={{ height: `${pct}%` }}
                                  aria-label={`Ngày ${formatShortIsoDate(point.date)}: ${val} ${metricLabels[seriesMetric]}`}
                                  title={`${point.date}: ${val} ${metricLabels[seriesMetric]}`}
                                >
                                  <span>{val}</span>
                                </button>
                                {(realSeries.length <= 15 ||
                                  i % 3 === 0 ||
                                  i === realSeries.length - 1) && (
                                  <small>
                                    {formatShortIsoDate(point.date)}
                                  </small>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="admin-y-axis">
                          <span>1.500</span>
                          <span>1.000</span>
                          <span>500</span>
                          <span>0</span>
                        </div>
                        <div className="admin-bars">
                          {demoSeries.slice(-Number(period)).map((value, i) => (
                            <div className="admin-bar-column" key={i}>
                              <button
                                className={
                                  i === Number(period) - 1
                                    ? 'admin-bar latest'
                                    : 'admin-bar'
                                }
                                style={{ height: `${value / 1.4}%` }}
                                aria-label={`Ngày ${chartDate(i, period)}: ${value * 10} người hoạt động`}
                                title={`${value * 10} người hoạt động`}
                              >
                                <span>{value * 10}</span>
                              </button>
                              <small>{chartDate(i, period)}</small>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="admin-chart-footer">
                    <span>
                      <span className="admin-positive">
                        {isAdmin
                          ? `Σ ${periodSum.toLocaleString('vi-VN')}`
                          : '↗ 12,8%'}
                      </span>{' '}
                      {isAdmin
                        ? `${metricLabels[seriesMetric]} trong ${period} ngày qua`
                        : 'tăng trưởng trong kỳ'}
                    </span>
                    <span>
                      {isAdmin
                        ? 'PostgreSQL Realtime Aggregate'
                        : 'Ví dụ minh họa'}
                    </span>
                  </div>
                </section>
                <section className="admin-panel admin-safety">
                  <span className="admin-safety-icon">
                    <ShieldCheck size={27} />
                  </span>
                  <p className="admin-eyebrow">AN TOÀN CỘNG ĐỒNG</p>
                  <h2>
                    Mỗi báo cáo đều
                    <br />
                    đáng được lắng nghe.
                  </h2>
                  <p>Cùng giữ PingPong là nơi mọi người an tâm kết nối.</p>
                  <div className="admin-pending">
                    <strong>{String(pending).padStart(2, '0')}</strong>
                    <span>
                      báo cáo đang chờ
                      <br />
                      bạn xem xét
                    </span>
                  </div>
                  <button
                    className="admin-button primary"
                    onClick={() => navigate('reports')}
                  >
                    Xem báo cáo
                    <ArrowRight size={17} />
                  </button>
                </section>
              </div>
            </>
          )}

          {section === 'users' && isAdmin && (
            <AdminUsers
              currentUserId={user?.id}
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
                    Xem nhanh danh sách và truy cập đầy đủ công cụ quản trị.
                  </p>
                </div>
                <button
                  className="admin-text-button"
                  onClick={() => navigate('users')}
                >
                  Quản lý tất cả
                  <ArrowRight size={16} />
                </button>
              </div>
              <div className="admin-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">NGƯỜI DÙNG</th>
                      <th scope="col">VAI TRÒ</th>
                      <th scope="col">TRẠNG THÁI</th>
                      <th scope="col">NGÀY TẠO</th>
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
                        <td>{formatDateTime(u.createdAt)}</td>
                        <td>
                          <button
                            type="button"
                            className="admin-mini-btn"
                            onClick={() => navigate('users')}
                          >
                            Quản lý
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
            <span>PingPong Admin</span>
            <span>Kết nối gần hơn. Quản lý dễ hơn.</span>
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
