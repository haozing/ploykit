/**
 * Runtime Reconcile - Index
 *
 * Centralized exports for runtime capability verification.
 */

export {
  runReconcile,
  runReconcileStrict,
  runReconcileAndExit,
  registerCheck,
  unregisterCheck,
} from './reconcile.server';
export type {
  RuntimeCheck,
  RuntimeCheckResult,
  RuntimeReconcileOptions,
  RuntimeReport,
} from './types';

// Register built-in checks
import { registerCheck } from './reconcile.server';
import { envCheck } from './checks/env-check.server';
import { dbCheck } from './checks/db-check.server';
import { pluginMapCheck } from './checks/plugin-map-check.server';
import { rlsCheck } from './checks/rls-check.server';
import { securityCheck } from './checks/security-check.server';
import { storageCheck } from './checks/storage-check.server';
import { pluginStorageCheck } from './checks/plugin-storage-check.server';
import { outboxCheck } from './checks/outbox-check.server';
import { auditUsageCheck } from './checks/audit-usage-check.server';
import { pluginCapabilitiesCheck } from './checks/plugin-capabilities-check.server';
import { pluginRuntimeCheck } from './checks/plugin-runtime-check.server';

// Auto-register standard checks
registerCheck(envCheck);
registerCheck(dbCheck);
registerCheck(pluginMapCheck);
registerCheck(rlsCheck);
registerCheck(securityCheck);
registerCheck(storageCheck);
registerCheck(pluginStorageCheck);
registerCheck(pluginRuntimeCheck);
registerCheck(outboxCheck);
registerCheck(auditUsageCheck);
registerCheck(pluginCapabilitiesCheck);
