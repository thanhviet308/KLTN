export interface Environment {
  NODE_ENV: 'development' | 'test' | 'production';
  HOST: string;
  PORT: number;
  WEB_ORIGIN: string;
  DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_FROM?: string;
}

export type HttpEnvironment = Pick<
  Environment,
  'NODE_ENV' | 'HOST' | 'PORT' | 'WEB_ORIGIN'
>;

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

  const databaseUrl = validateDatabaseUrl(input.DATABASE_URL);

  const jwtSecret = input.JWT_ACCESS_SECRET;
  if (typeof jwtSecret !== 'string' || !/^[a-f0-9]{64}$/.test(jwtSecret)) {
    throw new Error(
      'JWT_ACCESS_SECRET must be 32 random bytes encoded as 64 lowercase hex characters',
    );
  }

  return {
    NODE_ENV: mode,
    HOST: host,
    PORT: port,
    WEB_ORIGIN: origin,
    DATABASE_URL: databaseUrl,
    JWT_ACCESS_SECRET: jwtSecret,
    SMTP_HOST:
      typeof input.SMTP_HOST === 'string' ? input.SMTP_HOST : undefined,
    SMTP_PORT:
      typeof input.SMTP_PORT === 'string' ? input.SMTP_PORT : undefined,
    SMTP_USER:
      typeof input.SMTP_USER === 'string' ? input.SMTP_USER : undefined,
    SMTP_PASSWORD:
      typeof input.SMTP_PASSWORD === 'string' ? input.SMTP_PASSWORD : undefined,
    SMTP_FROM:
      typeof input.SMTP_FROM === 'string' ? input.SMTP_FROM : undefined,
  };
}

export function validateDatabaseUrl(databaseUrl: unknown): string {
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) {
    throw new Error('DATABASE_URL is required');
  }
  try {
    const database = new URL(databaseUrl);
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      !database.hostname ||
      !database.username ||
      !database.password ||
      database.pathname.length <= 1 ||
      database.hash ||
      databaseUrl !== databaseUrl.trim()
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'DATABASE_URL must be a PostgreSQL URL with credentials and a database name',
    );
  }

  return databaseUrl;
}
