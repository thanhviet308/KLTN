import { lazy, Suspense, useEffect, useState } from 'react';
import * as api from './lib/api';
import { AuthPage } from './features/auth/AuthPage';

// Loaded only after sign-in so the login page ships a much smaller bundle.
const Home = lazy(() =>
  import('./features/home/Home').then((m) => ({ default: m.Home })),
);

const SESSION_EXPIRED = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
const RENEW_INTERVAL_MS = 60_000;

export function App() {
  const [user, setUser] = useState<api.User>();
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    async function restore() {
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

  if (user)
    return (
      <Suspense fallback={null}>
        <Home
          user={user}
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
