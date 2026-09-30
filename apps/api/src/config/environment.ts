export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  WEB_ORIGIN: string;
}

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  const mode = input.NODE_ENV ?? 'development';
  if (mode !== 'development' && mode !== 'test' && mode !== 'production') {
    throw new Error('NODE_ENV must be development, test or production');
  }

  const rawPort = input.PORT ?? '3000';
  if (!/^\d+$/.test(String(rawPort))) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  const host = input.HOST ?? '127.0.0.1';
  if (typeof host !== 'string' || !host.trim() || host !== host.trim()) {
    throw new Error('HOST must be a non-empty hostname or IP address');
  }

  const origin =
    input.WEB_ORIGIN ??
    (mode === 'production' ? undefined : 'http://localhost:5173');
  if (typeof origin !== 'string') {
    throw new Error('WEB_ORIGIN is required in production');
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new Error('WEB_ORIGIN must be a valid HTTP(S) origin');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    (mode === 'production' && url.protocol !== 'https:')
  ) {
    throw new Error(
      'WEB_ORIGIN must be an exact origin; production requires HTTPS',
    );
  }

  return { NODE_ENV: mode, HOST: host, PORT: port, WEB_ORIGIN: origin };
}
