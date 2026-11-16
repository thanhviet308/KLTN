export interface RealtimeReconnectPolicy {
  refreshAuth: boolean;
  delayMs: number;
}

export function classifyRealtimeErrorDelay(
  codeOrMessage: string,
): RealtimeReconnectPolicy {
  const normalized = codeOrMessage.toUpperCase();
  if (/AUTH|TOKEN|SESSION|CREDENTIAL/.test(normalized)) {
    return { refreshAuth: true, delayMs: 1500 };
  }
  if (/CONNECTION_LIMIT|REALTIME_BUSY|RATE_LIMITED|429/.test(normalized)) {
    return { refreshAuth: false, delayMs: 5000 };
  }
  return { refreshAuth: false, delayMs: 2000 };
}

export function extractSocketErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as { data?: { code?: unknown }; message?: unknown };
  if (typeof record.data?.code === 'string' && record.data.code) {
    return record.data.code;
  }
  return typeof record.message === 'string' ? record.message : '';
}
