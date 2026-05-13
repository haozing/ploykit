/**
 * Unified Database Initialization Script
 *
 * One command to set up everything:
 * 1. Initialize database and run migrations
 * 2. Seed initial data (roles, plans, admin user)
 * 3. Optionally configure Stripe products
 *
 * Usage:
 *   npm run db:init              # Setup database + seed data
 *   npm run db:init:stripe       # Setup database + seed data + Stripe
 *   npm run db:init -- --stripe  # Same as above
 */

/* eslint-disable no-console */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const hasStripeFlag = process.argv.includes('--stripe');

async function runCommand(command: string, description: string) {
  console.log(`\n🔧 ${description}...\n`);
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      env: process.env,
    });

    if (stdout) console.log(stdout);
    if (stderr && !stderr.includes('warning') && !stderr.includes('Reading config')) {
      console.warn('Warnings:', stderr);
    }

    console.log(`✅ ${description} completed successfully\n`);
  } catch (error: unknown) {
    console.error(`❌ ${description} failed!`);
    if (error instanceof Error) {
      console.error('Error:', error.message);
    }
    throw error;
  }
}

async function main() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║                                                          ║');
  console.log('║        🚀 Database Initialization - All-in-One           ║');
  console.log('║                                                          ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('\n');

  try {
    // Step 1: Setup Database (migrations)
    await runCommand('tsx scripts/setup-database.ts', 'Database Setup');

    // Step 2: Seed Data (roles, plans, admin)
    await runCommand('tsx scripts/seed-tool-site.ts', 'Seed Data');

    // Step 3: Optional Stripe Setup
    if (hasStripeFlag) {
      console.log('\n🎯 Stripe integration enabled...\n');
      await runCommand('tsx scripts/setup-stripe-products.ts', 'Stripe Setup');
    }

    // Success
    console.log('\n' + '='.repeat(60));
    console.log('✨ Database initialization complete!\n');
    console.log('📋 What was set up:');
    console.log('   ✅ Database schema (all tables, indexes, RLS)');
    console.log('   ✅ Global roles (admin, user)');
    console.log('   ✅ Subscription plans (Free, Pro, Enterprise)');
    console.log('   ✅ System administrator account');
    if (hasStripeFlag) {
      console.log('   ✅ Stripe products and prices');
    }
    console.log('\n🎉 You can now start development:');
    console.log('   npm run dev\n');

    if (!hasStripeFlag) {
      console.log('💡 Tip: Run with --stripe flag to configure Stripe integration');
      console.log('   npm run db:init:stripe\n');
    }

    process.exit(0);
  } catch (_error) {
    console.error('\n❌ Initialization failed!');
    console.error('Please check the error messages above and try again.\n');
    process.exit(1);
  }
}

// Run initialization
void main();
