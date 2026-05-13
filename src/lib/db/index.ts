/**
 *
 */

// Server-OnlyExport

export {
  db,
  testDatabaseConnection,
  closeDatabaseConnection,
  isDatabaseHealthy,
  ensureHealthyConnection,
  withSystemContext,
  withUserContext,
  requireUserContext,
  withPluginContext,
} from './client.server';
export type { Database } from './client.server';

export {
  getDatabaseConfig,
  getMigrationUrl,
  validateDatabaseConfig,
  logDatabaseConfig,
} from './config.server';
export type { DatabaseProvider, DatabaseConfig } from './config.server';

export * from './schema';

export {
  checkRLSStatus,
  DEFAULT_RLS_REQUIREMENTS,
  validateRLSConfiguration,
  validatePluginModelRLS,
  validateRLSStatuses,
  getTableRLSStatus,
  generateRLSReport,
} from './rls-checker';
export type {
  PluginModelRLSValidationResult,
  RLSRequirement,
  RLSRequirementInput,
  RLSStatus,
  RLSValidationResult,
} from './rls-checker';
