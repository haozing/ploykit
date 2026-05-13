/**
 * Migration Integrity Verification Script
 *
 * Checks:
 * 1. All journal entries have corresponding SQL files
 * 2. All SQL files are in the journal
 * 3. No orphaned files
 *
 * Usage: npm run db:verify
 */

/* eslint-disable no-console */
import { readdir, readFile } from 'fs/promises';
import { resolve } from 'path';

async function verifyMigrations() {
  console.log('\n🔍 Verifying migration integrity...\n');

  try {
    // Read journal
    const journalPath = resolve(process.cwd(), 'drizzle/migrations/meta/_journal.json');
    const journalContent = await readFile(journalPath, 'utf-8');
    const journal = JSON.parse(journalContent);

    console.log(`📋 Journal contains ${journal.entries.length} migration(s)\n`);

    // Read migration files
    const migrationsDir = resolve(process.cwd(), 'drizzle/migrations');
    const files = await readdir(migrationsDir);
    const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

    console.log(`📁 Found ${sqlFiles.length} SQL file(s)\n`);

    // Verify consistency
    let errors = 0;

    console.log('Checking journal entries...');
    for (let i = 0; i < journal.entries.length; i++) {
      const entry = journal.entries[i];
      const expectedFile = `${entry.tag}.sql`;

      if (!sqlFiles.includes(expectedFile)) {
        console.error(`❌ Missing SQL file for journal entry: ${expectedFile}`);
        errors++;
      } else {
        console.log(`✅ ${expectedFile}`);
      }
    }

    console.log('\nChecking for orphaned files...');
    for (const file of sqlFiles) {
      const tag = file.replace('.sql', '');
      const inJournal = journal.entries.some((e: { tag: string }) => e.tag === tag);

      if (!inJournal) {
        console.error(`❌ Orphaned migration file (not in journal): ${file}`);
        errors++;
      } else {
        console.log(`✅ ${file} is in journal`);
      }
    }

    console.log('\n' + '='.repeat(50));
    if (errors === 0) {
      console.log('✅ All migrations verified successfully!\n');
      console.log('Summary:');
      console.log(`  - Journal entries: ${journal.entries.length}`);
      console.log(`  - SQL files: ${sqlFiles.length}`);
      console.log(`  - Status: All consistent\n`);
    } else {
      console.error(`❌ Found ${errors} error(s)\n`);
      process.exit(1);
    }
  } catch (error) {
    console.error(
      '❌ Verification failed:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

verifyMigrations().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
