import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';
import * as api from './api';

type EventHandler = (...args: unknown[]) => void;

class SharedChatSocket {
  private socket: Socket | undefined;
  private refCount = 0;
  private connecting = false;
  private refreshing = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private appStateSub: { remove: () => void } | undefined;
  private readonly listeners = new Map<string, Set<EventHandler>>();
  private readonly boundEvents = new Set<string>();
  private readonly authExpiredHandlers = new Set<() => void>();

  acquire(onAuthExpired?: () => void) {
    this.refCount += 1;
    if (onAuthExpired) this.authExpiredHandlers.add(onAuthExpired);
    this.ensureSocket();
    void this.connect();

    let released = false;
    return {
      on: <Args extends unknown[]>(
        event: string,
        handler: (...args: Args) => void,
      ) => {
        const fn = handler as unknown as EventHandler;
        this.addListener(event, fn);
        return () => this.removeListener(event, fn);
      },
      emit: (event: string, ...args: unknown[]) => {
        this.socket?.emit(event, ...args);
      },
      emitWithTimeout: (
        timeoutMs: number,
        event: string,
        ...args: unknown[]
      ) => {
        if (!this.socket) return false;
        this.socket.timeout(timeoutMs).emit(event, ...args);
        return true;
      },
      isConnected: () => !!this.socket?.connected,
      connect: (forceRefresh = false) => this.connect(forceRefresh),
      release: () => {
        if (released) return;
        released = true;
        if (onAuthExpired) this.authExpiredHandlers.delete(onAuthExpired);
        this.refCount = Math.max(0, this.refCount - 1);
        if (this.refCount === 0) {
          this.dispose();
        }
      },
    };
  }

  private ensureSocket() {
    if (this.socket) return;
    const client = io(`${api.API_ORIGIN}/chat`, {
      transports: ['websocket'],
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    this.socket = client;
    this.boundEvents.clear();

    this.bindInternal('connect', () => {
      if (this.retryTimer) {
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
      }
    });

    this.bindInternal(
      'connect_error',
      (problem?: Error & { data?: { code?: string } }) => {
        const raw = `${problem?.data?.code ?? ''} ${problem?.message ?? ''}`;
        const upper = raw.toUpperCase();
        const authFailed =
          upper.includes('AUTH_REQUIRED') ||
          upper.includes('INVALID_ACCESS_TOKEN') ||
          upper.includes('SESSION_EXPIRED') ||
          upper.includes('AUTH') ||
          upper.includes('401') ||
          upper.includes('TOKEN') ||
          upper.includes('SESSION');
        if (authFailed) {
          void this.refreshAndReconnect();
        }
      },
    );

    for (const event of this.listeners.keys()) {
      this.bindDispatcher(event);
    }

    this.appStateSub = AppState.addEventListener('change', state => {
      if (state === 'active' && this.refCount > 0 && !this.socket?.connected) {
        void this.connect();
      }
    });
  }

  private bindInternal<Args extends unknown[]>(
    event: string,
    handler: (...args: Args) => void,
  ) {
    this.addListener(event, handler as unknown as EventHandler);
  }

  private bindDispatcher(event: string) {
    if (!this.socket || this.boundEvents.has(event)) return;
    this.boundEvents.add(event);
    this.socket.on(event, (...args: unknown[]) => {
      const handlers = this.listeners.get(event);
      if (!handlers) return;
      for (const fn of [...handlers]) {
        fn(...args);
      }
    });
  }

  private addListener(event: string, handler: EventHandler) {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    if (this.socket) this.bindDispatcher(event);
  }

  private removeListener(event: string, handler: EventHandler) {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.listeners.delete(event);
  }

  private scheduleReconnect(delayMs: number, forceRefresh = false) {
    if (this.refCount === 0 || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.connect(forceRefresh);
    }, delayMs);
  }

  private async refreshAndReconnect() {
    if (this.refreshing || this.refCount === 0) return;
    this.refreshing = true;
    try {
      await api.refresh();
      const token = await api.accessToken();
      if (this.refCount === 0 || !this.socket) return;
      this.socket.auth = { accessToken: token };
      if (!this.socket.connected) this.socket.connect();
    } catch (error) {
      if (error instanceof api.ApiError && error.status === 401) {
        for (const handler of [...this.authExpiredHandlers]) handler();
      } else {
        this.scheduleReconnect(2000, false);
      }
    } finally {
      this.refreshing = false;
    }
  }

  private async connect(forceRefresh = false) {
    if (
      this.refCount === 0 ||
      this.connecting ||
      this.refreshing ||
      !this.socket ||
      (this.socket.connected && !forceRefresh)
    ) {
      return;
    }
    this.connecting = true;
    try {
      if (forceRefresh) await api.refresh();
      const token = await api.accessToken();
      if (this.refCount === 0 || !this.socket) return;
      this.socket.auth = { accessToken: token };
      if (!this.socket.connected) this.socket.connect();
    } catch (error) {
      if (error instanceof api.ApiError && error.status === 401) {
        for (const handler of [...this.authExpiredHandlers]) handler();
      } else {
        this.scheduleReconnect(2500, false);
      }
    } finally {
      this.connecting = false;
    }
  }

  private dispose() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
    this.appStateSub?.remove();
    this.appStateSub = undefined;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = undefined;
    this.boundEvents.clear();
    this.listeners.clear();
    this.authExpiredHandlers.clear();
    this.connecting = false;
    this.refreshing = false;
  }
}

const shared = new SharedChatSocket();

export function acquireChatSocket(onAuthExpired?: () => void) {
  return shared.acquire(onAuthExpired);
}
