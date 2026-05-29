import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register } from 'tsx/esm/api';

const PROJECT_ROOT = process.cwd();
const DEFAULT_DATABASE_URL = 'postgres://ploykit:ploykit@127.0.0.1:55432/ploykit';
const tsx = register({ namespace: 'ploykit-runtime-stores-cli' });

function slash(value) {
  return value.replace(/\\/g, '/');
}

function toProjectPath(file) {
  return slash(path.relative(PROJECT_ROOT, file));
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseCommandArgs(args) {
  const positionals = [];
  const flags = new Set();
  const values = new Map();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const equalIndex = raw.indexOf('=');
    if (equalIndex !== -1) {
      values.set(raw.slice(0, equalIndex), raw.slice(equalIndex + 1));
      continue;
    }

    const next = args[index + 1];
    if (next && !next.startsWith('--')) {
      values.set(raw, next);
      index += 1;
      continue;
    }

    flags.add(raw);
  }

  return { positionals, flags, values };
}

function configuredDatabaseUrl(options) {
  return (
    options.values.get('database-url') ??
    options.values.get('databaseUrl') ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    ''
  );
}

function databaseUrlFromOptions(options) {
  return configuredDatabaseUrl(options) || DEFAULT_DATABASE_URL;
}

function backupEvidencePath(options) {
  return (
    options.values.get('backup-evidence') ??
    options.values.get('backupEvidence') ??
    process.env.PLOYKIT_MIGRATION_BACKUP_EVIDENCE ??
    process.env.PLOYKIT_BACKUP_EVIDENCE ??
    ''
  );
}

function shouldRequireBackup(options) {
  return (
    options.flags.has('require-backup') ||
    process.env.PLOYKIT_MIGRATION_REQUIRE_BACKUP === 'true'
  );
}

function validateBackupEvidence(options) {
  const required = shouldRequireBackup(options);
  if (!required) {
    return { required: false };
  }

  const evidence = backupEvidencePath(options);
  if (!evidence) {
    throw new Error(
      'RUNTIME_MIGRATION_BACKUP_EVIDENCE_REQUIRED: pass --backup-evidence <path> or set PLOYKIT_MIGRATION_BACKUP_EVIDENCE.'
    );
  }

  const absolute = path.resolve(PROJECT_ROOT, evidence);
  if (!fs.existsSync(absolute)) {
    throw new Error(`RUNTIME_MIGRATION_BACKUP_EVIDENCE_MISSING: ${toProjectPath(absolute)}`);
  }

  let parsed;
  if (path.extname(absolute).toLowerCase() === '.json') {
    parsed = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.ok === false) {
      throw new Error(`RUNTIME_MIGRATION_BACKUP_EVIDENCE_FAILED: ${toProjectPath(absolute)}`);
    }
  }

  return {
    required: true,
    path: toProjectPath(absolute),
    ok: true,
    checkedAt: parsed?.checkedAt,
  };
}

async function loadRuntimeStoreModules() {
  const migrationsModule = await tsx.import(
    pathToFileURL(
      path.join(PROJECT_ROOT, 'src', 'lib', 'module-runtime', 'stores', 'runtime-store-migrations.ts')
    ).href,
    import.meta.url
  );
  const dataModule = await tsx.import(
    pathToFileURL(
      path.join(PROJECT_ROOT, 'src', 'lib', 'module-runtime', 'data', 'pg-executor.ts')
    ).href,
    import.meta.url
  );

  return {
    applyRuntimeStoreMigration: migrationsModule.applyRuntimeStoreMigration,
    readRuntimeStoreMigrations: migrationsModule.readRuntimeStoreMigrations,
    verifyRuntimeStoreSchema: migrationsModule.verifyRuntimeStoreSchema,
    createPgModuleDataExecutor: dataModule.createPgModuleDataExecutor,
  };
}

async function migrationJournalExists(pool) {
  const result = await pool.query(`select to_regclass('public.module_runtime_migrations') as name`);
  return Boolean(result.rows[0]?.name);
}

async function readJournal(pool) {
  if (!(await migrationJournalExists(pool))) {
    return new Map();
  }
  const result = await pool.query(
    `select id, checksum, status, applied_at, duration_ms, environment, error
     from module_runtime_migrations`
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

async function planRuntimeMigrations({ pool, readRuntimeStoreMigrations }) {
  const migrations = readRuntimeStoreMigrations();
  const journal = pool ? await readJournal(pool) : new Map();
  const planned = migrations.map((migration) => {
    const record = journal.get(migration.id);
    const checksumMatches = record ? record.checksum === migration.checksum : false;
    return {
      id: migration.id,
      filename: migration.filename,
      checksum: migration.checksum,
      status: record?.status ?? 'pending',
      appliedAt: record?.applied_at ? new Date(record.applied_at).toISOString() : undefined,
      durationMs: record?.duration_ms ?? undefined,
      environment: record?.environment ?? undefined,
      checksumMatches,
      error: record?.error ?? undefined,
    };
  });

  return {
    expected: migrations.length,
    applied: planned.filter((migration) => migration.status === 'applied' && migration.checksumMatches)
      .length,
    pending: planned.filter((migration) => migration.status === 'pending').map((migration) => migration.id),
    failed: planned.filter((migration) => migration.status === 'failed').map((migration) => migration.id),
    checksumDrift: planned
      .filter((migration) => migration.status === 'applied' && !migration.checksumMatches)
      .map((migration) => migration.id),
    migrations: planned,
  };
}

async function withPool(databaseUrl, callback) {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

async function commandPlan(options, modules) {
  const databaseUrl = configuredDatabaseUrl(options);
  const report = databaseUrl
    ? await withPool(databaseUrl, (pool) => planRuntimeMigrations({ pool, ...modules }))
    : await planRuntimeMigrations({ pool: null, ...modules });
  printJson({
    ok: report.failed.length === 0 && report.checksumDrift.length === 0,
    mode: 'plan',
    database: {
      connected: Boolean(databaseUrl),
      defaultUsed: false,
    },
    ...report,
  });
  process.exitCode = report.failed.length === 0 && report.checksumDrift.length === 0 ? 0 : 1;
}

async function commandMigrate(options, modules) {
  const dryRun = options.flags.has('dry-run') || options.flags.has('plan');
  if (dryRun) {
    await commandPlan(options, modules);
    return;
  }

  const backupEvidence = validateBackupEvidence(options);
  const databaseUrl = databaseUrlFromOptions(options);
  await withPool(databaseUrl, async (pool) => {
    const database = modules.createPgModuleDataExecutor(pool);
    await modules.applyRuntimeStoreMigration(database);
    const schema = await modules.verifyRuntimeStoreSchema(database);
    printJson({
      ok: schema.ok,
      mode: 'migrate',
      migrated: true,
      backupEvidence,
      schema,
    });
    process.exitCode = schema.ok ? 0 : 1;
  });
}

async function commandVerify(options, modules) {
  const applyBeforeVerify = !options.flags.has('no-apply') && !options.flags.has('pure');
  const backupEvidence = applyBeforeVerify ? validateBackupEvidence(options) : { required: false };
  const databaseUrl = databaseUrlFromOptions(options);
  await withPool(databaseUrl, async (pool) => {
    const database = modules.createPgModuleDataExecutor(pool);
    if (applyBeforeVerify) {
      await modules.applyRuntimeStoreMigration(database);
    }
    const schema = await modules.verifyRuntimeStoreSchema(database);
    printJson({
      ...schema,
      mode: 'verify',
      appliedBeforeVerify: applyBeforeVerify,
      backupEvidence,
    });
    process.exitCode = schema.ok ? 0 : 1;
  });
}

async function main() {
  const options = parseCommandArgs(process.argv.slice(2));
  const command = options.positionals[0] ?? 'verify';
  const modules = await loadRuntimeStoreModules();

  if (command === 'plan') {
    await commandPlan(options, modules);
    return;
  }
  if (command === 'migrate') {
    await commandMigrate(options, modules);
    return;
  }
  if (command === 'verify') {
    await commandVerify(options, modules);
    return;
  }

  process.stderr.write(
    'Usage: runtime-stores <plan|migrate|verify> [--dry-run] [--no-apply] [--database-url <url>] [--require-backup --backup-evidence <path>]\n'
  );
  process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await tsx.unregister();
}
