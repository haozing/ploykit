/**
 * Plugin Query Service
 *
 */

import { db } from '@/lib/db/client.server';
import { pluginInstallations } from '@/lib/db/schema/plugins';
import { and, eq } from 'drizzle-orm';
import { getCurrentRuntimeProductId } from '@/lib/plugin-runtime/product-context.server';
import type { PluginInstallation } from './plugin-types';

export interface PluginInstallationQueryScope {
  productId?: string;
}

/**
 * Plugin Query Service
 */
export class PluginQueryService {
  /**
   * List installed plugins.
   *
   * @returns Array of plugin installations
   */
  async listInstalledPlugins(
    scope: PluginInstallationQueryScope = {}
  ): Promise<PluginInstallation[]> {
    const productId = scope.productId;
    const query = db.select().from(pluginInstallations);
    const installations = productId
      ? await query.where(eq(pluginInstallations.productId, productId))
      : await query;

    return installations.map((i) => this.mapInstallation(i));
  }

  /**
   * Get installation record for a specific plugin
   *
   * @param pluginId - Plugin identifier
   * @returns Installation record or null if not installed
   */
  async getInstallation(
    pluginId: string,
    scope: PluginInstallationQueryScope = {}
  ): Promise<PluginInstallation | null> {
    const productId = getCurrentRuntimeProductId(scope);
    const [installation] = await db
      .select()
      .from(pluginInstallations)
      .where(
        and(
          eq(pluginInstallations.productId, productId),
          eq(pluginInstallations.pluginId, pluginId)
        )
      )
      .limit(1);

    return installation ? this.mapInstallation(installation) : null;
  }

  /**
   * Check if a plugin is enabled globally
   *
   * @param pluginId - Plugin identifier
   * @returns True if plugin is installed and enabled globally
   */
  async isEnabled(pluginId: string, scope: PluginInstallationQueryScope = {}): Promise<boolean> {
    const installation = await this.getInstallation(pluginId, scope);
    return installation?.enabled ?? false;
  }

  /**
   * Map database record to PluginInstallation interface
   */
  mapInstallation(record: typeof pluginInstallations.$inferSelect): PluginInstallation {
    return {
      id: record.id,
      productId: record.productId,
      suiteId: record.suiteId ?? undefined,
      bundleId: record.bundleId ?? undefined,
      pluginId: record.pluginId,
      version: record.version,
      enabled: record.enabled,
      installStatus: record.installStatus,
      metadata: record.metadata,
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
