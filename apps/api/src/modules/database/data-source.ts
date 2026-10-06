import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource } from 'typeorm';
import { validateDatabaseUrl } from '../../config/environment';
import { typeormOptions } from './typeorm-options';

const envFile = resolve(__dirname, '../../../.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const migrationUrl = validateDatabaseUrl(
  process.env.DATABASE_DIRECT_URL?.trim() || process.env.DATABASE_URL,
);
if (new URL(migrationUrl).hostname.includes('-pooler.')) {
  throw new Error(
    'Migrations require a direct connection: use a Neon hostname without -pooler in DATABASE_URL, or set DATABASE_DIRECT_URL',
  );
}
const options = typeormOptions(migrationUrl);

export default new DataSource({
  ...options,
  poolSize: 1,
  extra: {
    ...options.extra,
    statement_timeout: 30000,
    query_timeout: 35000,
    application_name: 'realtime-chat-migrations',
    options: '-c timezone=UTC -c lock_timeout=5000',
  },
});
