/**
 * Dashboard Navigation Server-side Loader
 *
 * Loads and manages navigation for dashboard sidebars.
 * Includes:
 * - User navigation (for regular users)
 * - Admin navigation (for administrators)
 * - Permission filtering and plugin integration.
 */

import { cache } from 'react';
import { loadPluginNavigation } from './plugin-nav-loader.server';
import type { NavGroupConfig, DashboardMenuItem } from './types';
import { SYSTEM_NAV_GROUPS } from './types';
import { logger } from '@/lib/_core/logger';
import { SYSTEM_DASHBOARD_MENUS } from '@/config/system-dashboard-menus';
import {
  listAdminResourceBindings,
  listServiceConnectionRequirements,
} from '@/lib/plugin-runtime/admin';
import { getPluginRuntimeMapEntry } from '@/lib/plugin-runtime/loader';
import { getRuntimeProductId } from '@/lib/plugin-runtime/product-id';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime/registry';
import { pluginQueryService } from '@/lib/plugins/plugin-query.server';
import type { PluginResourceBindingDefinition } from '@ploykit/plugin-sdk';

//
// Permission Check Helpers
//

/**
 * Check if a menu item is visible to the current user
 *
 * Checks:
 * - showInMenu flag
 * - guard permission (admin vs auth)
 *
 * @param item - Menu item to check
 * @param context - User context (isAdmin flag)
 * @returns true if item should be visible
 */
interface MenuVisibilityContext {
  isAdmin: boolean;
  permissions?: readonly string[];
  workspaceRole?: 'owner' | 'admin' | 'editor' | 'viewer';
  entitlements?: readonly string[];
}

function includesAll(
  required: readonly string[] | undefined,
  available: readonly string[] | undefined
) {
  if (!required?.length) {
    return true;
  }
  const availableSet = new Set(available ?? []);
  return required.every((item) => availableSet.has(item));
}

function isMenuItemVisible(item: DashboardMenuItem, context: MenuVisibilityContext): boolean {
  // Check showInMenu flag
  if (item.showInMenu === false) {
    return false;
  }

  // Check guard permission
  if (item.guard === 'admin' && !context.isAdmin) {
    return false;
  }

  if ((item.visibility === 'admin' || item.visibility === 'suiteAdmin') && !context.isAdmin) {
    return false;
  }

  if (!includesAll(item.requires?.permissions, context.permissions)) {
    return false;
  }
  if (!includesAll(item.requires?.entitlements, context.entitlements)) {
    return false;
  }
  if (
    item.requires?.workspaceRoles?.length &&
    (!context.workspaceRole || !item.requires.workspaceRoles.includes(context.workspaceRole))
  ) {
    return false;
  }

  return true;
}

function parsePluginIdFromMenu(item: DashboardMenuItem): string | undefined {
  return item.pluginId ?? item.id.split('/')[0];
}

async function servicesAreBound(pluginId: string, services: readonly string[]): Promise<boolean> {
  if (services.length === 0) {
    return true;
  }

  const requirements = await listServiceConnectionRequirements({ pluginId });
  const boundServices = new Set(
    requirements
      .filter((requirement) => requirement.connectionStatus === 'bound')
      .map((requirement) => requirement.serviceName)
  );
  return services.every((service) => boundServices.has(service));
}

async function resolveResourceBindingOwner(
  pluginId: string,
  declaration: PluginResourceBindingDefinition
): Promise<{
  productId: string;
  ownerType: 'plugin' | 'suite' | 'product';
  ownerId: string;
} | null> {
  const productId = getRuntimeProductId();
  const ownerType = declaration.owner ?? 'plugin';
  const installation =
    ownerType === 'suite'
      ? await pluginQueryService.getInstallation(pluginId, { productId })
      : null;
  const ownerId =
    ownerType === 'plugin' ? pluginId : ownerType === 'suite' ? installation?.suiteId : productId;

  return ownerId ? { productId, ownerType, ownerId } : null;
}

async function resourceBindingsAreBound(
  pluginId: string,
  resourceTypes: readonly string[]
): Promise<boolean> {
  if (resourceTypes.length === 0) {
    return true;
  }

  const entry = getPluginRuntimeMapEntry(pluginId);
  const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);

  for (const resourceType of resourceTypes) {
    const declarations = contract.resourceBindings.filter(
      (binding) => binding.type === resourceType
    );
    if (declarations.length === 0) {
      return false;
    }

    let hasActiveBinding = false;
    for (const declaration of declarations) {
      const owner = await resolveResourceBindingOwner(pluginId, declaration);
      if (!owner) {
        continue;
      }
      const rows = await listAdminResourceBindings({
        ...owner,
        resourceType,
        status: 'active',
        limit: 1,
      });
      if (rows.length > 0) {
        hasActiveBinding = true;
        break;
      }
    }

    if (!hasActiveBinding) {
      return false;
    }
  }

  return true;
}

async function areRuntimeMenuRequirementsSatisfied(item: DashboardMenuItem): Promise<boolean> {
  const services = item.requires?.serviceConnections ?? [];
  const resources = item.requires?.resourceBindings ?? [];
  if (services.length === 0 && resources.length === 0) {
    return true;
  }

  const pluginId = parsePluginIdFromMenu(item);
  if (!pluginId) {
    return false;
  }

  try {
    return (
      (await servicesAreBound(pluginId, services)) &&
      (await resourceBindingsAreBound(pluginId, resources))
    );
  } catch (error) {
    logger.warn({ pluginId, menuId: item.id, error }, 'Plugin menu requirements are not satisfied');
    return false;
  }
}

async function filterVisibleMenuItems(
  items: DashboardMenuItem[],
  context: MenuVisibilityContext
): Promise<DashboardMenuItem[]> {
  const checks = await Promise.all(
    items.map(
      async (item) => isMenuItemVisible(item, context) && areRuntimeMenuRequirementsSatisfied(item)
    )
  );
  return items.filter((_, index) => checks[index]);
}

/**
 * Check if a navigation group is visible to the current user
 *
 * Checks:
 * - adminOnly flag
 * - group has at least one item
 *
 * @param group - Navigation group to check
 * @param context - User context (isAdmin flag)
 * @returns true if group should be visible
 */
function isGroupVisible(group: NavGroupConfig, context: { isAdmin: boolean }): boolean {
  // Check adminOnly restriction
  if (group.adminOnly && !context.isAdmin) {
    return false;
  }

  // Check if group is empty
  if (group.items.length === 0) {
    return false;
  }

  return true;
}

function createPluginNavGroup(
  groupKey: string,
  item: DashboardMenuItem,
  adminOnly: boolean
): NavGroupConfig {
  return {
    key: groupKey,
    titleKey: item.groupTitleKey || `nav.${groupKey}`,
    fallbackTitle: item.fallbackGroup || groupKey,
    items: [],
    adminOnly,
    weight: 100,
  };
}

//
// System Navigation Groups Configuration
//

/**
 * System built-in navigation groups
 */
const SYSTEM_NAV_GROUP_CONFIGS: NavGroupConfig[] = [
  {
    key: 'myAccount',
    titleKey: SYSTEM_NAV_GROUPS.myAccount,
    items: [],
    adminOnly: false,
    weight: 10,
  },
  {
    key: 'overview',
    titleKey: SYSTEM_NAV_GROUPS.overview,
    items: [],
    adminOnly: true,
    weight: 20,
  },
  {
    key: 'management',
    titleKey: SYSTEM_NAV_GROUPS.management,
    items: [],
    adminOnly: true,
    weight: 30,
  },
  {
    key: 'operations',
    titleKey: SYSTEM_NAV_GROUPS.operations,
    items: [],
    adminOnly: true,
    weight: 40,
  },
  {
    key: 'system',
    titleKey: SYSTEM_NAV_GROUPS.system,
    items: [],
    adminOnly: true,
    weight: 50,
  },
];

/**
 * Get admin sidebar navigation groups
 *
 * Returns all navigation groups for the admin dashboard.
 * This function assumes admin context (isAdmin = true) since
 * it should only be called from admin layouts after requireAdmin() check.
 *
 * @returns Navigation groups for admin sidebar
 */
export const getAdminSidebarNavGroups = cache(async (): Promise<NavGroupConfig[]> => {
  const isAdmin = true; // Always true in admin context
  logger.debug({ isAdmin }, 'Loading admin sidebar navigation');

  // 1. Copy system group configuration
  const groups = new Map<string, NavGroupConfig>(
    SYSTEM_NAV_GROUP_CONFIGS.map((g) => [g.key, { ...g, items: [] }])
  );

  // 2. Load system menu items from configuration (skip myAccount for admin sidebar)
  for (const [groupKey, items] of Object.entries(SYSTEM_DASHBOARD_MENUS)) {
    // Skip myAccount group - these are user-facing pages (profile, billing, settings)
    // that should not appear in the admin dashboard sidebar
    if (groupKey === 'myAccount') {
      continue;
    }
    const group = groups.get(groupKey);
    if (group) {
      group.items.push(...items);
    } else {
      logger.warn({ groupKey }, 'System menu group not found in configuration');
    }
  }

  // 3. Load plugin navigation and filter by visibility
  const pluginMenus = await loadPluginNavigation();
  const pluginNavs = [
    ...(pluginMenus['dashboard.sidebar'] || []),
    ...(pluginMenus['admin.sidebar'] || []),
  ];

  // Admin sidebar accepts explicit admin.sidebar items plus admin-relevant dashboard.sidebar items.
  const visiblePluginNavs = (await filterVisibleMenuItems(pluginNavs, { isAdmin })).filter(
    (item) => item.guard === 'admin' || item.href.startsWith('/admin')
  );

  logger.debug(
    { total: pluginNavs.length, visible: visiblePluginNavs.length },
    'Filtered plugin navigation'
  );

  for (const item of visiblePluginNavs) {
    const groupKey = item.group || 'operations';

    // Skip myAccount group items - these are user-facing pages
    // that should not appear in the admin dashboard sidebar
    if (groupKey === 'myAccount') {
      continue;
    }

    if (!groups.has(groupKey)) {
      logger.warn({ groupKey, menuId: item.id }, 'Unknown nav group, creating default group');
      groups.set(groupKey, createPluginNavGroup(groupKey, item, true));
    }

    groups.get(groupKey)!.items.push(item);
  }

  // 4. Sort items within each group
  for (const group of groups.values()) {
    group.items.sort((a, b) => (a.weight || 100) - (b.weight || 100));
  }

  // 5. Filter and sort visible groups
  const visibleGroups = Array.from(groups.values())
    .filter((group) => isGroupVisible(group, { isAdmin }))
    .sort((a, b) => (a.weight || 100) - (b.weight || 100));

  logger.debug({ groupCount: visibleGroups.length }, 'Admin sidebar navigation loaded');

  return visibleGroups;
});

/**
 * Get user sidebar navigation groups
 *
 * Returns only the myAccount group for the user dashboard.
 * This is used in the user dashboard (profile, billing, settings).
 * Also loads plugin-registered menu items for the myAccount group.
 *
 * @param isAdmin - Whether the current user is an admin (for showing admin console entry)
 * @returns Navigation groups for user sidebar
 */
export const getUserSidebarNavGroups = cache(
  async (isAdmin: boolean = false): Promise<NavGroupConfig[]> => {
    logger.debug({ isAdmin }, 'Loading user sidebar navigation');

    // User sidebar is primarily "My Account".
    const groups = new Map<string, NavGroupConfig>();

    // 1) Built-in user group
    const myAccountGroup: NavGroupConfig = {
      key: 'myAccount',
      titleKey: SYSTEM_NAV_GROUPS.myAccount,
      items: [],
      adminOnly: false,
      weight: 10,
    };
    groups.set('myAccount', myAccountGroup);

    // Add system items for myAccount (admin console entry included for admins only)
    myAccountGroup.items.push(...(SYSTEM_DASHBOARD_MENUS.myAccount || []));

    // 2) Plugin menu items (user-visible only; admin plugin items stay in admin sidebar)
    const pluginMenus = await loadPluginNavigation('dashboard.sidebar');
    const pluginNavs = pluginMenus['dashboard.sidebar'] || [];

    const visiblePluginNavs = await filterVisibleMenuItems(pluginNavs, { isAdmin: false });
    for (const item of visiblePluginNavs) {
      const groupKey = item.group || 'myAccount';

      if (!groups.has(groupKey)) {
        groups.set(groupKey, createPluginNavGroup(groupKey, item, false));
      }

      groups.get(groupKey)?.items.push(item);
    }

    logger.debug(
      {
        systemMyAccountItems: SYSTEM_DASHBOARD_MENUS.myAccount?.length || 0,
        pluginItemsTotal: pluginNavs.length,
        pluginItemsVisibleToUser: visiblePluginNavs.length,
        groupCount: groups.size,
      },
      'Loaded user sidebar navigation groups'
    );

    // 3) Filter myAccount items by actual user context (keeps admin console entry for admins)
    myAccountGroup.items = myAccountGroup.items.filter((item) =>
      isMenuItemVisible(item, { isAdmin })
    );

    // 4) Sort items within each group
    for (const group of groups.values()) {
      group.items.sort((a, b) => (a.weight || 100) - (b.weight || 100));
    }

    // 5) Return visible groups (user sidebar never shows adminOnly groups)
    const visibleGroups = Array.from(groups.values())
      .filter((group) => group.key === 'myAccount' || !group.adminOnly)
      .filter((group) => group.items.length > 0)
      .sort((a, b) => (a.weight || 100) - (b.weight || 100));

    logger.debug({ groupCount: visibleGroups.length, isAdmin }, 'User sidebar navigation loaded');

    return visibleGroups;
  }
);
