export type AdminCoverageTier = 'P0' | 'P1' | 'P2';

export type AdminPageResolver = 'first-user' | 'first-role' | 'first-plan' | 'sample-plugin';

export interface AdminPageCatalogEntry {
  id: string;
  sourcePath: string;
  routePattern: string;
  path: string;
  tier: AdminCoverageTier;
  title: string;
  resolver?: AdminPageResolver;
  smoke?: {
    redirectedTo?: string;
    expectedText?: string[];
  };
}

export const ADMIN_PAGES: readonly AdminPageCatalogEntry[] = [
  {
    id: 'admin.dashboard',
    sourcePath: 'src/app/[lang]/admin/page.tsx',
    routePattern: '/admin',
    path: '/en/admin',
    tier: 'P0',
    title: 'Admin Dashboard',
    smoke: { expectedText: ['System Status'] },
  },
  {
    id: 'admin.analytics',
    sourcePath: 'src/app/[lang]/admin/analytics/page.tsx',
    routePattern: '/admin/analytics',
    path: '/en/admin/analytics',
    tier: 'P1',
    title: 'Analytics',
  },
  {
    id: 'admin.audit-logs',
    sourcePath: 'src/app/[lang]/admin/audit-logs/page.tsx',
    routePattern: '/admin/audit-logs',
    path: '/en/admin/audit-logs',
    tier: 'P0',
    title: 'Audit Logs',
  },
  {
    id: 'admin.entitlements',
    sourcePath: 'src/app/[lang]/admin/entitlements/page.tsx',
    routePattern: '/admin/entitlements',
    path: '/en/admin/entitlements',
    tier: 'P0',
    title: 'Subscription Plans',
  },
  {
    id: 'admin.entitlements.detail',
    sourcePath: 'src/app/[lang]/admin/entitlements/[id]/page.tsx',
    routePattern: '/admin/entitlements/[id]',
    path: '/en/admin/entitlements/__PLAN_ID__',
    tier: 'P1',
    title: 'Plan Detail',
    resolver: 'first-plan',
  },
  {
    id: 'admin.files',
    sourcePath: 'src/app/[lang]/admin/files/page.tsx',
    routePattern: '/admin/files',
    path: '/en/admin/files',
    tier: 'P0',
    title: 'File Management',
  },
  {
    id: 'admin.operations',
    sourcePath: 'src/app/[lang]/admin/operations/page.tsx',
    routePattern: '/admin/operations',
    path: '/en/admin/operations',
    tier: 'P0',
    title: 'Operations Center',
  },
  {
    id: 'admin.plugins',
    sourcePath: 'src/app/[lang]/admin/plugins/page.tsx',
    routePattern: '/admin/plugins',
    path: '/en/admin/plugins',
    tier: 'P0',
    title: 'Plugin Management',
  },
  {
    id: 'admin.plugins.dev',
    sourcePath: 'src/app/[lang]/admin/plugins/dev/page.tsx',
    routePattern: '/admin/plugins/dev',
    path: '/en/admin/plugins/dev',
    tier: 'P1',
    title: 'Plugin Dev Console',
  },
  {
    id: 'admin.plugin-operations',
    sourcePath: 'src/app/[lang]/admin/plugin-operations/page.tsx',
    routePattern: '/admin/plugin-operations',
    path: '/en/admin/plugin-operations',
    tier: 'P0',
    title: 'Plugin Operations',
  },
  {
    id: 'admin.plugin-internal-services',
    sourcePath: 'src/app/[lang]/admin/plugin-internal-services/page.tsx',
    routePattern: '/admin/plugin-internal-services',
    path: '/en/admin/plugin-internal-services',
    tier: 'P0',
    title: 'Internal Services',
    smoke: { expectedText: ['Internal Services'] },
  },
  {
    id: 'admin.plugins.runtime',
    sourcePath: 'src/app/[lang]/admin/plugins/[pluginId]/[[...slug]]/page.tsx',
    routePattern: '/admin/plugins/[pluginId]/[[...slug]]',
    path: '/en/admin/plugins/__PLUGIN_ID__',
    tier: 'P1',
    title: 'Admin Plugin Runtime',
    resolver: 'sample-plugin',
  },
  {
    id: 'admin.rbac.redirect',
    sourcePath: 'src/app/[lang]/admin/rbac/page.tsx',
    routePattern: '/admin/rbac',
    path: '/en/admin/rbac',
    tier: 'P0',
    title: 'RBAC Redirect',
    smoke: { redirectedTo: '/en/admin/users?tab=rbac' },
  },
  {
    id: 'admin.rbac.detail',
    sourcePath: 'src/app/[lang]/admin/rbac/[id]/page.tsx',
    routePattern: '/admin/rbac/[id]',
    path: '/en/admin/rbac/__ROLE_ID__',
    tier: 'P0',
    title: 'Role Detail',
    resolver: 'first-role',
  },
  {
    id: 'admin.revenue',
    sourcePath: 'src/app/[lang]/admin/revenue/page.tsx',
    routePattern: '/admin/revenue',
    path: '/en/admin/revenue',
    tier: 'P1',
    title: 'Revenue',
  },
  {
    id: 'admin.search',
    sourcePath: 'src/app/[lang]/admin/search/page.tsx',
    routePattern: '/admin/search',
    path: '/en/admin/search',
    tier: 'P2',
    title: 'Search',
  },
  {
    id: 'admin.settings',
    sourcePath: 'src/app/[lang]/admin/settings/page.tsx',
    routePattern: '/admin/settings',
    path: '/en/admin/settings',
    tier: 'P0',
    title: 'System Settings',
  },
  {
    id: 'admin.settings.notifications',
    sourcePath: 'src/app/[lang]/admin/settings/notifications/page.tsx',
    routePattern: '/admin/settings/notifications',
    path: '/en/admin/settings/notifications',
    tier: 'P1',
    title: 'Notification Settings',
  },
  {
    id: 'admin.usage',
    sourcePath: 'src/app/[lang]/admin/usage/page.tsx',
    routePattern: '/admin/usage',
    path: '/en/admin/usage',
    tier: 'P0',
    title: 'Usage',
  },
  {
    id: 'admin.users',
    sourcePath: 'src/app/[lang]/admin/users/page.tsx',
    routePattern: '/admin/users',
    path: '/en/admin/users',
    tier: 'P0',
    title: 'Users',
  },
  {
    id: 'admin.users.detail',
    sourcePath: 'src/app/[lang]/admin/users/[id]/page.tsx',
    routePattern: '/admin/users/[id]',
    path: '/en/admin/users/__USER_ID__',
    tier: 'P0',
    title: 'User Detail',
    resolver: 'first-user',
  },
] as const;
