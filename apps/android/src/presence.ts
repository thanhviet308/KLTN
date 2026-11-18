import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { io } from 'socket.io-client';
import * as api from './api';

export type Peer = {
  id: string;
  displayName: string;
  avatarUrl?: string | null;
  friendshipStatus?: 'none' | 'friends' | 'incoming' | 'outgoing';
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
    let connecting = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const client = io(`${api.API_ORIGIN}/chat`, {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
    });
    const scheduleReconnect = (delayMs: number, forceRefresh = false) => {
      if (stopped || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void connect(forceRefresh);
      }, delayMs);
    };
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
    async function connect(forceRefresh = false) {
      if (stopped || connecting || (client.connected && !forceRefresh)) return;
      connecting = true;
      try {
        if (forceRefresh) await api.refresh();
        const token = await api.accessToken();
        if (stopped) return;
        client.auth = { accessToken: token };
        if (!client.connected) client.connect();
      } catch (next) {
        if (next instanceof api.ApiError && next.status === 401) onExpired();
        else scheduleReconnect(3000, false);
      } finally {
        connecting = false;
      }
    }
    client.on('connect', () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      sync();
    });
    client.on(
      'presence:update',
      (event?: {
        userId?: string;
        online?: boolean;
        lastActiveAt?: string | null;
      }) => {
        if (
          stopped ||
          !event ||
          typeof event.userId !== 'string' ||
          typeof event.online !== 'boolean'
        )
          return;
        const peerId = event.userId;
        const isOnline = event.online;
        setPresence(prev => ({
          ...prev,
          [peerId]: {
            online: isOnline,
            lastActiveAt:
              event.lastActiveAt !== undefined
                ? event.lastActiveAt
                : (prev[peerId]?.lastActiveAt ?? null),
          },
        }));
      },
    );
    client.on(
      'friends:updated',
      (event?: { peerId?: string; status?: 'accepted' | 'removed' }) => {
        if (stopped) return;
        if (event?.status === 'removed' && typeof event.peerId === 'string') {
          const removedId = event.peerId;
          setPresence(prev => {
            if (!(removedId in prev)) return prev;
            const next = { ...prev };
            delete next[removedId];
            return next;
          });
          return;
        }
        sync();
      },
    );
    client.on('disconnect', (reason?: string) => {
      syncing = false;
      setPresence({});
      if (reason !== 'io client disconnect') scheduleReconnect(1500, false);
    });
    client.on('connect_error', (failure?: unknown) => {
      syncing = false;
      setPresence({});
      const message =
        failure instanceof Error ? failure.message.toUpperCase() : '';
      const authFailed =
        message.includes('AUTH') ||
        message.includes('401') ||
        message.includes('TOKEN') ||
        message.includes('SESSION');
      scheduleReconnect(1500, authFailed);
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      if (client.connected) sync();
      else void connect();
    });
    void connect();
    const timer = setInterval(() => {
      if (client.connected) sync();
      else if (!retryTimer) void connect();
    }, 15000);
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(timer);
      subscription.remove();
      client.removeAllListeners();
      client.disconnect();
    };
  }, [onExpired, userId]);
  return presence;
}
