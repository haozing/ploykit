/**
 * System Dashboard Menu Configuration
 *
 * Centralized configuration for built-in dashboard navigation items.
 * Organized by navigation groups (myAccount, overview, management, operations, system).
 *
 * This file mirrors the architecture of site.config.ts for consistency.
 * All dashboard menu items should be configured here rather than hardcoded.
 */

import type { DashboardMenuItem } from '@/lib/ui/navigation/types';

/**
 * Menu items for "My Account" group
 * Available to all authenticated users
 */
export const MY_ACCOUNT_ITEMS: DashboardMenuItem[] = [
  {
    id: 'system-profile',
    i18nKey: 'dashboard.nav.profile',
    href: '/profile',
    icon: 'User',
    weight: 10,
    guard: 'auth',
    showInMenu: true,
  },
  {
    id: 'system-billing',
    i18nKey: 'dashboard.nav.billing',
    href: '/billing',
    icon: 'CreditCard',
    weight: 20,
    guard: 'auth',
    showInMenu: true,
  },
  {
    id: 'system-notification-preferences',
    i18nKey: 'dashboard.nav.notificationPreferences',
    href: '/settings/notifications',
    icon: 'Bell',
    weight: 30,
    guard: 'auth',
    showInMenu: true,
  },
  {
    id: 'system-plugin-tasks',
    i18nKey: 'dashboard.nav.pluginTasks',
    href: '/tasks',
    icon: 'ListChecks',
    weight: 35,
    guard: 'auth',
    showInMenu: true,
  },
  {
    id: 'system-admin-console',
    i18nKey: 'dashboard.nav.adminConsole',
    href: '/admin',
    icon: 'Shield',
    weight: 100,
    guard: 'admin',
    showInMenu: true,
  },
];

/**
 * Menu items for "Overview" group
 * Admin-only section
 */
export const OVERVIEW_ITEMS: DashboardMenuItem[] = [
  {
    id: 'system-dashboard',
    i18nKey: 'dashboard.nav.dashboard',
    href: '/admin',
    icon: 'LayoutDashboard',
    weight: 10,
    guard: 'admin',
    showInMenu: true,
  },
];

/**
 * Menu items for "Management" group
 * Admin-only section for user and plan management
 */
export const MANAGEMENT_ITEMS: DashboardMenuItem[] = [
  {
    id: 'system-users',
    i18nKey: 'dashboard.nav.users',
    href: '/admin/users',
    icon: 'Users',
    weight: 10,
    guard: 'admin',
    showInMenu: true,
  },
  {
    id: 'system-plans',
    i18nKey: 'dashboard.nav.plans',
    href: '/admin/entitlements',
    icon: 'Crown',
    weight: 20,
    guard: 'admin',
    showInMenu: true,
  },
];

/**
 * Menu items for "Operations" group
 * Admin-only section for analytics, plugins, and revenue
 */
export const OPERATIONS_ITEMS: DashboardMenuItem[] = [
  {
    id: 'system-analytics',
    i18nKey: 'dashboard.nav.analytics',
    href: '/admin/analytics',
    icon: 'BarChart3',
    weight: 10,
    guard: 'admin',
    showInMenu: true,
  },
  {
    id: 'system-plugins',
    i18nKey: 'dashboard.nav.plugins',
    href: '/admin/plugins',
    icon: 'Blocks',
    weight: 20,
    guard: 'admin',
    showInMenu: true,
  },
  {
    id: 'system-plugin-dev-console',
    i18nKey: 'dashboard.nav.pluginDevConsole',
    href: '/admin/plugins/dev',
    icon: 'Bug',
    weight: 25,
    guard: 'admin',
    showInMenu: true,
  },
  {
    id: 'system-plugin-operations',
    i18nKey: 'dashboard.nav.pluginOperations',
    href: '/admin/plugin-operations',
    icon: 'Workflow',
    weight: 27,
    guard: 'admin',
    showInMenu: true,
  },
  {
    id: 'system-plugin-internal-services',
    i18nKey: 'dashboard.nav.pluginInternalServices',
    href: '/admin/plugin-internal-services',
    icon: 'Network',
    weight: 28,
    guard: 'admin',
    showInMenu: true,
  },
  {
    id: 'system-revenue',
    i18nKey: 'dashboard.nav.revenue',
    href: '/admin/revenue',
    icon: 'DollarSign',
    weight: 30,
    guard: 'admin',
    showInMenu: true,
  },
  {
    id: 'system-operations-center',
    i18nKey: 'dashboard.nav.operationsCenter',
    href: '/admin/operations',
    icon: 'Activity',
    weight: 40,
    guard: 'admin',
    showInMenu: true,
  },
];

/**
 * Menu items for "System" group
 * Admin-only section for system settings
 */
export const SYSTEM_ITEMS: DashboardMenuItem[] = [
  {
    id: 'system-admin-settings',
    i18nKey: 'dashboard.nav.systemSettings',
    href: '/admin/settings',
    icon: 'Settings',
    weight: 10,
    guard: 'admin',
    showInMenu: true,
  },
];

/**
 * Complete system menu configuration
 * Maps group keys to their menu items
 */
export const SYSTEM_DASHBOARD_MENUS = {
  myAccount: MY_ACCOUNT_ITEMS,
  overview: OVERVIEW_ITEMS,
  management: MANAGEMENT_ITEMS,
  operations: OPERATIONS_ITEMS,
  system: SYSTEM_ITEMS,
} as const;
