/**
 * Plugin System - Management Exports
 *
 * Public management surface for the runtime plugin system.
 */

// Query Service
export { pluginQueryService } from './plugin-query.server';

// Shared Types
export type { PluginInstallation, PluginOperationResult } from './plugin-types';

// Plugin Sync
export { syncPluginsToDatabase } from './plugin-sync';

// Constants
export { SYSTEM_USER_ID } from './constants';
