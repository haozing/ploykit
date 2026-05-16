import { cache } from 'react';
import type { MenusByLocation, MenuItem } from './types';
import { logger } from '@/lib/_core/logger';
import { normalizeRuntimePath } from '@/lib/plugin-runtime';
import { runtimeScopeService } from '@/lib/plugin-runtime/scope';
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
    pluginId,
    i18nKey: labelKey ?? `${pluginId}.menu.${index}`,
    label: labelKey ? undefined : literalLabel,
    fallbackLabel,
    href: createPluginMenuHref(pluginId, item.path, route?.layout, publicAliasPath),
    icon: item.icon,
    weight: item.weight,
    guard: route?.auth ?? 'auth',
    visibility:
      item.visibility ??
      (item.location === 'admin.sidebar'
        ? 'admin'
        : item.location === 'dashboard.sidebar'
          ? 'signedIn'
          : route?.auth === 'admin'
            ? 'admin'
            : route?.auth === 'public'
              ? 'public'
              : 'signedIn'),
    requires: item.requires,
    group,
    groupTitleKey,
    fallbackGroup: normalizeOptionalText(item.fallbackGroup) ?? group,
  } as MenuItem;
}

export const loadPluginNavigation = cache(
  async (location?: keyof MenusByLocation): Promise<MenusByLocation> => {
    logger.debug({ location }, 'Loading plugin navigation');

    let runtimePlugins;

    try {
      runtimePlugins = await runtimeScopeService.getEnabledRuntimePlugins({
        surface: 'navigation',
      });
    } catch (error) {
      logger.warn(
        { location, error },
        'Plugin navigation is unavailable, rendering system navigation only'
      );
      return {};
    }

    logger.debug({ count: runtimePlugins.length }, 'Found runtime-scoped navigation plugins');

    const allMenus: MenusByLocation = {};

    for (const runtimePlugin of runtimePlugins) {
      const pluginId = runtimePlugin.pluginId;
      try {
        const contract = runtimePlugin.contract;
        const menuItems = contract.menu;

        for (const [index, item] of menuItems.entries()) {
          const loc = item.location as keyof MenusByLocation;
          if (location && loc !== location) continue;

          if (!allMenus[loc]) {
            allMenus[loc] = [];
          }

          allMenus[loc].push(mapPluginMenuItem(contract, pluginId, item, index));
        }

        logger.debug({ pluginId }, 'Loaded plugin navigation');
      } catch (error) {
        logger.error({ pluginId, error }, 'Failed to load plugin navigation');
      }
    }

    for (const items of Object.values(allMenus)) {
      items?.sort((a: MenuItem, b: MenuItem) => (a.weight || 100) - (b.weight || 100));
    }

    logger.debug({ locations: Object.keys(allMenus) }, 'Plugin navigation loaded');

    return allMenus;
  }
);
