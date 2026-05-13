/**
 * Manual Migration Runner
 *
 * Executes Drizzle SQL migration files in journal order
 */

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

function loadMigrationFilenames(migrationsDir: string): string[] {
  const journalPath = resolve(migrationsDir, 'meta', '_journal.json');

  if (!existsSync(journalPath)) {
    throw new Error(`Migration journal not found: ${journalPath}`);
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf-8')) as MigrationJournal;
  if (!journal?.entries?.length) {
    return [];
  }

  return [...journal.entries]
    .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0))
    .map((e) => `${e.tag}.sql`);
}

async function runMigrations() {
  console.log('?? Starting database migration...\n');

  const migrationsDir = resolve(process.cwd(), 'drizzle', 'migrations');
  const migrations = loadMigrationFilenames(migrationsDir);

  if (migrations.length === 0) {
    console.log(
      '?? No migrations found in drizzle journal (drizzle/migrations/meta/_journal.json).'
    );
    process.exit(0);
  }

  for (const filename of migrations) {
    try {
      console.log(`?? Executing: ${filename}`);

      const filePath = join(migrationsDir, filename);
      if (!existsSync(filePath)) {
        throw new Error(
          `Migration file not found: ${filePath}. Check drizzle/migrations/meta/_journal.json consistency.`
        );
      }

      const sqlContent = readFileSync(filePath, 'utf-8');

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
