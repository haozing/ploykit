/**
 * Debug endpoint to check navigation loading
 */

import { NextResponse } from 'next/server';
import { getSiteHeaderNavItems } from '@/lib/ui/navigation';
import { loadPluginNavigation } from '@/lib/ui/navigation/plugin-nav-loader.server';
import { pluginQueryService } from '@/lib/plugins/plugin-query.server';
import { getEnabledPlugins } from '@/lib/bus/hook-helpers.server';
import { env } from '@/lib/_core/env';

export async function GET() {
  // 🔒 Disable debug endpoints in production
  if (env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Debug endpoints are disabled in production' },
      { status: 404 }
    );
  }

  try {
    // 1. Check enabled plugins
    const enabledPluginIds = await getEnabledPlugins();

    // 2. Get plugin installations
    const installations = await pluginQueryService.listInstalledPlugins();

    // 3. Load plugin navigation
    const pluginMenus = await loadPluginNavigation('site.header');

    // 4. Get final site header nav items
    const siteHeaderItems = await getSiteHeaderNavItems();

    return NextResponse.json({
      success: true,
      enabledPluginIds,
      installations: installations.map((p) => ({
        pluginId: p.pluginId,
        enabled: p.enabled,
        version: p.version,
      })),
      pluginMenus,
      siteHeaderItems,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      { status: 500 }
    );
  }
}
