/**
 * Plugin Sync
 *
 * Synchronizes plugins from the filesystem to the database on application startup.
 */

import { readdirSync, statSync } from 'fs';
import { resolve } from 'path';
import { db } from '@/lib/db/client.server';
import { pluginInstallations } from '@/lib/db/schema';
import { logger } from '@/lib/_core/logger';
import { pluginRuntimeInstallerService } from '@/lib/plugin-runtime/installer';
import { SYSTEM_USER_ID } from './constants';

/**
 * Scan the plugins directory for valid plugin folders
 */
function scanPluginsDirectory(): string[] {
  try {
    const pluginsDir = resolve(process.cwd(), 'plugins');
    const entries = readdirSync(pluginsDir);

    const validPlugins = entries.filter((entry) => {
      if (entry.startsWith('.')) return false;

      const fullPath = resolve(pluginsDir, entry);
      const stat = statSync(fullPath);
      if (!stat.isDirectory()) return false;

      // Runtime plugins must expose a single plugin.ts contract.
      try {
        const contractPath = resolve(fullPath, 'plugin.ts');
        statSync(contractPath);
        return true;
      } catch {
        logger.warn({ pluginId: entry }, 'Plugin directory missing plugin.ts');
        return false;
      }
    });

    return validPlugins;
  } catch (error) {
    logger.error({ error }, 'Failed to scan plugins directory');
    return [];
  }
}

/**
 * Sync discovered plugins to database, installing any new ones
 */
export async function syncPluginsToDatabase(): Promise<{
  total: number;
  registered: number;
  newlyAdded: number;
}> {
  try {
    logger.info('Starting plugin sync...');

    const discoveredPlugins = scanPluginsDirectory();
    logger.debug({ count: discoveredPlugins.length }, 'Discovered plugins');

    if (discoveredPlugins.length === 0) {
      logger.warn('No plugins found in plugins/ directory');
      return { total: 0, registered: 0, newlyAdded: 0 };
    }

    const registeredPlugins = await db.select().from(pluginInstallations);
    const registeredIds = new Set(registeredPlugins.map((p) => p.pluginId));

    logger.debug({ count: registeredPlugins.length }, 'Registered plugins in database');

    const newPlugins = discoveredPlugins.filter((id) => !registeredIds.has(id));

    if (newPlugins.length === 0) {
      logger.info('All plugins already registered');
      return {
        total: discoveredPlugins.length,
        registered: registeredPlugins.length,
        newlyAdded: 0,
      };
    }

    for (const pluginId of newPlugins) {
      try {
        logger.info({ pluginId }, 'Installing runtime plugin');

        const result = await pluginRuntimeInstallerService.installPlugin(pluginId, SYSTEM_USER_ID);

        if (result.success) {
          logger.info(
            {
              pluginId,
              version: result.installation?.version,
              hasDataModels: !!result.installation,
            },
            'Plugin installed successfully'
          );
        } else {
          logger.error({ pluginId, error: result.error }, 'Plugin installation failed');
        }
      } catch (error) {
        logger.error({ pluginId, error }, 'Failed to install plugin');
        // Continue installing other plugins
      }
    }

    const result = {
      total: discoveredPlugins.length,
      registered: registeredPlugins.length,
      newlyAdded: newPlugins.length,
    };

    logger.info(result, 'Plugin sync completed');
    return result;
  } catch (error) {
    logger.error({ error }, 'Plugin sync failed');
    throw error;
  }
}
