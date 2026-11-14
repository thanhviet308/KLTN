import { useEffect, useState } from 'react';
import * as api from '../../lib/api';
import '../workspace/workspace.css';
type Account = {
  id: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
};
export function AdminUsers() {
  const [items, setItems] = useState<Account[]>([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Account>();
  async function load(next?: string) {
    setBusy(true);
    setError('');
    try {
      const result = await api.authenticated<{
        items: Account[];
        nextCursor: string | null;
      }>(
        `/admin/users?limit=30&query=${encodeURIComponent(query)}${next ? `&cursor=${next}` : ''}`,
      );
      setItems((old) => (next ? [...old, ...result.items] : result.items));
      setCursor(result.nextCursor);
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function change(account: Account) {
    setBusy(true);
    setError('');
    try {
      await api.authenticated(
        `/admin/users/${account.id}/status`,
        { status: account.status === 'blocked' ? 'active' : 'blocked' },
        'PATCH',
      );
      setConfirm(undefined);
      await load();
    } catch (e) {
      setError(api.errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="workspace-admin" aria-label="Quản lý tài khoản">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label>
          Tìm tên hoặc email
          <input
            value={query}
            maxLength={100}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button disabled={busy}>Tìm kiếm</button>
      </form>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">Đang cập nhật…</p>}
      {confirm && (
        <div className="workspace-card" role="alert">
          <p>
            {confirm.status === 'blocked'
              ? 'Mở lại tài khoản'
              : 'Chặn tài khoản và đăng xuất mọi phiên của'}{' '}
            <strong>{confirm.displayName}</strong>?
          </p>
          <button disabled={busy} onClick={() => void change(confirm)}>
            Xác nhận
          </button>
          <button disabled={busy} onClick={() => setConfirm(undefined)}>
            Hủy
          </button>
        </div>
      )}
      {items.map((u) => (
        <article className="workspace-card" key={u.id}>
          <strong>{u.displayName}</strong>
          <p>{u.email}</p>
          <p>
            {u.role === 'admin' ? 'Quản trị viên' : 'Thành viên'} ·{' '}
            {u.status === 'active'
              ? 'Hoạt động'
              : u.status === 'blocked'
                ? 'Bị chặn'
                : 'Đã xóa'}
          </p>
          <button
            disabled={busy || u.role === 'admin' || u.status === 'deleted'}
            onClick={() => setConfirm(u)}
          >
            {u.status === 'blocked' ? 'Mở chặn' : 'Chặn tài khoản'}
          </button>
        </article>
      ))}
      {cursor && (
        <button disabled={busy} onClick={() => void load(cursor)}>
          Xem thêm
        </button>
      )}
    </section>
  );
}
