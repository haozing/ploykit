import 'server-only';

import { logger } from '@/lib/_core/logger';
import type { SitemapEntry } from '@/lib/bus/hook-helpers.server';
import { absoluteUrl } from '@/lib/seo/url-policy';
import { pluginRuntimeRegistry } from '../registry';
import { createPluginToolSitemapEntry } from './tool-route-metadata.server';
import { runtimeScopeService } from '../scope';

export async function listPluginToolSitemapEntries(input?: {
  pluginIds?: readonly string[];
  locale?: string;
}): Promise<SitemapEntry[]> {
  const pluginIds =
    input?.pluginIds ?? (await runtimeScopeService.listRuntimePluginIds({ surface: 'sitemap' }));
  const entries: SitemapEntry[] = [];

  for (const pluginId of pluginIds) {
    try {
      const contract = await pluginRuntimeRegistry.getOrLoad(pluginId);
      for (const route of contract.routes.pages) {
        if (!route.tool || route.auth !== 'public' || route.layout !== 'site' || route.commercial) {
          continue;
        }

        const entry = createPluginToolSitemapEntry(route.tool, { locale: input?.locale });
        if (entry) {
          entries.push(entry);
        }
      }
    } catch (error) {
      logger.warn({ pluginId, error }, 'Failed to collect plugin tool sitemap entries');
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

export function createPluginToolSitemapUrl(path: string): string {
  return absoluteUrl(path);
}
