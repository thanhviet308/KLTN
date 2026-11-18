import { useEffect, useState } from 'react';
import { acquireChatSocket } from '../lib/realtime';

export interface Presence {
  online: boolean;
  lastActiveAt: string | null;
}
export function presenceBadge(state?: Presence, now = Date.now()) {
  if (!state || state.online || !state.lastActiveAt) return '';
  const timestamp = Date.parse(state.lastActiveAt);
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return '1 phút';
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
    let syncing = false;
    const hub = acquireChatSocket(userId);
    const client = hub.socket;
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
    const onPresenceUpdate = (event?: {
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
      setPresence((prev) => ({
        ...prev,
        [peerId]: {
          online: isOnline,
          lastActiveAt:
            event.lastActiveAt !== undefined
              ? event.lastActiveAt
              : (prev[peerId]?.lastActiveAt ?? null),
        },
      }));
    };
    const onFriendsUpdated = (event?: {
      peerId?: string;
      status?: 'accepted' | 'removed';
    }) => {
      if (stopped) return;
      if (event?.status === 'removed' && typeof event.peerId === 'string') {
        const removedId = event.peerId;
        setPresence((prev) => {
          if (!(removedId in prev)) return prev;
          const next = { ...prev };
          delete next[removedId];
          return next;
        });
        return;
      }
      sync();
    };
    const onDisconnect = () => {
      syncing = false;
      setPresence({});
    };
    const onConnectError = () => {
      syncing = false;
      setPresence({});
    };
    client.on('connect', sync);
    client.on('presence:update', onPresenceUpdate);
    client.on('friends:updated', onFriendsUpdated);
    client.on('disconnect', onDisconnect);
    client.on('connect_error', onConnectError);
    if (client.connected) sync();
    const refreshPresence = () => {
      if (client.connected) sync();
      else hub.reconnectNow();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshPresence();
    };
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', refreshPresence);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => {
      if (client.connected) sync();
    }, 15000);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', refreshPresence);
      document.removeEventListener('visibilitychange', onVisible);
      client.off('connect', sync);
      client.off('presence:update', onPresenceUpdate);
      client.off('friends:updated', onFriendsUpdated);
      client.off('disconnect', onDisconnect);
      client.off('connect_error', onConnectError);
      hub.release();
    };
  }, [userId]);
  return presence;
}
