import type { ModuleSurfaceMode } from '@ploykit/module-sdk';

export type HostPageArea = 'site' | 'auth' | 'dashboard' | 'admin' | 'dev';

export type HostPageReplacePolicy = 'open' | 'controlled' | 'disabled';

export type HostPageSlotResponsive = 'inline' | 'stack' | 'drawer';

export interface HostPageSlotDefinition {
  id: string;
  label: string;
  purpose: string;
  recommendedModes: readonly Exclude<ModuleSurfaceMode, 'replace'>[];
  defaultMaxContributions: number;
  responsive: HostPageSlotResponsive;
}

export interface HostPageRegistryEntry {
  id: string;
  surfaceId: `host.page:${string}`;
  area: HostPageArea;
  chrome: 'none' | 'site' | 'workspace' | 'admin';
  replacePolicy: HostPageReplacePolicy;
  slots: readonly string[];
}

export interface HostPageSlotRegistryEntry extends HostPageSlotDefinition {
  pageId: string;
  surfaceId: `host.page:${string}`;
  area: HostPageArea;
  chrome: HostPageRegistryEntry['chrome'];
}

export const HOST_PAGE_SLOT_DEFINITIONS = {
  hero: {
    id: 'hero',
    label: 'Hero',
    purpose: 'Primary page hero contribution before the default content.',
    recommendedModes: ['prepend', 'append'],
    defaultMaxContributions: 1,
    responsive: 'stack',
  },
  'header.actions': {
    id: 'header.actions',
    label: 'Header actions',
    purpose: 'Compact action controls near the page header.',
    recommendedModes: ['action'],
    defaultMaxContributions: 3,
    responsive: 'inline',
  },
  'main.before': {
    id: 'main.before',
    label: 'Main before',
    purpose: 'Banners, filters, notices, or summary panels before the main page body.',
    recommendedModes: ['prepend', 'append', 'panel'],
    defaultMaxContributions: 4,
    responsive: 'stack',
  },
  'main.after': {
    id: 'main.after',
    label: 'Main after',
    purpose: 'Follow-up panels or secondary content after the main page body.',
    recommendedModes: ['append', 'panel'],
    defaultMaxContributions: 4,
    responsive: 'stack',
  },
  'footer.before': {
    id: 'footer.before',
    label: 'Footer before',
    purpose: 'Low-priority site content before the footer.',
    recommendedModes: ['append', 'prepend'],
    defaultMaxContributions: 2,
    responsive: 'stack',
  },
  side: {
    id: 'side',
    label: 'Side panel',
    purpose: 'Supplemental panels that can collapse into a drawer on small screens.',
    recommendedModes: ['panel'],
    defaultMaxContributions: 2,
    responsive: 'drawer',
  },
  diagnostics: {
    id: 'diagnostics',
    label: 'Diagnostics',
    purpose: 'Developer diagnostics and release evidence panels.',
    recommendedModes: ['panel', 'append'],
    defaultMaxContributions: 6,
    responsive: 'stack',
  },
} as const satisfies Record<string, HostPageSlotDefinition>;

export const HOST_PAGE_REGISTRY = [
  sitePage('site.home', ['hero', 'header.actions', 'main.before', 'main.after', 'footer.before']),
  sitePage('site.pricing', ['header.actions', 'main.before', 'main.after']),
  sitePage('site.about', ['header.actions', 'main.before', 'main.after']),
  sitePage('site.contact', ['header.actions', 'main.before', 'main.after']),
  sitePage('site.docs', ['header.actions', 'main.before', 'main.after']),
  sitePage('site.privacy', ['main.before', 'main.after']),
  sitePage('site.terms', ['main.before', 'main.after']),
  sitePage('site.success', ['main.before', 'main.after']),
  authPage('auth.login'),
  authPage('auth.register'),
  authPage('auth.forgotPassword'),
  authPage('auth.resetPassword'),
  dashboardPage('dashboard.home', ['header.actions', 'main.before', 'main.after', 'side']),
  dashboardPage('dashboard.billing', ['header.actions', 'main.before', 'main.after', 'side']),
  dashboardPage('dashboard.credit-history', ['header.actions', 'main.before', 'main.after', 'side']),
  dashboardPage('dashboard.files', ['header.actions', 'main.before', 'main.after', 'side']),
  dashboardPage('dashboard.notifications', ['header.actions', 'main.before', 'main.after', 'side']),
  dashboardPage('dashboard.orders', ['header.actions', 'main.before', 'main.after', 'side']),
  dashboardPage('dashboard.profile', ['header.actions', 'main.before', 'main.after', 'side']),
  dashboardPage('dashboard.notification-settings', ['header.actions', 'main.before', 'main.after', 'side']),
  dashboardPage('dashboard.tasks', ['header.actions', 'main.before', 'main.after', 'side']),
  dashboardPage('dashboard.task-detail', ['header.actions', 'main.before', 'main.after', 'side']),
  dashboardPage('dashboard.workspaces', ['header.actions', 'main.before', 'main.after', 'side']),
  dashboardPage('dashboard.module-route', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.overview', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.analytics', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.audit', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.billing', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.entitlements', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.files', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.file-detail', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.modules', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.module-detail', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.module-route', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.rbac', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.revenue', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.runs', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.run-detail', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.search', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.service-connections', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.settings', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.usage', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.users', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.user-detail', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.webhooks', ['header.actions', 'main.before', 'main.after', 'side']),
  adminPage('admin.webhook-detail', ['header.actions', 'main.before', 'main.after', 'side']),
  {
    id: 'dev.console',
    surfaceId: 'host.page:dev.console',
    area: 'dev',
    chrome: 'admin',
    replacePolicy: 'disabled',
    slots: ['diagnostics'],
  },
] as const satisfies readonly HostPageRegistryEntry[];

function sitePage(id: string, slots: readonly string[]): HostPageRegistryEntry {
  return {
    id,
    surfaceId: `host.page:${id}`,
    area: 'site',
    chrome: 'site',
    replacePolicy: 'open',
    slots,
  };
}

function authPage(id: string): HostPageRegistryEntry {
  return {
    id,
    surfaceId: `host.page:${id}`,
    area: 'auth',
    chrome: 'none',
    replacePolicy: 'controlled',
    slots: ['main.before', 'main.after'],
  };
}

function dashboardPage(id: string, slots: readonly string[]): HostPageRegistryEntry {
  return {
    id,
    surfaceId: `host.page:${id}`,
    area: 'dashboard',
    chrome: 'workspace',
    replacePolicy: 'controlled',
    slots,
  };
}

function adminPage(id: string, slots: readonly string[]): HostPageRegistryEntry {
  return {
    id,
    surfaceId: `host.page:${id}`,
    area: 'admin',
    chrome: 'admin',
    replacePolicy: 'controlled',
    slots,
  };
}

export function getHostPageRegistryEntry(pageId: string): HostPageRegistryEntry | null {
  return HOST_PAGE_REGISTRY.find((entry) => entry.id === pageId) ?? null;
}

export function getHostPageSlotDefinition(slotId: string): HostPageSlotDefinition {
  return (
    HOST_PAGE_SLOT_DEFINITIONS[slotId as keyof typeof HOST_PAGE_SLOT_DEFINITIONS] ?? {
      id: slotId,
      label: slotId,
      purpose: 'Custom host page slot.',
      recommendedModes: ['append'],
      defaultMaxContributions: 1,
      responsive: 'stack',
    }
  );
}

export function listHostPageSlots(): HostPageSlotRegistryEntry[] {
  return HOST_PAGE_REGISTRY.flatMap((page) =>
    page.slots.map((slotId) => ({
      ...getHostPageSlotDefinition(slotId),
      pageId: page.id,
      surfaceId: getHostPageSlotSurfaceId(page.id, slotId),
      area: page.area,
      chrome: page.chrome,
    }))
  );
}

export function getHostPageSlotSurfaceId(pageId: string, slotId: string): `host.page:${string}` {
  return `host.page:${pageId}:${slotId}`;
}
