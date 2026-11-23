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
export default new DataSource({
  ...typeormOptions(migrationUrl),
  pool: { max: 1, min: 0 },
  requestTimeout: 35000,
});
