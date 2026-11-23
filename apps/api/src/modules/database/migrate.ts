import { MigrationExecutor } from 'typeorm';
import dataSource from './data-source';

function reviewedMigrationNames(): Set<string> | undefined {
  const argumentsWithAllow = process.argv
    .slice(2)
    .filter((argument) => argument.startsWith('--allow='));
  if (!argumentsWithAllow.length) return undefined;
  const values = argumentsWithAllow
    .flatMap((argument) => argument.slice('--allow='.length).split(','))
    .filter(Boolean);
  return new Set(values);
}

async function migrate(): Promise<void> {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  let locked = false;
  try {
    await runner.connect();
    const rows: { acquired: number }[] = await runner.query(
      "DECLARE @res INT; EXEC @res = sp_getapplock @Resource = 'typeorm_migrations_lock', @LockMode = 'Exclusive', @LockOwner = 'Session', @LockTimeout = 0; SELECT @res AS acquired;",
    );
    locked = (rows[0]?.acquired ?? -1) >= 0;
    if (!locked) {
      console.error(
        'Another TypeORM migration process is running; retry after it finishes',
      );
      process.exitCode = 1;
      return;
    }
    const executor = new MigrationExecutor(dataSource, runner);
    executor.transaction = 'all';
    if (process.argv.includes('--check')) {
      const pending = await executor.getPendingMigrations();
      console.log(`Pending TypeORM migrations: ${pending.length}`);
      if (pending.length) {
        console.error(
          'Blue-green deployment requires applying reviewed backwards-compatible migrations separately before switching API versions',
        );
        process.exitCode = 1;
      }
      return;
    }
    const allowed = reviewedMigrationNames();
    if (allowed) {
      const pending = await executor.getPendingMigrations();
      const unreviewed = pending
        .map((migration) => migration.name)
        .filter((name) => !allowed.has(name));
      if (unreviewed.length) {
        console.error(
          `Refusing unreviewed pending migration(s): ${unreviewed.join(', ')}`,
        );
        process.exitCode = 1;
        return;
      }
      console.log(
        `Reviewed pending migrations: ${pending.length ? pending.map((migration) => migration.name).join(', ') : 'none'}`,
      );
    }
    const applied = await executor.executePendingMigrations();
    console.log(
      applied.length
        ? 'Applied ' + applied.length + ' TypeORM migration(s)'
        : 'TypeORM migrations are up to date',
    );
  } finally {
    try {
      if (locked) {
        await runner.query(
          "EXEC sp_releaseapplock @Resource = 'typeorm_migrations_lock', @LockOwner = 'Session'",
        );
      }
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
