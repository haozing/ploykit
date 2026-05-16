import type { PluginContext } from './context';
import type { PermissionValue } from './permissions';
import type { PluginDataDefinition } from './storage';

export type PluginKind = 'app' | 'tool' | 'service' | 'theme' | 'connector';
export type PluginTrustLevel = 'untrusted' | 'trusted' | 'system';
export type PluginRouteAuth = 'public' | 'auth' | 'admin';
export type PluginRouteMachineAuth = 'apiKey';
export type PluginRouteLayout = 'site' | 'dashboard' | 'dashboard-admin';
export type PluginHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type PluginRobotsIndex = boolean | 'index' | 'noindex';
export type PluginRobotsFollow = boolean | 'follow' | 'nofollow';
export type PluginToolCacheStrategy = 'none' | 'public' | 'private';
export type PluginAnonymousCaptchaPolicy = 'never' | 'auto' | 'always';
export type PluginAnonymousRateLimitBucket = 'ip' | 'userAgent' | 'route' | 'plugin' | 'method';
export type PluginSitemapChangeFrequency =
  | 'always'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'yearly'
  | 'never';

export interface PluginCommercialRequirement {
  license?: string;
  plan?: string;
  purchaseUrl?: string;
}

export interface PluginRuntimePageRouteProps {
  path: string;
  auth: PluginRouteAuth;
  layout: PluginRouteLayout;
  permissions: readonly PermissionValue[];
  commercial?: PluginCommercialRequirement;
  publicAliases?: readonly PluginPublicRouteAlias[];
  tool?: PluginToolRouteRuntimeMetadata;
}

export interface PluginRuntimePageProps {
  pluginId: string;
  localPath: string;
  requestPath: string;
  locale: string;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  assets: Record<string, string>;
  route: PluginRuntimePageRouteProps;
}

export interface PluginPageRoute {
  path: string;
  component: string;
  auth?: PluginRouteAuth;
  layout?: PluginRouteLayout;
  permissions?: readonly PermissionValue[];
  commercial?: PluginCommercialRequirement;
  publicAliases?: readonly PluginPublicRouteAliasDeclaration[];
}

export interface PluginOpenGraphMetadata {
  title?: string;
  description?: string;
  image?: string;
  type?: 'website' | 'article' | string;
}

export interface PluginToolSeoLocalizedMetadata {
  title?: string;
  description?: string;
  canonical?: string;
  openGraph?: PluginOpenGraphMetadata;
}

export interface PluginToolSeoMetadata extends PluginToolSeoLocalizedMetadata {
  robots?: {
    index?: PluginRobotsIndex;
    follow?: PluginRobotsFollow;
  };
  structuredData?: Record<string, unknown> | readonly Record<string, unknown>[];
  locales?: Record<string, PluginToolSeoLocalizedMetadata>;
}

export interface PluginToolSitemapDefinition {
  include?: boolean;
  lastModified?: string | Date;
  changeFrequency?: PluginSitemapChangeFrequency;
  priority?: number;
}

export interface PluginToolCacheDefinition {
  strategy: PluginToolCacheStrategy;
  maxAgeSeconds?: number;
  staleWhileRevalidateSeconds?: number;
}

export interface PluginAnonymousRateLimitDefinition {
  bucket: PluginAnonymousRateLimitBucket | readonly PluginAnonymousRateLimitBucket[];
  limit: number;
  window: string;
}

export interface PluginAnonymousPolicy {
  rateLimit?: PluginAnonymousRateLimitDefinition;
  maxUploadBytes?: number;
  captcha?: PluginAnonymousCaptchaPolicy;
  allowHighCostActions?: boolean;
}

export interface PluginPublicRouteAlias {
  path: string;
  seo?: PluginToolSeoMetadata;
  sitemap?: PluginToolSitemapDefinition;
}

export type PluginPublicRouteAliasDeclaration = string | PluginPublicRouteAlias;

export interface PluginToolRoute {
  path: string;
  component: string;
  auth?: Extract<PluginRouteAuth, 'public' | 'auth'>;
  permissions?: readonly PermissionValue[];
  commercial?: PluginCommercialRequirement;
  publicAliases?: readonly PluginPublicRouteAliasDeclaration[];
  seo: PluginToolSeoMetadata;
  sitemap?: PluginToolSitemapDefinition;
  cache?: PluginToolCacheDefinition;
  anonymousPolicy?: PluginAnonymousPolicy;
}

export interface PluginToolRouteRuntimeMetadata {
  path: string;
  seo: PluginToolSeoMetadata;
  sitemap?: PluginToolSitemapDefinition;
  cache?: PluginToolCacheDefinition;
  anonymousPolicy?: PluginAnonymousPolicy;
}

export type PluginHostPageSlotPosition =
  | 'hero.before'
  | 'hero.after'
  | 'main.before'
  | 'main.after'
  | 'main.replace';

export type PluginHostPageOverrideMode = 'main.replace';
export type PluginHostPageShellLayout = 'site';
export type PluginHostPageShellChrome = 'host' | 'hidden';
export type PluginHostPageShellContainer = 'fixed' | 'fluid' | 'full';

export interface PluginHostPageShellDefinition {
  layout?: PluginHostPageShellLayout;
  header?: PluginHostPageShellChrome;
  footer?: PluginHostPageShellChrome;
  container?: PluginHostPageShellContainer;
  activeMenuPath?: string;
}

export interface PluginHostPageOpenGraphMetadata {
  titleKey?: string;
  descriptionKey?: string;
  image?: string;
  type?: 'website' | 'article' | string;
}

export interface PluginHostPageSeoDefinition {
  titleKey: string;
  descriptionKey: string;
  canonical: string;
  fallbackTitle?: string;
  fallbackDescription?: string;
  robots?: {
    index?: PluginRobotsIndex;
    follow?: PluginRobotsFollow;
  };
  openGraph?: PluginHostPageOpenGraphMetadata;
  structuredData?: Record<string, unknown> | readonly Record<string, unknown>[];
  sitemap?: PluginToolSitemapDefinition;
}

export interface PluginHostPageI18nDefinition {
  namespaces?: readonly string[];
  requiredLocales: readonly string[];
}

export interface PluginHostPageCacheDefinition {
  strategy: PluginToolCacheStrategy;
  maxAgeSeconds?: number;
  staleWhileRevalidateSeconds?: number;
}

export interface PluginHostPageSlotDefinition {
  page: string;
  position: PluginHostPageSlotPosition;
  component: string;
  priority?: number;
}

export interface PluginHostPageOverrideDefinition {
  page: string;
  mode: PluginHostPageOverrideMode;
  component: string;
  priority?: number;
  shell?: PluginHostPageShellDefinition;
  seo: PluginHostPageSeoDefinition;
  i18n: PluginHostPageI18nDefinition;
  cache?: PluginHostPageCacheDefinition;
}

export interface PluginHostPagesDefinition {
  slots?: readonly PluginHostPageSlotDefinition[];
  overrides?: readonly PluginHostPageOverrideDefinition[];
}

export interface PluginApiRoute {
  path: string;
  handler: string;
  auth?: PluginRouteAuth;
  machineAuth?: PluginRouteMachineAuth;
  methods?: readonly PluginHttpMethod[];
  permissions?: readonly PermissionValue[];
  commercial?: PluginCommercialRequirement;
  anonymousPolicy?: PluginAnonymousPolicy;
}

export interface PluginRoutesDefinition {
  pages?: readonly PluginPageRoute[];
  tools?: readonly PluginToolRoute[];
  apis?: readonly PluginApiRoute[];
}

export interface PluginMenuDefinition {
  location: 'site.header' | 'site.footer' | 'site.account' | 'dashboard.sidebar' | 'admin.sidebar';
  /** Direct menu label. Prefer labelKey + fallbackLabel when the plugin declares locale resources. */
  label?: string;
  /** Plugin-local i18n key. The host resolves it as `${pluginId}.${labelKey}`. */
  labelKey?: string;
  /** Displayed when labelKey cannot be translated. */
  fallbackLabel?: string;
  icon?: string;
  path: string;
  group?: string;
  /** Plugin-local i18n key for custom dashboard sidebar groups. */
  groupKey?: string;
  /** Displayed when groupKey cannot be translated. */
  fallbackGroup?: string;
  weight?: number;
}

export const PLUGIN_SLOT_NAMES = [
  'header:logo',
  'header:nav',
  'header:extra',
  'header:before',
  'header:after',
  'header:logo-before',
  'header:logo-after',
  'header:nav-before',
  'header:nav-after',
  'header:actions-before',
  'header:actions-after',
  'footer:copyright',
  'footer:links',
  'footer:content',
  'footer:extra',
  'footer:before',
  'footer:after',
  'footer:links-before',
  'footer:links-after',
  'site.home:hero.before',
  'site.home:hero.after',
  'site.home:main.before',
  'site.home:main.after',
  'site.home:main.replace',
  'site.about:hero.before',
  'site.about:hero.after',
  'site.about:main.before',
  'site.about:main.after',
  'site.about:main.replace',
  'site.pricing:hero.before',
  'site.pricing:hero.after',
  'site.pricing:main.before',
  'site.pricing:main.after',
  'site.pricing:main.replace',
  'site.contact:hero.before',
  'site.contact:hero.after',
  'site.contact:main.before',
  'site.contact:main.after',
  'site.contact:main.replace',
  'site.privacy:hero.before',
  'site.privacy:hero.after',
  'site.privacy:main.before',
  'site.privacy:main.after',
  'site.privacy:main.replace',
  'site.terms:hero.before',
  'site.terms:hero.after',
  'site.terms:main.before',
  'site.terms:main.after',
  'site.terms:main.replace',
  'site.success:hero.before',
  'site.success:hero.after',
  'site.success:main.before',
  'site.success:main.after',
  'site.success:main.replace',
  'main:before',
  'main:after',
  'content:before',
  'content:after',
  'sidebar:left',
  'sidebar:right',
  'head:meta',
  'head:scripts',
  'body:start',
  'body:end',
] as const;

export type PluginBuiltInSlotName = (typeof PLUGIN_SLOT_NAMES)[number];
export type PluginRouteSlotPosition = 'main.before' | 'main.after' | 'main.replace';
export type PluginRouteSlotName = `route:/${string}:${PluginRouteSlotPosition}`;
export type PluginSlotName = PluginBuiltInSlotName | PluginRouteSlotName;

export const VALID_PLUGIN_SLOT_NAMES: ReadonlySet<string> = new Set<string>(PLUGIN_SLOT_NAMES);

export const PLUGIN_ROUTE_SLOT_POSITIONS = [
  'main.before',
  'main.after',
  'main.replace',
] as const satisfies readonly PluginRouteSlotPosition[];

export function parsePluginRouteSlotName(
  slotName: string
): { path: string; position: PluginRouteSlotPosition } | null {
  for (const position of PLUGIN_ROUTE_SLOT_POSITIONS) {
    const suffix = `:${position}`;
    if (!slotName.startsWith('route:/') || !slotName.endsWith(suffix)) {
      continue;
    }

    const path = slotName.slice('route:'.length, -suffix.length);
    if (!path.startsWith('/') || path.includes('//') || path.length === 0) {
      return null;
    }

    return { path, position };
  }

  return null;
}

export function isPluginRouteSlotName(slotName: string): slotName is PluginRouteSlotName {
  return parsePluginRouteSlotName(slotName) !== null;
}

export function isValidPluginSlotName(slotName: string): slotName is PluginSlotName {
  return VALID_PLUGIN_SLOT_NAMES.has(slotName) || isPluginRouteSlotName(slotName);
}

export interface PluginSlotComponentDefinition {
  component: string;
  priority?: number;
}

export type PluginSlotDeclaration = string | PluginSlotComponentDefinition;

export type PluginSlotsDefinition = Partial<
  Record<PluginSlotName, PluginSlotDeclaration | readonly PluginSlotDeclaration[]>
>;

export interface PluginLifecycle {
  install?: string;
  enable?: string;
  disable?: string;
  uninstall?: string;
  upgrade?: string;
}

export interface PluginEventDefinition {
  publishes?: readonly string[];
  subscribes?: Record<string, string>;
}

export interface PluginJobDefinition {
  handler: string;
  schedule?: string;
  timeoutMs?: number;
  retries?: number;
}

export type PluginWebhookSignaturePolicy = 'none' | 'hmac-sha256' | 'stripe' | 'github';

export interface PluginWebhookDefinition {
  path: string;
  handler: string;
  methods?: readonly PluginHttpMethod[];
  signature?: PluginWebhookSignaturePolicy;
}

export interface PluginHookDefinition {
  handler: string;
  priority?: number;
}

export interface PluginHooksDefinition {
  renderHead?: PluginHookDefinition;
  sitemap?: PluginHookDefinition;
}

export interface PluginHeadTag {
  tag: 'meta' | 'link' | 'script' | 'style' | 'title';
  attrs?: Record<string, string>;
  content?: string;
  priority?: number;
}

export interface PluginRenderHeadPayload {
  url: string;
  pathname: string;
}

export interface PluginSitemapPayload {
  baseUrl: string;
}

export interface PluginSitemapEntry {
  url: string;
  lastModified?: string | Date;
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
  alternates?: {
    languages?: Record<string, string>;
  };
}

export interface PluginConfigDefinition {
  schema?: unknown;
  defaults?: Record<string, unknown>;
  component?: string;
}

export type PluginAssetKind = 'asset' | 'worker' | 'wasm';

export interface PluginAssetDeclaration {
  path: string;
  kind?: PluginAssetKind;
  contentType?: string;
  maxBytes?: number;
  cache?: PluginToolCacheDefinition;
}

export interface PluginResourcesDefinition {
  locales?: Record<string, string>;
  assets?: readonly (string | PluginAssetDeclaration)[];
}

export interface PluginThemeTokenOverrides {
  common?: Partial<{
    colorBg: string;
    colorText: string;
    colorPrimary: string;
    colorPrimaryText: string;
    radius: string;
    containerMaxW: string;
  }>;
  header?: Partial<{
    height: string;
    bg: string;
    text: string;
    borderBottom: string;
    variant: 'minimal' | 'glass' | 'solid' | 'transparent';
    sticky: boolean;
    paddingX: string;
    paddingY: string;
  }>;
  footer?: Partial<{
    bg: string;
    text: string;
    borderTop: string;
    paddingY: string;
    paddingX: string;
  }>;
  content?: Partial<{
    paddingY: string;
    bg: string;
  }>;
}

export interface PluginThemeDefinition {
  tokens: PluginThemeTokenOverrides;
}

export type PluginMeterUnit =
  | 'item'
  | 'request'
  | 'page'
  | 'minute'
  | 'token'
  | 'byte'
  | 'gb_day'
  | string;

export interface PluginMeterDefinition {
  id: string;
  unit: PluginMeterUnit;
  defaultCreditCost?: number;
  billable?: boolean;
  description?: string;
}

export interface PluginServiceDefinition {
  name: string;
  methods: readonly PluginHttpMethod[];
  paths: readonly string[];
  actorClaims?: boolean;
}

export type PluginResourceBindingScopeType = 'user' | 'workspace';
export type PluginResourceBindingCardinality = 'one' | 'many';
export type PluginResourceBindingRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface PluginResourceBindingPermissionDefinition {
  read?: readonly PluginResourceBindingRole[];
  write?: readonly PluginResourceBindingRole[];
}

export interface PluginResourceBindingDefinition {
  type: string;
  scope: PluginResourceBindingScopeType;
  cardinality?: PluginResourceBindingCardinality;
  permissions?: PluginResourceBindingPermissionDefinition;
}

export interface PluginDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  kind?: PluginKind;
  trustLevel?: PluginTrustLevel;
  permissions?: readonly PermissionValue[];
  data?: PluginDataDefinition;
  routes?: PluginRoutesDefinition;
  menu?: PluginMenuDefinition | readonly PluginMenuDefinition[];
  slots?: PluginSlotsDefinition;
  hostPages?: PluginHostPagesDefinition;
  resources?: PluginResourcesDefinition;
  theme?: PluginThemeDefinition;
  meters?: readonly PluginMeterDefinition[];
  services?: readonly PluginServiceDefinition[];
  resourceBindings?: readonly PluginResourceBindingDefinition[];
  config?: PluginConfigDefinition;
  configSchema?: unknown;
  lifecycle?: PluginLifecycle;
  events?: PluginEventDefinition;
  jobs?: Record<string, PluginJobDefinition>;
  webhooks?: Record<string, PluginWebhookDefinition>;
  hooks?: PluginHooksDefinition;
  egress?: readonly string[];
}

export interface PluginDefinitionMarker {
  readonly type: 'ploykit.plugin';
  readonly sdkVersion: '0.1.0';
}

export type DefinedPlugin<TDefinition extends PluginDefinition = PluginDefinition> =
  Readonly<TDefinition> & {
    readonly $$ploykit: PluginDefinitionMarker;
  };

export type PluginApiMethodName = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type PluginApiHandler<TContext extends PluginContext = PluginContext> = (
  ctx: TContext
) => Response | Promise<Response>;

export type PluginApiDefinition<TContext extends PluginContext = PluginContext> = Partial<
  Record<PluginApiMethodName, PluginApiHandler<TContext>>
>;

export interface PluginApiDefinitionMarker {
  readonly type: 'ploykit.api';
  readonly sdkVersion: '0.1.0';
}

export type DefinedApi<TDefinition extends PluginApiDefinition = PluginApiDefinition> =
  Readonly<TDefinition> & {
    readonly $$ploykit: PluginApiDefinitionMarker;
  };
