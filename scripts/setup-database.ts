/**
 * Smart Database Setup Script
 *
 * Automatically sets up database with migrations and RLS policies
 */

/* eslint-disable no-console */
import { exec } from 'child_process';
import { promisify } from 'util';
import postgres from 'postgres';
import { config } from 'dotenv';

// Load environment variables from .env file
config();
const execAsync = promisify(exec);

async function setupDatabase() {
  console.log('\n🚀 Database Setup Starting...\n');
  console.log('='.repeat(60));

  // Support multiple environment variable names
  const DATABASE_URL = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;

  if (!DATABASE_URL) {
    console.error('\n❌ DATABASE_URL environment variable is not set!');
    console.error('💡 Checked: DATABASE_URL, NEON_DATABASE_URL');
    console.error('💡 Please create a .env file with one of these variables\n');
    process.exit(1);
  }

  let sql = null;

  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 1: Test Connection
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n📡 Step 1: Testing database connection...');

    sql = postgres(DATABASE_URL, { max: 1 });

    try {
      await sql`SELECT 1 AS test`;
      console.log('   ✅ Connection successful');
    } catch (error) {
      console.error('   ❌ Connection failed!');
      console.error('   Error:', error instanceof Error ? error.message : String(error));
      console.error('\n💡 Please check:');
      console.error('   - DATABASE_URL in .env file');
      console.error('   - Database server is running');
      console.error('   - Network connectivity\n');
      process.exit(1);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 2: Check Database State
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n🔍 Step 2: Checking database state...');

    const tableCount = await sql`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `;

    const count = Number(tableCount[0]?.count || 0);

    if (count === 0) {
      console.log('   🆕 Fresh database detected (0 tables)');
    } else {
      console.log(`   ⚠️  Existing database detected (${count} tables)`);
      console.log('   Will run migrations to update schema...');
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 3: Run Migrations
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n📦 Step 3: Running database migrations...');
    console.log('   This includes:');
    console.log('   - 0000_initial_schema.sql (all tables, indexes)');
    console.log('   - 0001_add_rls_policies.sql (RLS setup)');

    try {
      const { stderr } = await execAsync('npx drizzle-kit migrate', {
        cwd: process.cwd(),
      });

      if (stderr && !stderr.includes('warning') && !stderr.includes('Reading config')) {
        console.error('   ⚠️  Migration warnings:', stderr);
      }

      console.log('   ✅ Migrations completed successfully');
    } catch (error) {
      console.error('   ❌ Migration failed!');
      console.error('   Error:', error instanceof Error ? error.message : String(error));
      console.error('\n💡 Possible solutions:');
      console.error('   - Check migration files in drizzle/migrations/');
      console.error('   - Verify database permissions');
      console.error('   - Run: npm run db:reset (if data can be lost)\n');
      process.exit(1);
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Step 4: Verify Setup
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n✓ Step 4: Verifying database setup...');

    // Check tables
    const finalTableCount = await sql`
      SELECT COUNT(*) as count
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
    `;
    const finalCount = Number(finalTableCount[0]?.count || 0);
    console.log(`   📊 Tables: ${finalCount}`);

    // Check RLS enabled
    const rlsCheck = await sql`
      SELECT COUNT(*) as count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relrowsecurity = true
    `;
    const rlsCount = Number(rlsCheck[0]?.count || 0);
    console.log(`   🔒 RLS-enabled tables: ${rlsCount}`);

    // Check policies
    const policyCheck = await sql`
      SELECT COUNT(*) as count
      FROM pg_policies
      WHERE schemaname = 'public'
    `;
    const policyCount = Number(policyCheck[0]?.count || 0);
    console.log(`   📜 RLS policies: ${policyCount}`);

    // Check function
    const functionCheck = await sql`
      SELECT COUNT(*) as count
      FROM pg_proc
      WHERE proname = 'current_user_id'
    `;
    const functionExists = Number(functionCheck[0]?.count || 0) > 0;
    console.log(`   🔧 Helper function: ${functionExists ? '✅' : '❌'} current_user_id()`);

    // Validation
    console.log('\n' + '='.repeat(60));
    if (rlsCount > 0 && policyCount > 0 && functionExists) {
      console.log('✨ Database setup complete!\n');
      console.log('Next steps:');
      console.log('  1. Run seed data: npm run seed:tool-site');
      console.log('  2. Start development: npm run dev\n');
    } else {
      console.warn('\n⚠️  Setup completed with warnings:');
      if (rlsCount === 0) console.warn('   - No RLS-enabled tables found');
      if (policyCount === 0) console.warn('   - No RLS policies found');
      if (!functionExists) console.warn('   - Helper function current_user_id() not found');
      console.warn('\n💡 The database may not be fully configured\n');
    }
  } catch (error) {
    console.error('\n❌ Setup failed with unexpected error:');
    console.error(error);
    process.exit(1);
  } finally {
    if (sql) {
      await sql.end();
    }
  }
}

// Run setup
setupDatabase().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
