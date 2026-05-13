/**
 * Plugin System - Shared Types
 *
 */

/**
 * Plugin installation record (Global)
 */
export interface PluginInstallation {
  id: string;
  pluginId: string;
  version: string;
  enabled: boolean;
  installedAt: Date;
  updatedAt: Date;
  installedBy?: string;
}

/**
 * Result of a plugin management operation
 */
export interface PluginOperationResult {
  success: boolean;
  error?: string;
  installation?: PluginInstallation;
}
