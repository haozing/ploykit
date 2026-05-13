/**
 * Plugin Query Service
 *
 */

import { db } from '@/lib/db/client.server';
import { pluginInstallations } from '@/lib/db/schema/plugins';
import { eq } from 'drizzle-orm';
import type { PluginInstallation } from './plugin-types';

/**
 * Plugin Query Service
 */
export class PluginQueryService {
  /**
   * List all installed plugins globally
   *
   * @returns Array of plugin installations
   */
  async listInstalledPlugins(): Promise<PluginInstallation[]> {
    const installations = await db.select().from(pluginInstallations);

    return installations.map((i) => this.mapInstallation(i));
  }

  /**
   * Get installation record for a specific plugin
   *
   * @param pluginId - Plugin identifier
   * @returns Installation record or null if not installed
   */
  async getInstallation(pluginId: string): Promise<PluginInstallation | null> {
    const [installation] = await db
      .select()
      .from(pluginInstallations)
      .where(eq(pluginInstallations.pluginId, pluginId))
      .limit(1);

    return installation ? this.mapInstallation(installation) : null;
  }

  /**
   * Check if a plugin is enabled globally
   *
   * @param pluginId - Plugin identifier
   * @returns True if plugin is installed and enabled globally
   */
  async isEnabled(pluginId: string): Promise<boolean> {
    const installation = await this.getInstallation(pluginId);
    return installation?.enabled ?? false;
  }

  /**
   * Map database record to PluginInstallation interface
   */
  mapInstallation(record: typeof pluginInstallations.$inferSelect): PluginInstallation {
    return {
      id: record.id,
      pluginId: record.pluginId,
      version: record.version,
      enabled: record.enabled,
      installedAt: record.installedAt,
      updatedAt: record.updatedAt,
      installedBy: record.installedBy || undefined,
    };
  }
}

/**
 * Global plugin query service instance
 */
export const pluginQueryService = new PluginQueryService();
