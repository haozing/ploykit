/**
 * ===========================================================================
 * Plugin List API
 * ===========================================================================
 *
 * GET /api/admin/plugins
 *
 * Features:
 * - Get all installed plugin list
 * - Contains plugin basic information and status
 *
 * ✓ P1 SECURITY ENDPOINT
 * ✓ Protected with admin guard and error handling
 *
 * 🔒 Permission: Administrator
 */

import { NextResponse } from 'next/server';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { db } from '@/lib/db/client.server';
import { pluginInstallations } from '@/lib/db/schema/plugins';
import { logger } from '@/lib/_core/logger';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime';
import { listPluginRuntimeIds } from '@/lib/plugin-runtime/loader';

export const GET = withAdminGuard(
  withErrorHandling(async () => {
    logger.info('Fetching all available plugins (installed + uninstalled)');

    //
    // 1. Get all installed plugins
    //
    const installations = await db.select().from(pluginInstallations);
    const installationMap = new Map(installations.map((i) => [i.pluginId, i]));

    logger.debug({ installedCount: installations.length }, 'Found installed plugins');

    //
    // 2. Get all available runtime plugins.
    //
    const allPluginIds = listPluginRuntimeIds();
    logger.debug({ totalCount: allPluginIds.length }, 'Found available plugins');

    //
    // 3. Merge data, mark installation status
    //
    const plugins = await Promise.all(
      allPluginIds.map(async (pluginId) => {
        try {
          const contract = await pluginRuntimeRegistry.getOrLoad(pluginId);
          const installation = installationMap.get(pluginId);

          return {
            id: pluginId,
            name: contract.name,
            version: contract.version,
            description: contract.definition.description,
            author: contract.definition.author || 'Unknown',
            installed: !!installation, // Installed
            enabled: installation?.enabled, // Field
            installedAt: installation?.installedAt?.toISOString(), // Field
          };
        } catch (error) {
          // If contract loading failed, return basic information.
          logger.warn({ pluginId, error }, 'Failed to load plugin runtime contract');
          const installation = installationMap.get(pluginId);

          return {
            id: pluginId,
            name: pluginId,
            version: 'unknown',
            description: 'Failed to load plugin runtime contract',
            author: 'unknown',
            installed: !!installation,
            enabled: installation?.enabled,
            installedAt: installation?.installedAt?.toISOString(),
          };
        }
      })
    );

    //
    // 4. Sort by installation status (installed first, then by name)
    //
    plugins.sort((a, b) => {
      if (a.installed && !b.installed) return -1;
      if (!a.installed && b.installed) return 1;
      return a.name.localeCompare(b.name);
    });

    logger.info({ count: plugins.length }, 'Plugin list fetched successfully');

    //
    // 5. Return plugin list
    //
    return NextResponse.json(
      {
        success: true,
        plugins,
      },
      { status: 200 }
    );
  })
);
