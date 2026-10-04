import { MigrationExecutor } from 'typeorm';
import dataSource from './data-source';

async function migrate(): Promise<void> {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  let locked = false;
  try {
    await runner.connect();
    const rows: { acquired: boolean }[] = await runner.query(
      'SELECT pg_try_advisory_lock(1800163, 1) AS acquired',
    );
    locked = rows[0]?.acquired === true;
    if (!locked) {
      console.error(
        'Another TypeORM migration process is running; retry after it finishes',
      );
      process.exitCode = 1;
      return;
    }
    // Run migrations and the lock on the same PostgreSQL connection.
    const executor = new MigrationExecutor(dataSource, runner);
    executor.transaction = 'all';
    const applied = await executor.executePendingMigrations();
    console.log(
      applied.length
        ? 'Applied ' + applied.length + ' TypeORM migration(s)'
        : 'TypeORM migrations are up to date',
    );
  } finally {
    try {
      if (locked) await runner.query('SELECT pg_advisory_unlock(1800163, 1)');
    } finally {
      try {
        await runner.release();
      } finally {
        await dataSource.destroy();
      }
    }
  }
}

void migrate().catch((error: unknown) => {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  console.error(
    'TypeORM migration failed; check connection settings, migration files and database state',
    /^[A-Z0-9]{5}$/.test(code) ? `(${code})` : '',
  );
  process.exitCode = 1;
});
