/**
 * Site Navigation Server-side Loader
 *
 * Loads and merges navigation items from:
 * - System configuration (site.config.ts)
 * - Enabled plugins (runtime contracts)
 */

import { cache } from 'react';
import { siteConfig } from '@/../site.config';
import { loadPluginNavigation } from './plugin-nav-loader.server';
import type { SiteMenuItem, MenusByLocation } from './types';
import { logger } from '@/lib/_core/logger';

/**
 * Generic site navigation builder
 *
 * Builds navigation items for a specific location by:
 * 1. Using system config items (already in SiteMenuItem format)
 * 2. Loading plugin navigation items
 * 3. Merging and sorting by weight
 *
 * @param location - Menu location (e.g., 'site.header', 'site.footer')
 * @param systemItems - System navigation items from site.config.ts (SiteMenuItem format)
 * @returns Merged and sorted navigation items
 */
async function buildSiteNavItems(
  location: keyof MenusByLocation,
  systemItems: SiteMenuItem[]
): Promise<SiteMenuItem[]> {
  logger.debug(`Building ${location} navigation`);

  // 1. Load plugin navigation items
  const pluginMenus = await loadPluginNavigation(location);
  const pluginNavs = pluginMenus[location] || [];

  // 2. Merge system and plugin items, then sort by weight
  const allNavs = [...systemItems, ...pluginNavs];
  allNavs.sort((a, b) => (a.weight || 100) - (b.weight || 100));

  logger.debug(
    {
      systemCount: systemItems.length,
      pluginCount: pluginNavs.length,
      totalCount: allNavs.length,
    },
    `${location} navigation built`
  );

  return allNavs;
}

/**
 * Get site header navigation items
 *
 * Loads navigation items for the site header (top navigation bar).
 * Combines system items from site.config.ts with plugin items.
 *
 * @returns Site header navigation items
 */
export const getSiteHeaderNavItems = cache(async (): Promise<SiteMenuItem[]> => {
  return buildSiteNavItems('site.header', siteConfig.nav?.items || []);
});

/**
 * Get site footer navigation items
 *
 * Loads navigation items for the site footer.
 * Combines system items from site.config.ts with plugin items.
 *
 * @returns Site footer navigation items
 */
export const getSiteFooterNavItems = cache(async (): Promise<SiteMenuItem[]> => {
  return buildSiteNavItems('site.footer', siteConfig.footer?.links || []);
});
