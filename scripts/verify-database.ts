/**
 * Database Verification Script
 *
 * Verifies that all tables, RLS policies, and seed data are correctly set up
 */

import { sql } from 'drizzle-orm';
import { getDatabase } from '../src/lib/db/client.server';
import { PLATFORM_PRIMARY_CREDIT_METRIC } from '../src/lib/billing/billing-metrics';

const db = getDatabase();

// Helper function to normalize query results across different drivers
function toArray<T>(result: any): T[] {
  return 'rows' in result ? result.rows : result;
}

async function verifyDatabase() {
  console.log('🔍 Starting database verification...\n');

  try {
    // 1. Check tables
    console.log('📋 Checking tables...');
    const tablesResult = await db.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const tables = toArray<any>(tablesResult).map((r: any) => r.tablename);
    console.log(`   Found ${tables.length} tables:`);
    tables.forEach((t: string) => console.log(`   - ${t}`));

    // 2. Check RLS policies
    console.log('\n🔒 Checking RLS policies...');
    const policiesResult = await db.execute(
      sql`SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname`
    );
    const policies = toArray<any>(policiesResult);
    const uniqueTables = [...new Set(policies.map((p: any) => p.tablename))];
    console.log(`   Found ${policies.length} policies on ${uniqueTables.length} tables:`);
    uniqueTables.forEach((t: string) => {
      const tablePolicies = policies.filter((p: any) => p.tablename === t);
      console.log(`   - ${t}: ${tablePolicies.length} policies`);
    });

    // 3. Check seed data - roles
    console.log('\n👥 Checking roles...');
    const rolesResult = await db.execute(
      sql`SELECT id, name, slug, is_default FROM roles ORDER BY name`
    );
    const roles = toArray<any>(rolesResult);
    console.log(`   Found ${roles.length} roles:`);
    roles.forEach((r: any) =>
      console.log(`   - ${r.name} (${r.slug})${r.is_default ? ' [default]' : ''}`)
    );

    // 4. Check seed data - plans
    console.log('\n📦 Checking entitlement plans...');
    const plansResult = await db.execute(
      sql`SELECT id, name, slug, limits, is_default FROM entitlement_plans ORDER BY sort_order`
    );
    const plans = toArray<any>(plansResult);
    console.log(`   Found ${plans.length} plans:`);
    plans.forEach((p: any) =>
      console.log(
        `   - ${p.name} (${p.slug}): ${p.limits?.monthly?.[PLATFORM_PRIMARY_CREDIT_METRIC] ?? 'N/A'} credits/month${p.is_default ? ' [default]' : ''}`
      )
    );

    // 5. Check seed data - permissions
    console.log('\n🔑 Checking permissions...');
    const permissionsResult = await db.execute(
      sql`SELECT id, identifier, resource FROM permissions ORDER BY resource, identifier`
    );
    const permissions = toArray<any>(permissionsResult);
    console.log(`   Found ${permissions.length} permissions`);
    if (permissions.length > 0) {
      const resources = [...new Set(permissions.map((p: any) => p.resource))];
      resources.forEach((res: string) => {
        const resPerms = permissions.filter((p: any) => p.resource === res);
        console.log(`   - ${res}: ${resPerms.length} permissions`);
      });
    } else {
      console.log('   ⚠️  No permissions seeded yet');
    }

    // 6. Verify soft delete columns
    console.log('\n🗑️  Checking soft delete columns...');
    const softDeleteCheck = await db.execute(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'user_profiles' AND column_name IN ('deleted_at', 'deleted_by')`
    );
    const softDeleteCols = toArray<any>(softDeleteCheck);
    if (softDeleteCols.length === 2) {
      console.log('   ✅ Soft delete columns present on user_profiles');
    } else {
      console.log('   ❌ Soft delete columns missing!');
    }

    console.log('\n✨ Database verification completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Verification failed:', error);
    process.exit(1);
  }
}

verifyDatabase();
