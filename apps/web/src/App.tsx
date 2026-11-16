import { lazy, Suspense, useEffect, useState } from 'react';
import * as api from './lib/api';
import { resolveWorkspaceViewportAction } from './lib/viewport';
import { AuthPage } from './features/auth/AuthPage';

// Preload Home alongside session restore so signed-in sessions render immediately.
const loadHome = () =>
  import('./features/home/Home').then((m) => ({ default: m.Home }));
const Home = lazy(loadHome);
const Admin = lazy(() =>
  import('./features/admin/Admin').then((m) => ({ default: m.Admin })),
);

const SESSION_EXPIRED = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
const RENEW_INTERVAL_MS = 60_000;

export function App() {
  const [user, setUser] = useState<api.User>();
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [adminOpen, setAdminOpen] = useState(location.pathname === '/admin');
  const adminPreview = location.pathname === '/admin/preview';

  useEffect(() => {
    const syncRoute = () => setAdminOpen(location.pathname === '/admin');
    window.addEventListener('popstate', syncRoute);
    return () => window.removeEventListener('popstate', syncRoute);
  }, []);

  const isWorkspaceShell =
    Boolean(user) && !adminPreview && !(user?.role === 'admin' && adminOpen);

  // Sync --app-h only for the fixed-height mobile workspace shell; auth and admin pages scroll naturally.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !isWorkspaceShell) {
      document.documentElement.style.removeProperty('--app-h');
      return;
    }
    const syncViewport = () => {
      const action = resolveWorkspaceViewportAction({
        isWorkspaceShell,
        innerWidth: window.innerWidth,
        visualHeight: vv.height,
        offsetTop: vv.offsetTop,
      });
      if (action.mode === 'clear') {
        document.documentElement.style.removeProperty('--app-h');
        return;
      }
      const nextHeight = `${action.heightPx}px`;
      if (
        document.documentElement.style.getPropertyValue('--app-h') !==
        nextHeight
      ) {
        document.documentElement.style.setProperty('--app-h', nextHeight);
      }
      if (action.resetWindowScroll) window.scrollTo(0, 0);
    };
    syncViewport();
    vv.addEventListener('resize', syncViewport);
    vv.addEventListener('scroll', syncViewport);
    window.addEventListener('resize', syncViewport);
    return () => {
      vv.removeEventListener('resize', syncViewport);
      vv.removeEventListener('scroll', syncViewport);
      window.removeEventListener('resize', syncViewport);
      document.documentElement.style.removeProperty('--app-h');
    };
  }, [isWorkspaceShell]);

  useEffect(() => {
    async function restore() {
      if (adminPreview) {
        setBooting(false);
        return;
      }
      if (!adminOpen) void loadHome().catch(() => {});
      try {
        setUser((await api.refresh()).user);
      } catch (e) {
        if (!(e instanceof api.ApiError) || e.status !== 401)
          setError(api.errorMessage(e));
      } finally {
        setBooting(false);
      }
    }
    void restore();
  }, []);

  // Keep the profile fresh and detect an expired session while signed in.
  useEffect(() => {
    if (!user) return;
    let active = true;
    async function renew() {
      try {
        const profile = await api.me();
        if (active) {
          setUser(profile);
          setError('');
        }
      } catch (e) {
        if (!active) return;
        if (e instanceof api.ApiError && e.status === 401) {
          setUser(undefined);
          setNotice(SESSION_EXPIRED);
        } else setError(api.errorMessage(e));
      }
    }
    const interval = window.setInterval(() => {
      void renew();
    }, RENEW_INTERVAL_MS);
    const onFocus = () => {
      void renew();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [user?.id]);

  if (adminPreview || (user?.role === 'admin' && adminOpen))
    return (
      <Suspense fallback={<p role="status">Đang tải trang quản trị…</p>}>
        <Admin
          user={user}
          onBack={() => {
            if (adminPreview) location.assign('/');
            else {
              history.replaceState(null, '', '/');
              setAdminOpen(false);
            }
          }}
        />
      </Suspense>
    );

  if (user)
    return (
      <Suspense fallback={null}>
        <Home
          user={user}
          onAdmin={
            user.role === 'admin'
              ? () => {
                  history.pushState(null, '', '/admin');
                  setAdminOpen(true);
                }
              : undefined
          }
          onUser={setUser}
          onLogout={async () => {
            await api.logout();
            setUser(undefined);
            setError('');
            setNotice('Bạn đã đăng xuất an toàn.');
          }}
          onExpired={() => {
            api.clearSession();
            setUser(undefined);
            setError('');
            setNotice(SESSION_EXPIRED);
          }}
        />
      </Suspense>
    );

  return (
    <AuthPage
      // Remount once the session restore settles so a restore error is shown.
      key={booting ? 'booting' : 'ready'}
      booting={booting}
      initialError={error}
      initialNotice={notice}
      onAuthenticated={setUser}
    />
  );
}
