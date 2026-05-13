import 'server-only';

import { logger } from '@/lib/_core/logger';
import { getEnabledPlugins } from '@/lib/bus/hook-helpers.server';
import type { SitemapEntry } from '@/lib/bus/hook-helpers.server';
import { pluginRuntimeRegistry } from '../registry';
import { createPluginPublicAliasSitemapEntry } from './public-route-metadata.server';

export async function listPluginPublicAliasSitemapEntries(input?: {
  pluginIds?: readonly string[];
  locale?: string;
}): Promise<SitemapEntry[]> {
  const pluginIds = input?.pluginIds ?? (await getEnabledPlugins());
  const entries: SitemapEntry[] = [];

  for (const pluginId of pluginIds) {
    try {
      const contract = await pluginRuntimeRegistry.getOrLoad(pluginId);
      for (const route of contract.routes.pages) {
        if (route.auth !== 'public' || route.layout !== 'site' || route.commercial) {
          continue;
        }

        for (const alias of route.publicAliases) {
          const entry = createPluginPublicAliasSitemapEntry(alias, { locale: input?.locale });
          if (entry) {
            entries.push(entry);
          }
        }
      }
    } catch (error) {
      logger.warn({ pluginId, error }, 'Failed to collect plugin public alias sitemap entries');
    }
  }

  const byUrl = new Map<string, SitemapEntry>();
  for (const entry of entries) {
    if (!byUrl.has(entry.url)) {
      byUrl.set(entry.url, entry);
    }
  }

  return [...byUrl.values()];
}
