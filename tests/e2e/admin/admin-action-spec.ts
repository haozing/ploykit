import type { AdminInteractiveRole } from './admin-surface-report';

export interface AdminActionMatcher {
  role: AdminInteractiveRole;
  name?: string;
  namePattern?: string;
}

export interface AdminActionDefinition {
  id: string;
  description: string;
  matchers: readonly AdminActionMatcher[];
}

export interface AdminApiMatcher {
  id: string;
  method: string;
  path?: string;
  pathPattern?: string;
}

export interface AdminPageActionSpec {
  pageId: string;
  actions: readonly AdminActionDefinition[];
  apiRoutes: readonly AdminApiMatcher[];
  notes?: string;
}

function action(
  id: string,
  description: string,
  matchers: readonly AdminActionMatcher[]
): AdminActionDefinition {
  return { id, description, matchers };
}

function exact(role: AdminInteractiveRole, name: string): AdminActionMatcher {
  return { role, name };
}

function pattern(role: AdminInteractiveRole, namePattern: string): AdminActionMatcher {
  return { role, namePattern };
}

function api(id: string, method: string, path: string): AdminApiMatcher {
  return { id, method, path };
}

function apiPattern(id: string, method: string, pathPattern: string): AdminApiMatcher {
  return { id, method, pathPattern };
}

function tabs(...names: string[]): AdminActionDefinition {
  return action(
    'page.tabs',
    'Switch between the page-owned tab panels.',
    names.map((name) => exact('tab', name))
  );
}

function filters(...matchers: AdminActionMatcher[]): AdminActionDefinition {
  return action('page.filters', 'Change page-owned filters and query controls.', matchers);
}

export const COMMON_ADMIN_ACTIONS: readonly AdminActionDefinition[] = [
  action('chrome.notifications', 'Open the notification menu.', [
    pattern('button', '^\\d+Notifications$'),
    pattern('menuitem', '^High usage alert'),
    pattern('menuitem', '^New user registration'),
    pattern('menuitem', '^Plugin installed'),
    exact('menuitem', 'View all notifications'),
  ]),
  action('chrome.account', 'Open and use the account menu.', [
    pattern('button', '^SA.*admin@example\\.com$'),
    exact('menuitem', 'Profile'),
    exact('menuitem', 'Billing'),
    exact('menuitem', 'Logout'),
  ]),
  action('chrome.language', 'Switch the active locale.', [
    exact('button', 'Switch language'),
    exact('menuitem', '中文'),
    exact('menuitem', 'EN'),
  ]),
  action('chrome.theme', 'Switch the active color theme.', [
    exact('button', 'Toggle theme'),
    exact('menuitem', '💻System'),
    exact('menuitem', 'System'),
    exact('menuitem', 'Dark'),
    exact('menuitem', 'Light'),
  ]),
  action('chrome.admin-nav', 'Navigate between admin console sections.', [
    exact('link', 'PloyKit'),
    exact('link', 'Dashboard'),
    exact('link', 'Analytics'),
    exact('link', 'Operations Center'),
    exact('link', 'Plugin Dev Console'),
    exact('link', 'Plugin Operations'),
    exact('link', 'Service Connections'),
    exact('link', 'Plugins'),
    exact('link', 'Revenue'),
    exact('link', 'Subscription Plans'),
    exact('link', 'System Settings'),
    exact('link', 'Users'),
  ]),
  action('chrome.dashboard-nav', 'Navigate between user dashboard sections.', [
    exact('link', 'Admin Console'),
    exact('link', 'Billing & Subscription'),
    exact('link', 'Notification Preferences'),
    exact('link', 'Profile'),
    exact('link', 'Sample Internal'),
    exact('link', 'Task Center'),
  ]),
];

export const ADMIN_ACTION_SPECS: readonly AdminPageActionSpec[] = [
  {
    pageId: 'admin.dashboard',
    actions: [
      action('dashboard.loading-state', 'Surface dashboard loading controls while data hydrates.', [
        exact('button', 'ULoading...'),
      ]),
    ],
    apiRoutes: [
      api('dashboard.stats', 'GET', '/api/admin/dashboard/stats'),
      api('dashboard.recent-users', 'GET', '/api/admin/dashboard/recent-users'),
      api('dashboard.system-status', 'GET', '/api/admin/dashboard/system-status'),
    ],
  },
  {
    pageId: 'admin.analytics',
    actions: [
      action('analytics.refresh', 'Refresh analytics data.', [exact('button', 'Refresh')]),
      filters(
        exact('combobox', 'Last 30 days'),
        exact('combobox', 'All failure types'),
        exact('option', 'Last 7 days'),
        exact('option', 'Last 30 days'),
        exact('option', 'Last 90 days'),
        exact('option', 'Last 12 months')
      ),
      tabs('Overview', 'Revenue', 'Growth', 'Churn', 'Usage', 'Cohorts', 'Reliability'),
    ],
    apiRoutes: [
      api('analytics.dashboard', 'GET', '/api/admin/analytics/dashboard'),
      api('analytics.cohorts', 'GET', '/api/admin/analytics/cohorts'),
      api('analytics.reliability', 'GET', '/api/admin/analytics/reliability'),
    ],
  },
  {
    pageId: 'admin.audit-logs',
    actions: [
      action('audit.details', 'Open audit log detail.', [exact('button', 'Details')]),
      action('audit.export', 'Export audit logs.', [
        exact('button', 'Export CSV'),
        exact('button', 'Export JSON'),
      ]),
      action('audit.pagination', 'Page through audit logs.', [
        exact('button', 'Next'),
        exact('button', 'Previous'),
      ]),
      filters(
        exact('combobox', 'Action'),
        exact('combobox', 'All Actions'),
        exact('combobox', 'Resource'),
        exact('combobox', 'All Resources'),
        exact('combobox', 'Status'),
        exact('combobox', 'All Statuses'),
        exact('textbox', '')
      ),
      tabs('Logs', 'Statistics'),
    ],
    apiRoutes: [
      api('audit.logs', 'GET', '/api/admin/audit-logs'),
      api('audit.stats', 'GET', '/api/admin/audit-logs/stats'),
    ],
  },
  {
    pageId: 'admin.entitlements',
    actions: [
      action('entitlements.create-plan', 'Open create plan workflow.', [
        exact('button', 'Create Plan'),
      ]),
      action('entitlements.plan-menu', 'Open and use plan row actions.', [
        exact('button', 'Open menu'),
      ]),
      action('entitlements.pagination', 'Page through entitlement records.', [
        exact('button', 'Next'),
        exact('button', 'Previous'),
      ]),
      filters(exact('combobox', 'All Plans'), exact('combobox', 'All Status')),
      tabs('Subscription Plans', 'User Subscriptions', 'Usage Analytics'),
    ],
    apiRoutes: [
      api('entitlements.stats', 'GET', '/api/admin/entitlements/stats'),
      api('entitlements.plans', 'GET', '/api/admin/entitlements/plans'),
      api('entitlements.users', 'GET', '/api/admin/entitlements/users'),
      api('entitlements.usage', 'GET', '/api/admin/entitlements/usage'),
    ],
  },
  {
    pageId: 'admin.entitlements.detail',
    actions: [
      action('plan-detail.navigation', 'Navigate from plan detail to related views.', [
        exact('link', 'Back to Plans'),
        exact('link', 'Edit Plan'),
        exact('link', 'View Subscribers'),
      ]),
      tabs('Features & Limits', 'Settings'),
    ],
    apiRoutes: [
      api('plan-detail.list', 'GET', '/api/admin/entitlements/plans'),
      apiPattern('plan-detail.read', 'GET', '^/api/admin/entitlements/plans/[^/]+$'),
    ],
  },
  {
    pageId: 'admin.files',
    actions: [
      action('files.refresh', 'Refresh platform file list.', [exact('button', 'Refresh files')]),
      action('files.filters', 'Filter platform files.', [
        exact('button', 'Clear'),
        exact('textbox', ''),
        exact('textbox', 'Folder'),
        exact('textbox', 'MIME Type'),
        exact('textbox', 'Owner or Email'),
        exact('textbox', 'Provider'),
        exact('textbox', 'Uploaded From'),
        exact('textbox', 'Uploaded To'),
        exact('spinbutton', 'Max Size MB'),
        exact('spinbutton', 'Min Size MB'),
      ]),
      action('files.selection', 'Select files for bulk actions.', [
        exact('checkbox', 'Select all files'),
        pattern('checkbox', '^Select .+'),
      ]),
      action('files.bulk', 'Run platform file bulk actions.', [
        exact('button', 'Delete Selected'),
        exact('button', 'Retain Archive'),
        exact('button', 'Retain Delete'),
      ]),
      action('files.row-actions', 'Open and use per-file actions.', [
        pattern('button', '^File actions for .+'),
        exact('menuitem', 'Download'),
        exact('menuitem', 'Delete'),
      ]),
      action('files.pagination', 'Page through platform files.', [
        exact('button', 'Next'),
        exact('button', 'Previous'),
      ]),
    ],
    apiRoutes: [api('files.list', 'GET', '/api/admin/files')],
  },
  {
    pageId: 'admin.operations',
    actions: [
      action('operations.refresh', 'Refresh operational queues.', [exact('button', 'Refresh')]),
      action('operations.retry-webhooks', 'Retry webhook queue work.', [
        exact('button', 'Retry Webhooks'),
      ]),
      action('operations.outbox-row', 'Inspect or retry dead-lettered work.', [
        exact('button', 'Archive'),
        exact('button', 'Detail'),
        exact('button', 'Ignore'),
        exact('button', 'Replay'),
        exact('button', 'Retry'),
      ]),
      action('operations.outbox-selection', 'Select and bulk-handle dead-lettered work.', [
        exact('button', 'Archive Selected'),
        exact('button', 'Ignore Selected'),
        exact('button', 'Replay Selected'),
        exact('checkbox', 'Select all dead letters'),
        pattern('checkbox', '^Select dead letter .+'),
      ]),
      tabs('Outbox', 'Webhooks'),
    ],
    apiRoutes: [
      api('operations.dead-letters', 'GET', '/api/admin/outbox/dead-letters'),
      api('operations.webhooks', 'GET', '/api/admin/webhooks/retry'),
    ],
  },
  {
    pageId: 'admin.plugins',
    actions: [
      action('plugins.lifecycle-entry', 'Open plugin lifecycle actions.', [
        exact('button', 'Disable'),
        exact('button', 'Enable'),
        exact('button', ''),
      ]),
      action('plugins.disable-dialog', 'Confirm or cancel plugin lifecycle changes.', [
        pattern('alertdialog', '^Disable Plugin'),
        pattern('alertdialog', '^Enable Plugin'),
        pattern('alertdialog', '^Uninstall Plugin'),
        exact('button', 'Cancel'),
        exact('button', 'Confirm'),
        exact('button', 'Confirm Uninstall'),
      ]),
    ],
    apiRoutes: [api('plugins.list', 'GET', '/api/admin/plugins')],
  },
  {
    pageId: 'admin.plugins.dev',
    actions: [
      action('plugin-dev.copy', 'Copy plugin diagnostics from the dev console.', [
        exact('button', 'Copy diagnostics'),
        exact('button', 'Copy plugin diagnostics'),
      ]),
    ],
    apiRoutes: [],
  },
  {
    pageId: 'admin.plugin-operations',
    actions: [
      action('plugin-operations.refresh', 'Refresh plugin operation data.', [
        exact('button', 'Refresh'),
      ]),
      action('plugin-operations.cancel-run', 'Cancel a plugin run.', [exact('button', 'Cancel')]),
      tabs('Runs', 'Calls', 'Metering', 'Connectors'),
    ],
    apiRoutes: [
      api('plugin-operations.list', 'GET', '/api/admin/plugin-operations'),
      api('plugin-operations.connectors', 'GET', '/api/admin/plugin-operations/connectors'),
    ],
  },
  {
    pageId: 'admin.service-connections',
    actions: [
      action('service-connections.refresh', 'Refresh service connection requirements.', [
        exact('button', 'Refresh'),
      ]),
      action('service-connections.requirements', 'Configure missing service requirements.', [
        exact('button', 'Configure'),
      ]),
      action('service-connections.bindings', 'Operate existing service connections.', [
        exact('button', 'Disable'),
        exact('button', 'Edit'),
        exact('button', 'Rotate'),
        exact('button', 'Test'),
      ]),
      action('service-connections.editor', 'Edit and save a service connection.', [
        exact('button', 'Save Connection'),
        exact('combobox', 'global'),
        exact('combobox', 'none'),
        exact('combobox', 'plugin'),
        exact('combobox', 'None'),
        exact('combobox', 'GET'),
        exact('combobox', 'active'),
        exact('switch', ''),
        exact('textbox', ''),
      ]),
      filters(
        exact('combobox', 'All statuses'),
        exact('option', 'All statuses'),
        exact('option', 'Active'),
        exact('option', 'Disabled')
      ),
      action('service-connections.logs', 'Apply call log retention settings.', [
        exact('button', 'Apply Retention'),
      ]),
      tabs('Requirements', 'Connections', 'Editor', 'Logs'),
    ],
    apiRoutes: [
      api('service-connections.requirements', 'GET', '/api/admin/service-connections/requirements'),
      api('service-connections.bindings', 'GET', '/api/admin/service-connections'),
      api('service-connections.logs', 'GET', '/api/admin/service-connections/logs'),
      api('service-connections.upsert', 'POST', '/api/admin/service-connections'),
    ],
  },
  {
    pageId: 'admin.plugins.runtime',
    actions: [
      action('plugin-runtime.create-note', 'Invoke the sample admin plugin runtime action.', [
        exact('button', 'Create note'),
      ]),
    ],
    apiRoutes: [
      api('plugin-runtime.plugins-list', 'GET', '/api/admin/plugins'),
      api('plugin-runtime.service-connection', 'POST', '/api/admin/service-connections'),
      api('plugin-runtime.enable-sample', 'POST', '/api/admin/plugins/sample-internal/enable'),
    ],
  },
  {
    pageId: 'admin.rbac.redirect',
    actions: [
      action('rbac.roles', 'Create and manage roles from the RBAC tab.', [
        exact('button', 'Create Role'),
        exact('button', 'Open menu'),
        exact('menuitem', 'View Details'),
        exact('menuitem', 'Edit Role'),
        exact('menuitem', 'Duplicate Role'),
        exact('menuitem', 'View Assignments'),
        exact('menuitem', 'Delete Role'),
      ]),
      action('rbac.pagination', 'Page through RBAC records.', [
        exact('button', 'Next'),
        exact('button', 'Previous'),
      ]),
      tabs('Roles & Permissions', 'Users'),
    ],
    apiRoutes: [
      api('rbac.roles', 'GET', '/api/admin/roles'),
      api('rbac.role-stats', 'GET', '/api/admin/roles/stats'),
      api('rbac.users', 'GET', '/api/admin/users'),
      api('rbac.user-stats', 'GET', '/api/admin/users/stats'),
      apiPattern('rbac.avatar-files', 'GET', '^/api/admin/files/[^/]+$'),
    ],
  },
  {
    pageId: 'admin.rbac.detail',
    actions: [
      action('role-detail.navigation', 'Navigate from role detail to related role actions.', [
        exact('link', 'Back to Roles'),
        exact('button', 'Edit Role'),
        exact('button', 'Duplicate Role'),
        exact('button', 'View Assignments'),
      ]),
      tabs('Permissions (3)', 'Settings'),
    ],
    apiRoutes: [
      api('role-detail.roles', 'GET', '/api/admin/roles'),
      apiPattern('role-detail.read', 'GET', '^/api/admin/roles/[^/]+$'),
    ],
  },
  {
    pageId: 'admin.revenue',
    actions: [
      action('revenue.refresh', 'Refresh revenue analytics.', [exact('button', 'Refresh')]),
      filters(
        exact('combobox', '30 days'),
        exact('option', '7 days'),
        exact('option', '30 days'),
        exact('option', '90 days'),
        exact('option', '12 months')
      ),
    ],
    apiRoutes: [api('revenue.analytics', 'GET', '/api/admin/analytics/revenue')],
  },
  {
    pageId: 'admin.search',
    actions: [tabs('All', 'Users', 'Plugins', 'Roles')],
    apiRoutes: [],
  },
  {
    pageId: 'admin.settings',
    actions: [
      action('settings.save', 'Save global system settings.', [exact('button', 'Save')]),
      filters(
        exact('combobox', 'Default Locale'),
        exact('combobox', 'English'),
        exact('combobox', 'Provider'),
        exact('combobox', 'Log'),
        exact('combobox', 'Password Reset Delivery'),
        exact('combobox', 'Digest Frequency'),
        exact('combobox', 'Weekly'),
        exact('option', 'Chinese'),
        exact('option', 'English'),
        exact('option', 'Log'),
        exact('option', 'Resend'),
        exact('option', 'SMTP'),
        exact('option', 'Email'),
        exact('option', 'Daily'),
        exact('option', 'Never'),
        exact('option', 'Weekly'),
        exact('spinbutton', ''),
        exact('switch', ''),
        exact('textbox', '')
      ),
    ],
    apiRoutes: [api('settings.read', 'GET', '/api/admin/settings')],
  },
  {
    pageId: 'admin.settings.notifications',
    actions: [
      action('notification-settings.save', 'Save or reset notification preferences.', [
        exact('button', 'Save Settings'),
        exact('button', 'Reset'),
        exact('button', 'Send Test Notification'),
        exact('switch', ''),
      ]),
    ],
    apiRoutes: [],
  },
  {
    pageId: 'admin.usage',
    actions: [
      action('usage.refresh', 'Refresh usage analytics.', [exact('button', 'Refresh')]),
      action('usage.filters', 'Apply and clear usage filters.', [
        exact('button', 'Apply'),
        exact('button', 'Clear'),
        exact('combobox', '10'),
        exact('combobox', '30 days'),
        exact('option', '5'),
        exact('option', '10'),
        exact('option', '20'),
        exact('option', '50'),
        exact('option', '7 days'),
        exact('option', '30 days'),
        exact('option', '90 days'),
        exact('option', '365 days'),
        exact('textbox', ''),
      ]),
    ],
    apiRoutes: [api('usage.analytics', 'GET', '/api/admin/entitlements/usage')],
  },
  {
    pageId: 'admin.users',
    actions: [
      action('users.roles', 'Manage roles from the users console.', [
        exact('button', 'Create Role'),
        exact('button', 'Open menu'),
        exact('menuitem', 'View Details'),
        exact('menuitem', 'Edit Role'),
        exact('menuitem', 'Duplicate Role'),
        exact('menuitem', 'View Assignments'),
        exact('menuitem', 'Delete Role'),
      ]),
      action('users.pagination', 'Page through user and role lists.', [
        exact('button', 'Next'),
        exact('button', 'Previous'),
      ]),
      tabs('Users', 'Roles & Permissions'),
    ],
    apiRoutes: [
      api('users.list', 'GET', '/api/admin/users'),
      api('users.stats', 'GET', '/api/admin/users/stats'),
      api('users.roles', 'GET', '/api/admin/roles'),
      api('users.role-stats', 'GET', '/api/admin/roles/stats'),
      apiPattern('users.avatar-files', 'GET', '^/api/admin/files/[^/]+$'),
    ],
  },
  {
    pageId: 'admin.users.detail',
    actions: [
      action('user-detail.navigation', 'Navigate from user detail to related user actions.', [
        exact('link', 'Back to Users'),
        exact('link', 'Edit in Users List'),
        exact('link', 'Manage Roles'),
      ]),
      action('user-detail.roles', 'Refresh or revoke user roles.', [
        exact('button', 'Refresh Roles'),
        exact('button', 'Revoke Role'),
      ]),
      tabs('Overview', 'Roles & Permissions', 'Activity'),
    ],
    apiRoutes: [
      api('user-detail.users', 'GET', '/api/admin/users'),
      api('user-detail.roles', 'GET', '/api/admin/roles'),
      api('user-detail.role-stats', 'GET', '/api/admin/roles/stats'),
    ],
  },
];
