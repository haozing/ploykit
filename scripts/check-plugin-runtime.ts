/* eslint-disable no-console */
/**
 * Plugin Runtime Check
 *
 * Validates plugin runtime state:
 * - Plugin map consistency
 * - Environment variables
 * - Database connectivity
 *
 * Usage:
 *   tsx scripts/check-plugin-runtime.ts
 */

import { runReconcileAndExit } from '@/lib/runtime/reconcile.server';
import { closeDatabaseConnection } from '@/lib/db/client.server';

// Import to trigger check registration
import '@/lib/runtime';

async function main(): Promise<void> {
  await runReconcileAndExit();
  await closeDatabaseConnection();
  process.exit(0);
}

main().catch(async (error) => {
  console.error('Runtime check failed with error:', error);
  await closeDatabaseConnection().catch(() => undefined);
  process.exit(1);
});
