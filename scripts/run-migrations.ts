/**
 * Manual Migration Runner
 *
 * Executes Drizzle SQL migration files in journal order
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { sql } from 'drizzle-orm';
import { getDatabase } from '../src/lib/db/client.server';

// Use the app's database client (already configured via env)
const db = getDatabase();

type MigrationJournal = {
  entries: Array<{
    idx?: number;
    tag: string;
  }>;
};

type MigrationEntry = {
  idx: number;
  tag: string;
  filename: string;
};

type AppliedMigrationRow = {
  tag: string;
  checksum: string;
};

function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }

  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }

  return [];
}

function loadMigrationEntries(migrationsDir: string): MigrationEntry[] {
  const journalPath = resolve(migrationsDir, 'meta', '_journal.json');

  if (!existsSync(journalPath)) {
    throw new Error(`Migration journal not found: ${journalPath}`);
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as MigrationJournal;
  return [...(journal.entries ?? [])]
    .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
    .map((entry, index) => ({
      idx: entry.idx ?? index,
      tag: entry.tag,
      filename: `${entry.tag}.sql`,
    }));
}

function checksum(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

async function ensureMigrationLedger(): Promise<void> {
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS ploykit_migrations (
    tag text PRIMARY KEY,
    idx integer NOT NULL,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`)
  );
}

async function getAppliedMigrations(): Promise<Map<string, AppliedMigrationRow>> {
  const result = await db.execute(sql.raw('SELECT tag, checksum FROM ploykit_migrations'));
  const rows = resultRows<Record<string, unknown>>(result);

  return new Map(
    rows.map((row) => {
      return [
        String(row.tag),
        {
          tag: String(row.tag),
          checksum: String(row.checksum),
        },
      ];
    })
  );
}

async function hasCurrentSchemaSentinel(): Promise<boolean> {
  const result = await db.execute(
    sql.raw(`SELECT
    to_regclass('public.app_products') IS NOT NULL AS has_app_products,
    to_regclass('public.plugin_runtime_surfaces') IS NOT NULL AS has_plugin_runtime_surfaces,
    EXISTS (
      SELECT 1
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'plugin_installations_product_plugin_idx'
    ) AS has_product_plugin_index
  `)
  );
  const [row] = resultRows<Record<string, unknown>>(result);

  return Boolean(
    row?.has_app_products && row.has_plugin_runtime_surfaces && row.has_product_plugin_index
  );
}

async function bootstrapLedgerForCurrentSchema(entries: MigrationEntry[], migrationsDir: string) {
  for (const entry of entries) {
    const filePath = join(migrationsDir, entry.filename);
    if (!existsSync(filePath)) {
      throw new Error(
        `Migration file not found: ${filePath}. Check drizzle/migrations/meta/_journal.json consistency.`
      );
    }

    const sqlContent = readFileSync(filePath, 'utf-8');
    await db.execute(
      sql`INSERT INTO ploykit_migrations (tag, idx, checksum)
          VALUES (${entry.tag}, ${entry.idx}, ${checksum(sqlContent)})
          ON CONFLICT (tag) DO UPDATE
          SET idx = EXCLUDED.idx,
              checksum = EXCLUDED.checksum`
    );
  }

  console.log(
    `?? Migration ledger bootstrapped from current schema sentinel (${entries.length} migration(s)).`
  );
}

async function recordMigration(entry: MigrationEntry, contentChecksum: string): Promise<void> {
  await db.execute(
    sql`INSERT INTO ploykit_migrations (tag, idx, checksum)
        VALUES (${entry.tag}, ${entry.idx}, ${contentChecksum})
        ON CONFLICT (tag) DO UPDATE
        SET idx = EXCLUDED.idx,
            checksum = EXCLUDED.checksum`
  );
}

async function runMigrations() {
  console.log('?? Starting database migration...\n');

  const migrationsDir = resolve(process.cwd(), 'drizzle', 'migrations');
  const migrations = loadMigrationEntries(migrationsDir);

  if (migrations.length === 0) {
    console.log(
      '?? No migrations found in drizzle journal (drizzle/migrations/meta/_journal.json).'
    );
    process.exit(0);
  }

  await ensureMigrationLedger();
  let appliedMigrations = await getAppliedMigrations();
  if (appliedMigrations.size === 0 && (await hasCurrentSchemaSentinel())) {
    await bootstrapLedgerForCurrentSchema(migrations, migrationsDir);
    appliedMigrations = await getAppliedMigrations();
  }

  for (const migration of migrations) {
    const filename = migration.filename;
    try {
      const filePath = join(migrationsDir, filename);
      if (!existsSync(filePath)) {
        throw new Error(
          `Migration file not found: ${filePath}. Check drizzle/migrations/meta/_journal.json consistency.`
        );
      }

      const sqlContent = readFileSync(filePath, 'utf-8');
      const contentChecksum = checksum(sqlContent);
      const appliedMigration = appliedMigrations.get(migration.tag);
      if (appliedMigration) {
        if (appliedMigration.checksum !== contentChecksum) {
          throw new Error(
            `Migration checksum mismatch for ${filename}. Reset the development database before changing an applied migration.`
          );
        }

        console.log(`?? Skipping already applied migration: ${filename}`);
        continue;
      }

      console.log(`?? Executing: ${filename}`);

      // Split by statement breakpoint and execute each statement
      const statements = sqlContent
        .split('--> statement-breakpoint')
        .map((s) =>
          s
            .split(/\r?\n/)
            .filter((line) => {
              const trimmed = line.trim();
              return trimmed.length > 0 && !trimmed.startsWith('--');
            })
            .join('\n')
            .trim()
        )
        .filter((s) => s.length > 0);

      for (const statement of statements) {
        const trimmed = statement.trim();
        if (trimmed && !trimmed.startsWith('--')) {
          try {
            await db.execute(sql.raw(trimmed));
          } catch (error: any) {
            // Ignore certain errors that are safe to ignore
            const safeErrors = ['does not exist', 'already exists', 'duplicate key value'];

            const isSafeError = safeErrors.some(
              (msg) => error.message?.includes(msg) || error.cause?.message?.includes(msg)
            );

            if (!isSafeError) {
              throw error;
            }

            console.log(`  ??  Skipped (safe to ignore): ${error.cause?.message || error.message}`);
          }
        }
      }

      await recordMigration(migration, contentChecksum);
      appliedMigrations.set(migration.tag, {
        tag: migration.tag,
        checksum: contentChecksum,
      });
      console.log(`? Completed: ${filename}\n`);
    } catch (error) {
      console.error(`? Error in ${filename}:`, error);
      throw error;
    }
  }

  console.log('? All migrations completed successfully!');
  process.exit(0);
}

runMigrations().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
