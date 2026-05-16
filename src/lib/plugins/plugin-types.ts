/**
 * Plugin System - Shared Types
 *
 */

/**
 * Product-scoped plugin installation record.
 */
export interface PluginInstallation {
  id: string;
  productId: string;
  suiteId?: string;
  bundleId?: string;
  pluginId: string;
  version: string;
  enabled: boolean;
  installStatus: string;
  metadata: Record<string, unknown>;
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
