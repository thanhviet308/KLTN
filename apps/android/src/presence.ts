import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as api from './api';
import { acquireChatSocket } from './realtime';

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

export function usePresence(userId: string, onExpired: () => void) {
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  useEffect(() => {
    let stopped = false;
    let syncing = false;
    const socket = acquireChatSocket(onExpired);
    const sync = () => {
      if (!socket.isConnected() || syncing) return;
      syncing = true;
      socket.emitWithTimeout(
        5000,
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
    const offConnect = socket.on('connect', () => {
      sync();
    });
    const offUpdate = socket.on(
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
    const offFriends = socket.on(
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
    const offDisconnect = socket.on('disconnect', () => {
      syncing = false;
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      if (socket.isConnected()) sync();
      else void socket.connect();
    });
    if (socket.isConnected()) sync();
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      if (socket.isConnected()) sync();
      else void socket.connect();
    }, 30000);
    return () => {
      stopped = true;
      clearInterval(timer);
      subscription.remove();
      offConnect();
      offUpdate();
      offFriends();
      offDisconnect();
      socket.release();
    };
  }, [onExpired, userId]);
  return presence;
}
