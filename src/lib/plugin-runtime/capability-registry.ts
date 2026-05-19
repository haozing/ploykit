import { Permission, type PermissionValue, type PluginTrustLevel } from '@ploykit/plugin-sdk';

export type HostCapabilityId =
  | 'storage'
  | 'hostPage.extend'
  | 'hostPage.override'
  | 'i18n'
  | 'seo'
  | 'navigation'
  | 'theme'
  | 'externalHttp'
  | 'connectors'
  | 'services'
  | 'files'
  | 'cache'
  | 'async'
  | 'commercialization';

export interface HostCapabilityDefinition {
  id: HostCapabilityId;
  contractKeys: readonly string[];
  permissions: readonly PermissionValue[];
  runtime: readonly string[];
  minTrust: PluginTrustLevel;
  adminActivation: boolean;
  doctorChecks: readonly string[];
  affects: readonly string[];
  dependsOn: readonly HostCapabilityId[];
}

export const HOST_CAPABILITIES = {
  storage: {
    id: 'storage',
    contractKeys: ['data.collections'],
    permissions: [Permission.StorageRead, Permission.StorageWrite],
    runtime: ['ctx.storage'],
    minTrust: 'untrusted',
    adminActivation: false,
    doctorChecks: ['storage-schema', 'storage-indexes', 'storage-migrations'],
    affects: ['database', 'resource-scope', 'testing'],
    dependsOn: [],
  },
  hostPageExtend: {
    id: 'hostPage.extend',
    contractKeys: ['hostPages.slots'],
    permissions: [Permission.HostPageExtend],
    runtime: ['ShellLayout', 'resolveHostPageSurface'],
    minTrust: 'trusted',
    adminActivation: false,
    doctorChecks: ['host-page-slot-policy', 'host-page-i18n'],
    affects: ['layout', 'navigation', 'i18n', 'seo'],
    dependsOn: ['i18n', 'navigation'],
  },
  hostPageOverride: {
    id: 'hostPage.override',
    contractKeys: ['hostPages.overrides'],
    permissions: [Permission.HostPageOverride],
    runtime: ['ShellLayout', 'resolveHostPageSurface', 'resolveHostPageMetadata'],
    minTrust: 'trusted',
    adminActivation: true,
    doctorChecks: ['host-page-conflict', 'host-page-seo', 'host-page-i18n'],
    affects: ['layout', 'navigation', 'i18n', 'seo', 'sitemap', 'cache'],
    dependsOn: ['i18n', 'seo', 'navigation'],
  },
  i18n: {
    id: 'i18n',
    contractKeys: ['resources.locales', 'hostPages.*.i18n'],
    permissions: [],
    runtime: ['PluginI18nRegistry', 'IntlMessagesProvider'],
    minTrust: 'untrusted',
    adminActivation: false,
    doctorChecks: ['i18n-resources', 'i18n-required-keys'],
    affects: ['navigation', 'seo', 'notifications', 'admin'],
    dependsOn: [],
  },
  seo: {
    id: 'seo',
    contractKeys: ['routes.tools.seo', 'publicAliases.seo', 'hostPages.overrides.seo'],
    permissions: [],
    runtime: ['PluginSeoRegistry', 'generateMetadata', 'sitemap'],
    minTrust: 'untrusted',
    adminActivation: false,
    doctorChecks: ['seo-metadata', 'seo-canonical', 'seo-locales'],
    affects: ['public-routes', 'host-pages', 'sitemap', 'cache'],
    dependsOn: ['i18n'],
  },
  navigation: {
    id: 'navigation',
    contractKeys: ['menu'],
    permissions: [Permission.NavigationExtend],
    runtime: ['loadPluginNavigation'],
    minTrust: 'untrusted',
    adminActivation: false,
    doctorChecks: ['navigation-paths', 'navigation-i18n'],
    affects: ['layout', 'i18n'],
    dependsOn: ['i18n'],
  },
  theme: {
    id: 'theme',
    contractKeys: ['theme.tokens'],
    permissions: [],
    runtime: ['resolvePluginThemeTokens'],
    minTrust: 'trusted',
    adminActivation: false,
    doctorChecks: ['theme-token-policy'],
    affects: ['layout', 'slots'],
    dependsOn: [],
  },
  externalHttp: {
    id: 'externalHttp',
    contractKeys: ['egress'],
    permissions: [Permission.ExternalHttp],
    runtime: ['ctx.http.fetch', 'egressGuard'],
    minTrust: 'untrusted',
    adminActivation: false,
    doctorChecks: ['egress-policy'],
    affects: ['security', 'audit'],
    dependsOn: [],
  },
  connectors: {
    id: 'connectors',
    contractKeys: ['ctx.connectors'],
    permissions: [
      Permission.ConnectorsRead,
      Permission.ConnectorsInvoke,
      Permission.ConnectorsManage,
    ],
    runtime: ['ctx.connectors'],
    minTrust: 'untrusted',
    adminActivation: false,
    doctorChecks: ['connector-policy', 'connector-secrets'],
    affects: ['egress', 'secrets', 'runs', 'metering'],
    dependsOn: ['externalHttp'],
  },
  services: {
    id: 'services',
    contractKeys: ['services'],
    permissions: [Permission.ServicesInvoke],
    runtime: ['ctx.services'],
    minTrust: 'trusted',
    adminActivation: true,
    doctorChecks: ['service-binding-policy', 'service-path-policy'],
    affects: ['database', 'security', 'audit'],
    dependsOn: [],
  },
  files: {
    id: 'files',
    contractKeys: ['ctx.files'],
    permissions: [Permission.FilesRead, Permission.FilesWrite, Permission.FilesPublish],
    runtime: ['ctx.files', 'plugin media routes'],
    minTrust: 'untrusted',
    adminActivation: false,
    doctorChecks: ['file-scope-policy', 'file-quota-policy', 'public-media-policy'],
    affects: ['storage', 'public-routes', 'cache', 'audit'],
    dependsOn: [],
  },
  cache: {
    id: 'cache',
    contractKeys: ['routes.*.cache', 'ctx.cache'],
    permissions: [Permission.CacheRevalidate],
    runtime: ['ctx.cache', 'route cache metadata'],
    minTrust: 'untrusted',
    adminActivation: false,
    doctorChecks: ['cache-tag-policy', 'revalidation-policy'],
    affects: ['public-routes', 'seo', 'cms'],
    dependsOn: [],
  },
  async: {
    id: 'async',
    contractKeys: ['jobs', 'events', 'webhooks'],
    permissions: [
      Permission.JobsEnqueue,
      Permission.JobsRegister,
      Permission.EventsEmit,
      Permission.EventsSubscribe,
      Permission.WebhookReceive,
    ],
    runtime: ['ctx.jobs', 'ctx.runs', 'ctx.events', 'ctx.webhooks'],
    minTrust: 'untrusted',
    adminActivation: false,
    doctorChecks: ['async-flow', 'webhook-policy', 'job-policy'],
    affects: ['runs', 'notifications', 'metering', 'admin'],
    dependsOn: [],
  },
  commercialization: {
    id: 'commercialization',
    contractKeys: ['meters', 'routes.*.commercial'],
    permissions: [
      Permission.MeteringWrite,
      Permission.CreditsRead,
      Permission.CreditsConsume,
      Permission.CreditsWrite,
      Permission.BillingRead,
      Permission.BillingWrite,
      Permission.CommerceRead,
      Permission.CommerceWrite,
    ],
    runtime: ['ctx.metering', 'ctx.credits', 'ctx.billing', 'ctx.commerce', 'commercialGate'],
    minTrust: 'untrusted',
    adminActivation: false,
    doctorChecks: ['meter-policy', 'commercial-route-policy'],
    affects: ['routes', 'runs', 'admin', 'audit'],
    dependsOn: ['async'],
  },
} as const satisfies Record<string, HostCapabilityDefinition>;

export function listHostCapabilities(): HostCapabilityDefinition[] {
  return Object.values(HOST_CAPABILITIES);
}

export function getHostCapability(id: HostCapabilityId): HostCapabilityDefinition | null {
  return listHostCapabilities().find((capability) => capability.id === id) ?? null;
}

export function listHostCapabilityImpact(id: HostCapabilityId): HostCapabilityDefinition[] {
  return listHostCapabilities().filter((capability) => capability.dependsOn.includes(id));
}
