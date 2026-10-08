import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import * as api from './api';

export interface Presence {
  online: boolean;
  lastActiveAt: string | null;
}
export function presenceBadge(state?: Presence, now = Date.now()) {
  if (!state || state.online || !state.lastActiveAt) return '';
  const timestamp = Date.parse(state.lastActiveAt);
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ`;
  return `${Math.floor(hours / 24)} ngày`;
}
export function presenceLabel(state?: Presence, now = Date.now()) {
  if (!state) return 'Chưa xác định trạng thái';
  if (state.online) return 'Đang hoạt động';
  const timestamp = state.lastActiveAt ? Date.parse(state.lastActiveAt) : NaN;
  if (!Number.isFinite(timestamp)) return 'Hiện không hoạt động';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return 'Vừa hoạt động';
  if (minutes < 60) return `Hoạt động ${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Hoạt động ${hours} giờ trước`;
  return `Hoạt động ${Math.floor(hours / 24)} ngày trước`;
}

export function usePresence(userId: string) {
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  useEffect(() => {
    let stopped = false;
    let refreshing = false;
    let currentToken = '';
    let syncing = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const client = io(`${api.API_ORIGIN}/chat`, {
      transports: ['websocket'],
      autoConnect: false,
      auth: (done) => {
        void api.accessToken().then(
          (accessToken) => {
            if (!stopped) {
              currentToken = accessToken;
              done({ accessToken });
            }
          },
          () => {
            if (!stopped) done({});
          },
        );
      },
    });
    const sync = () => {
      if (!client.connected || syncing) return;
      syncing = true;
      client.timeout(5000).emit(
        'presence:sync',
        {},
        (
          error: Error | null,
          result?: {
            ok: boolean;
            data?: Record<string, Presence>;
          },
        ) => {
          syncing = false;
          if (stopped || !client.connected) return;
          // A failed ACK does not prove that friends went offline.
          // Disconnect clears the snapshot; successful sync replaces it.
          if (!error && result?.ok) setPresence(result.data ?? {});
        },
      );
    };
    client.on('connect', sync);
    client.on('disconnect', (reason) => {
      syncing = false;
      setPresence({});
      if (!stopped && reason === 'io server disconnect') {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(() => {
          if (!stopped) client.connect();
        }, 1000);
      }
    });
    client.on('connect_error', () => setPresence({}));
    client.connect();
    const refreshPresence = () => {
      if (refreshing) return;
      refreshing = true;
      void api
        .accessToken()
        .then((accessToken) => {
          if (stopped) return;
          if (client.connected && currentToken !== accessToken) {
            // Socket.IO's auth callback obtains a fresh token on every handshake.
            client.disconnect();
            client.connect();
          } else if (!client.connected) client.connect();
          else sync();
        })
        .catch(() => {
          if (!stopped) setPresence({});
        })
        .finally(() => {
          refreshing = false;
        });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshPresence();
    };
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', refreshPresence);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(refreshPresence, 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
      clearTimeout(reconnectTimer);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', refreshPresence);
      document.removeEventListener('visibilitychange', onVisible);
      client.removeAllListeners();
      client.disconnect();
    };
  }, [userId]);
  return presence;
}
