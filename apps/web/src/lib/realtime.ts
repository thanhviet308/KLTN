import { io, type Socket } from 'socket.io-client';
import * as api from './api';
import {
  classifyRealtimeErrorDelay,
  extractSocketErrorCode,
  type RealtimeReconnectPolicy,
} from './realtime-policy';

export {
  classifyRealtimeErrorDelay,
  extractSocketErrorCode,
  type RealtimeReconnectPolicy,
};

export interface ChatSocketHandle {
  readonly socket: Socket;
  readonly getLastErrorCode: () => string;
  readonly reconnectNow: (forceRefresh?: boolean) => void;
  readonly subscribeError: (listener: (code: string) => void) => () => void;
  readonly release: () => void;
}

interface HubState {
  userId: string;
  socket: Socket;
  refCount: number;
  currentToken: string;
  lastErrorCode: string;
  connecting: boolean;
  retryTimer?: ReturnType<typeof setTimeout>;
  refreshTimer: ReturnType<typeof setInterval>;
  errorListeners: Set<(code: string) => void>;
  connect: (forceRefresh?: boolean) => Promise<void>;
  schedule: (delayMs: number, forceRefresh?: boolean) => void;
  teardown: () => void;
}

let activeHub: HubState | undefined;

function createHub(userId: string): HubState {
  const socket = io(`${api.API_ORIGIN}/chat`, {
    transports: ['websocket'],
    autoConnect: false,
    reconnection: false,
  });

  const state: HubState = {
    userId,
    socket,
    refCount: 0,
    currentToken: '',
    lastErrorCode: '',
    connecting: false,
    errorListeners: new Set(),
    refreshTimer: 0 as unknown as ReturnType<typeof setInterval>,
    schedule(delayMs: number, forceRefresh = false) {
      if (state.refCount <= 0 || state.retryTimer) return;
      state.retryTimer = setTimeout(() => {
        state.retryTimer = undefined;
        void state.connect(forceRefresh);
      }, delayMs);
    },
    async connect(forceRefresh = false) {
      if (state.refCount <= 0 || state.connecting) return;
      if (socket.connected && !forceRefresh) return;
      state.connecting = true;
      try {
        if (forceRefresh) await api.refresh();
        const accessToken = await api.accessToken();
        if (state.refCount <= 0 || activeHub !== state) return;
        const rotated =
          socket.connected &&
          state.currentToken &&
          accessToken !== state.currentToken;
        state.currentToken = accessToken;
        socket.auth = { accessToken };
        if (rotated) socket.disconnect();
        if (!socket.connected) socket.connect();
      } catch {
        if (state.refCount > 0 && activeHub === state) {
          state.schedule(3000, false);
        }
      } finally {
        state.connecting = false;
      }
    },
    teardown() {
      clearInterval(state.refreshTimer);
      if (state.retryTimer) clearTimeout(state.retryTimer);
      window.removeEventListener('focus', onResume);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onResume);
      socket.removeAllListeners();
      socket.disconnect();
      state.errorListeners.clear();
    },
  };

  socket.on('connect', () => {
    state.lastErrorCode = '';
    if (state.retryTimer) {
      clearTimeout(state.retryTimer);
      state.retryTimer = undefined;
    }
    state.errorListeners.forEach((listener) => listener(''));
  });

  socket.on('disconnect', (reason) => {
    if (
      reason !== 'io client disconnect' &&
      state.refCount > 0 &&
      activeHub === state
    ) {
      state.schedule(1500, false);
    }
  });

  socket.on('connect_error', (failure) => {
    if (state.refCount <= 0 || activeHub !== state) return;
    const code = extractSocketErrorCode(failure);
    state.lastErrorCode = code;
    state.errorListeners.forEach((listener) => listener(code));
    const policy = classifyRealtimeErrorDelay(code);
    state.schedule(policy.delayMs, policy.refreshAuth);
  });

  const onOnline = () => {
    if (state.refCount > 0 && !socket.connected) {
      if (state.retryTimer) {
        clearTimeout(state.retryTimer);
        state.retryTimer = undefined;
      }
      void state.connect(false);
    }
  };

  const onResume = () => {
    if (
      document.visibilityState === 'visible' &&
      state.refCount > 0 &&
      !socket.connected
    ) {
      onOnline();
    }
  };

  window.addEventListener('focus', onResume);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onResume);

  state.refreshTimer = setInterval(() => {
    if (state.refCount <= 0 || activeHub !== state) return;
    void api
      .accessToken()
      .then((accessToken) => {
        if (state.refCount <= 0 || activeHub !== state) return;
        if (
          socket.connected &&
          state.currentToken &&
          accessToken !== state.currentToken
        ) {
          state.currentToken = accessToken;
          socket.auth = { accessToken };
          socket.disconnect();
          socket.connect();
        } else if (!socket.connected && !state.retryTimer) {
          void state.connect(false);
        }
      })
      .catch(() => {});
  }, 15000);

  return state;
}

export function acquireChatSocket(userId: string): ChatSocketHandle {
  if (activeHub && activeHub.userId !== userId) {
    activeHub.teardown();
    activeHub = undefined;
  }
  if (!activeHub) {
    activeHub = createHub(userId);
  }
  const hub = activeHub;
  hub.refCount++;
  if (!hub.socket.connected) {
    void hub.connect(false);
  }
  let released = false;
  return {
    socket: hub.socket,
    getLastErrorCode: () => hub.lastErrorCode,
    reconnectNow: (forceRefresh = false) => {
      if (hub.retryTimer) {
        clearTimeout(hub.retryTimer);
        hub.retryTimer = undefined;
      }
      void hub.connect(forceRefresh);
    },
    subscribeError: (listener) => {
      hub.errorListeners.add(listener);
      return () => {
        hub.errorListeners.delete(listener);
      };
    },
    release: () => {
      if (released) return;
      released = true;
      hub.refCount = Math.max(0, hub.refCount - 1);
      if (hub.refCount === 0 && activeHub === hub) {
        hub.teardown();
        activeHub = undefined;
      }
    },
  };
}
