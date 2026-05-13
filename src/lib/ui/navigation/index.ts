/**
 */

// Types
export type {
  MenuLocation,
  NavGroup,
  BaseMenuItem,
  SiteMenuItem,
  DashboardMenuItem,
  MenuItem,
  MenusByLocation,
  NavGroupConfig,
} from './types';

export { SYSTEM_NAV_GROUPS } from './types';

// Server-side loaders
export { loadPluginNavigation } from './plugin-nav-loader.server';
export { getSiteHeaderNavItems, getSiteFooterNavItems } from './site-nav.server';
export { getAdminSidebarNavGroups, getUserSidebarNavGroups } from './admin-nav.server';
