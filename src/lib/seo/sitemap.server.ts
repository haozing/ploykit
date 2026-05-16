import 'server-only';

import type { MetadataRoute } from 'next';
import { locales } from '@/i18n/config';
import { triggerSitemapHook, type SitemapEntry } from '@/lib/bus/hook-helpers.server';
import {
  listHostPageOverrideSitemapEntries,
  listPluginPublicAliasSitemapEntries,
  listPluginToolSitemapEntries,
} from '@/lib/plugin-runtime';
import { appBaseUrl } from './url-policy';
import {
  createSitemapChunks,
  dedupeSitemapItems,
  normalizeSitemapEntry,
  type SitemapChunk,
} from './sitemap-policy';
import { listLocalizedPublicSiteSitemapEntries } from './site-routes';

export async function collectSitemapItems(): Promise<MetadataRoute.Sitemap> {
  const pluginEntriesByLocale = await Promise.all(
    locales.map(async (locale) => {
      const [pluginToolEntries, pluginPublicAliasEntries] = await Promise.all([
        listPluginToolSitemapEntries({ locale }),
        listPluginPublicAliasSitemapEntries({ locale }),
      ]);

      return [...pluginToolEntries, ...pluginPublicAliasEntries].flatMap((entry) => {
        const normalized = normalizeSitemapEntry(entry, { source: 'plugin-route' });
        return normalized ? [normalized] : [];
      });
    })
  );

  const pluginHookEntries = (await triggerSitemapHook({ baseUrl: appBaseUrl() })).map(
    (entry: SitemapEntry) => ({
      url: entry.url,
      lastModified: entry.lastModified,
      changeFrequency: entry.changeFrequency,
      priority: entry.priority,
      alternates: entry.alternates,
    })
  );
  const hostPageOverrideEntries = await listHostPageOverrideSitemapEntries();

  return dedupeSitemapItems([
    ...hostPageOverrideEntries,
    ...listLocalizedPublicSiteSitemapEntries(),
    ...pluginEntriesByLocale.flat(),
    ...pluginHookEntries,
  ]);
}

export async function listSitemapChunks(): Promise<SitemapChunk[]> {
  const items = await collectSitemapItems();
  return createSitemapChunks(items.length);
}

export async function getSitemapChunk(id: number): Promise<MetadataRoute.Sitemap> {
  const items = await collectSitemapItems();
  const chunk = createSitemapChunks(items.length).find((candidate) => candidate.id === id);
  if (!chunk) {
    return [];
  }

  return items.slice(chunk.start, chunk.end);
}
