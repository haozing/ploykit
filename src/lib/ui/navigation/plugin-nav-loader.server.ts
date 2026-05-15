/**
 *
 */

import { cache } from 'react';
import { pluginQueryService } from '@/lib/plugins/plugin-query.server';
import type { MenusByLocation, MenuItem } from './types';
import { logger } from '@/lib/_core/logger';
import { pluginRuntimeRegistry, normalizeRuntimePath } from '@/lib/plugin-runtime';
import type { PluginRuntimeContract } from '@/lib/plugin-runtime';
import type { PluginMenuDefinition, PluginRouteLayout } from '@ploykit/plugin-sdk';

function createPluginMenuHref(
  pluginId: string,
  localPath: string,
  layout?: PluginRouteLayout,
  publicAliasPath?: string
): string {
  if (publicAliasPath) {
    return publicAliasPath;
  }

  const normalizedPath = normalizeRuntimePath(localPath);
  const segments = [
    layout === 'dashboard-admin' ? 'admin' : '',
    'plugins',
    pluginId,
    ...normalizedPath.split('/').filter(Boolean),
  ].filter(Boolean);

  return `/${segments.join('/')}`;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function resolvePluginI18nKey(pluginId: string, key: string | undefined): string | undefined {
  const normalized = normalizeOptionalText(key);
  return normalized ? `${pluginId}.${normalized}` : undefined;
}

function mapPluginMenuItem(
  contract: PluginRuntimeContract,
  pluginId: string,
  item: PluginMenuDefinition,
  index: number
): MenuItem {
  const normalizedPath = normalizeRuntimePath(item.path);
  const route = contract.routes.pages.find(
    (page) =>
      page.path === normalizedPath ||
      page.publicAliases.some((alias) => alias.path === normalizedPath)
  );
  const publicAliasPath = route?.publicAliases.find((alias) => alias.path === normalizedPath)?.path;
  const labelKey = resolvePluginI18nKey(pluginId, item.labelKey);
  const groupTitleKey = resolvePluginI18nKey(pluginId, item.groupKey);
  const literalLabel = normalizeOptionalText(item.label);
  const fallbackLabel = normalizeOptionalText(item.fallbackLabel) ?? literalLabel;
  const group = normalizeOptionalText(item.group);

  return {
    id: `${pluginId}/${item.path}/${index}`,
    i18nKey: labelKey ?? `${pluginId}.menu.${index}`,
    label: labelKey ? undefined : literalLabel,
    fallbackLabel,
    href: createPluginMenuHref(pluginId, item.path, route?.layout, publicAliasPath),
    icon: item.icon,
    weight: item.weight,
    guard: route?.auth ?? 'auth',
    group,
    groupTitleKey,
    fallbackGroup: normalizeOptionalText(item.fallbackGroup) ?? group,
    _pluginId: pluginId,
  } as MenuItem;
}

/**
 *
 *
 */
export const loadPluginNavigation = cache(
  async (location?: keyof MenusByLocation): Promise<MenusByLocation> => {
    logger.debug({ location }, 'Loading plugin navigation');

    const installations = await pluginQueryService.listInstalledPlugins();
    const enabledPlugins = installations.filter((p) => p.enabled);

    logger.debug({ count: enabledPlugins.length }, 'Found enabled plugins');

    const allMenus: MenusByLocation = {};

    for (const plugin of enabledPlugins) {
      try {
        const contract = await pluginRuntimeRegistry.getOrLoad(plugin.pluginId);
        const menuItems = contract.menu;

        for (const [index, item] of menuItems.entries()) {
          const loc = item.location as keyof MenusByLocation;
          if (location && loc !== location) continue;

          if (!allMenus[loc]) {
            allMenus[loc] = [];
          }

          allMenus[loc].push(mapPluginMenuItem(contract, plugin.pluginId, item, index));
        }

        logger.debug({ pluginId: plugin.pluginId }, 'Loaded plugin navigation');
      } catch (error) {
        logger.error({ pluginId: plugin.pluginId, error }, 'Failed to load plugin navigation');
        // ProcessOtherPlugin
      }
    }

    for (const items of Object.values(allMenus)) {
      items?.sort((a: MenuItem, b: MenuItem) => (a.weight || 100) - (b.weight || 100));
    }

    logger.debug({ locations: Object.keys(allMenus) }, 'Plugin navigation loaded');

    return allMenus;
  }
);
