/**
 * Navigation system type definitions
 *
 * Unified management of frontend and backend navigation configuration
 */

//
// Menu location types
//

/**
 * Menu display location
 *
 * - site.* = Frontend-related navigation
 * - dashboard.* = Backend-related navigation (shared by users and admins, differentiated by guard for permissions)
 */
export type MenuLocation =
  // Frontend menus
  | 'site.header' // Site header
  | 'site.footer' // Site footer
  | 'site.account' // User account menu (dropdown)

  // Backend menus (differentiate user/admin via guard)
  | 'dashboard.sidebar' // Dashboard sidebar
  | 'admin.sidebar' // Admin dashboard sidebar
  | 'dashboard.topbar'; // Dashboard top bar

//
// Navigation groups
//

/**
 * System built-in navigation groups
 * Includes dashboard namespace prefix to ensure translation system can find correctly
 */
export const SYSTEM_NAV_GROUPS = {
  // User area
  myAccount: 'dashboard.nav.myAccount',

  // Admin area
  overview: 'dashboard.nav.overview',
  management: 'dashboard.nav.management',
  operations: 'dashboard.nav.operations',
  system: 'dashboard.nav.system',
} as const;

/**
 * Navigation group type (system built-in + plugin custom)
 */
export type NavGroup = keyof typeof SYSTEM_NAV_GROUPS | string;

//
// Menu item types
//

/**
 * Base menu item configuration
 */
export interface BaseMenuItem {
  id: string; // Unique identifier
  pluginId?: string; // Owning plugin for plugin-provided menu items
  i18nKey: string; // Translation key
  label?: string; // Optional direct label for menu items
  fallbackLabel?: string; // Fallback when i18nKey is missing
  href: string; // Link path
  icon?: string; // Icon name (Lucide)
  weight?: number; // Sort weight (lower = higher priority, default: 100)
  guard?: 'public' | 'auth' | 'admin'; // Menu visibility control (public/auth/admin)
  visibility?: 'public' | 'signedIn' | 'admin' | 'workspaceMember' | 'suiteAdmin';
  requires?: {
    permissions?: readonly string[];
    workspaceRoles?: readonly ('owner' | 'admin' | 'editor' | 'viewer')[];
    entitlements?: readonly string[];
    serviceConnections?: readonly string[];
    resourceBindings?: readonly string[];
  };
  showInMenu?: boolean; // Whether to show in menu (default: true)
}

/**
 * Frontend menu item (site.*)
 * Frontend menu items have no additional fields, directly use BaseMenuItem
 */
export type SiteMenuItem = BaseMenuItem;

/**
 * Backend menu item (dashboard.*)
 */
export interface DashboardMenuItem extends BaseMenuItem {
  group?: NavGroup; // Navigation group
  groupTitleKey?: string; // Translation key for plugin-created custom groups
  fallbackGroup?: string; // Fallback title for plugin-created custom groups
  badge?: string; // Badge text
  badgeVariant?: 'default' | 'secondary' | 'destructive' | 'outline';
}

/**
 * Unified menu item type
 */
export type MenuItem = SiteMenuItem | DashboardMenuItem;

//
// Menu configuration
//

/**
 * Menus grouped by location (object structure, O(1) lookup)
 *
 * Advantages:
 * - O(1) lookup for menus at specific location
 * - Reduces location field repetition
 * - More precise type hints
 */
export interface MenusByLocation {
  'site.header'?: SiteMenuItem[];
  'site.footer'?: SiteMenuItem[];
  'site.account'?: SiteMenuItem[];
  'dashboard.sidebar'?: DashboardMenuItem[];
  'admin.sidebar'?: DashboardMenuItem[];
  'dashboard.topbar'?: DashboardMenuItem[];
}

//
// Navigation group configuration
//

/**
 * Navigation group (contains multiple menu items)
 *
 * Used for grouped rendering in backend sidebar
 */
export interface NavGroupConfig {
  key: string; // Group key
  titleKey: string; // Group title translation key
  fallbackTitle?: string; // Fallback title when titleKey is missing
  items: DashboardMenuItem[]; // Menu items
  adminOnly?: boolean; // Admin only
  weight?: number; // Sort weight
}
