import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import * as api from './api';

export type Peer = {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
};
export type PersonRow = { id: string; user: Peer };
export type Presence = { online: boolean; lastActiveAt: string | null };

export async function allPages<T>(path: string) {
  const items: T[] = [];
  let cursor: string | null = null;
  do {
    const separator = path.includes('?') ? '&' : '?';
    const page: api.Page<T> = await api.authenticated(
      `${path}${separator}limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

export function presenceLabel(state?: Presence) {
  if (!state) return 'Chưa xác định trạng thái';
  if (state.online) return 'Đang hoạt động';
  const timestamp = state.lastActiveAt ? Date.parse(state.lastActiveAt) : NaN;
  if (!Number.isFinite(timestamp)) return 'Hiện không hoạt động';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'Vừa hoạt động';
  if (minutes < 60) return `Hoạt động ${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hoạt động ${hours} giờ trước`;
  return `Hoạt động ${Math.floor(hours / 24)} ngày trước`;
}

export function usePresence(userId: string, onExpired: () => void) {
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  useEffect(() => {
    let stopped = false;
    let syncing = false;
    const client = io(`${api.API_ORIGIN}/chat`, {
      transports: ['websocket'],
      autoConnect: false,
    });
    const sync = () => {
      if (!client.connected || syncing) return;
      syncing = true;
      client
        .timeout(5000)
        .emit(
          'presence:sync',
          {},
          (
            problem: Error | null,
            result?: { ok: boolean; data?: Record<string, Presence> },
          ) => {
            syncing = false;
            if (!stopped && !problem && result?.ok)
              setPresence(result.data ?? {});
          },
        );
    };
    async function connect() {
      try {
        client.auth = { accessToken: await api.accessToken() };
        if (!stopped) client.connect();
      } catch (next) {
        if (next instanceof api.ApiError && next.status === 401) onExpired();
      }
    }
    client.on('connect', sync);
    client.on('disconnect', () => {
      syncing = false;
      setPresence({});
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      if (client.connected) sync();
      else void connect();
    });
    void connect();
    const timer = setInterval(() => {
      if (client.connected) sync();
      else void connect();
    }, 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
      subscription.remove();
      client.removeAllListeners();
      client.disconnect();
    };
  }, [onExpired, userId]);
  return presence;
}
