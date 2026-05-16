import {
  type PluginConfigDefinition,
  type PluginCommercialRequirement,
  type PluginDefinition,
  type PluginEventDefinition,
  type PluginHookDefinition,
  type PluginHttpMethod,
  type PluginHostPageCacheDefinition,
  type PluginHostPageI18nDefinition,
  type PluginHostPagesDefinition,
  type PluginHostPageSeoDefinition,
  type PluginHostPageShellDefinition,
  type PluginHostPageSlotPosition,
  type PluginMenuDefinition,
  type PluginMeterDefinition,
  type PluginPublicRouteAliasDeclaration,
  type PluginResourceBindingCardinality,
  type PluginResourceBindingRole,
  type PluginAssetDeclaration,
  type PluginAnonymousRateLimitBucket,
  type PluginAnonymousPolicy,
  type PluginResourcesDefinition,
  type PluginRouteAuth,
  type PluginRouteLayout,
  type PluginRouteMachineAuth,
  type PluginSlotDeclaration,
  type PluginSlotName,
  type PluginThemeDefinition,
  type PluginToolCacheDefinition,
  type PluginToolSeoMetadata,
  type PluginToolSitemapDefinition,
  VALID_PLUGIN_SLOT_NAMES,
  isPluginRouteSlotName,
  parsePluginRouteSlotName,
} from './types';
import type {
  PluginCollectionDefinition,
  PluginCollectionField,
  PluginCollectionFieldBase,
  PluginCollectionFieldDefinition,
} from './storage';
import { createPluginDiagnostic, type PluginDiagnostic } from './diagnostics';
import { HostPermissionValues, Permission, type PermissionValue } from './permissions';
import { findPluginRoutePatternConflict, normalizePluginRoutePath } from './route-patterns';

const PLUGIN_ID_PATTERN = /^[a-z0-9-]+$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
const COLLECTION_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9.-]*$/;
const JOB_NAME_PATTERN = /^[a-z][a-z0-9.-]*$/;
const LOCALE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;
const METER_ID_PATTERN = /^[a-z][a-z0-9.-]*$/;
const SERVICE_NAME_PATTERN = /^[a-zA-Z0-9._:-]+$/;
const RESOURCE_BINDING_TYPE_PATTERN = /^[a-zA-Z0-9._:-]+$/;
const I18N_KEY_PATTERN = /^[A-Za-z0-9_.-]+$/;
const LENGTH_VALUE_PATTERN = /^(\d+(\.\d+)?)(px|rem|em|%)$/;
const COLOR_VALUE_PATTERN =
  /^(#[0-9a-fA-F]{3,8}|rgb\([^)]+\)|rgba\([^)]+\)|hsl\([^)]+\)|hsla\([^)]+\)|oklch\([^)]+\)|transparent|currentColor)$/;

const PLUGIN_KINDS = new Set(['app', 'tool', 'service', 'theme', 'connector']);
const TRUST_LEVELS = new Set(['untrusted', 'trusted', 'system']);
const ROUTE_AUTHS = new Set<PluginRouteAuth>(['public', 'auth', 'admin']);
const ROUTE_MACHINE_AUTHS = new Set<PluginRouteMachineAuth>(['apiKey']);
const ROUTE_LAYOUTS = new Set<PluginRouteLayout>(['site', 'dashboard', 'dashboard-admin']);
const HTTP_METHODS = new Set<PluginHttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const ROBOTS_DIRECTIVES = new Set(['index', 'noindex', 'follow', 'nofollow']);
const TOOL_CACHE_STRATEGIES = new Set(['none', 'public', 'private']);
const ANONYMOUS_CAPTCHA_POLICIES = new Set(['never', 'auto', 'always']);
const ANONYMOUS_RATE_LIMIT_BUCKETS = new Set<PluginAnonymousRateLimitBucket>([
  'ip',
  'userAgent',
  'route',
  'plugin',
  'method',
]);
const SITEMAP_CHANGE_FREQUENCIES = new Set([
  'always',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'never',
]);
const TOOL_PATH_PREFIX = '/tools';
const PUBLIC_ALIAS_RESERVED_PREFIXES = [
  '/admin',
  '/api',
  '/auth',
  '/billing',
  '/checkout',
  '/dashboard',
  '/debug',
  '/files',
  '/login',
  '/notifications',
  '/plans',
  '/plugins',
  '/profile',
  '/register',
  '/reset-password',
  '/settings',
  '/tasks',
  '/tools',
  '/user',
  '/webhooks',
];
const PUBLIC_ALIAS_RESERVED_EXACT_PATHS = new Set([
  '/',
  '/about',
  '/contact',
  '/favicon.ico',
  '/privacy',
  '/pricing',
  '/success',
  '/terms',
]);
const ASSET_KINDS = new Set(['asset', 'worker', 'wasm']);
const ASSET_EXTENSIONS = new Set([
  '.avif',
  '.css',
  '.ico',
  '.js',
  '.mjs',
  '.json',
  '.wasm',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
]);
const FIELD_BASE_TYPES = new Set<PluginCollectionFieldBase>([
  'string',
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'json',
]);
const WEBHOOK_SIGNATURE_POLICIES = new Set(['none', 'hmac-sha256', 'stripe', 'github']);
const UNSAFE_PERMISSION_PREFIX = 'unsafe.';
const RESOURCE_BINDING_SCOPES = new Set(['user', 'workspace']);
const RESOURCE_BINDING_CARDINALITIES = new Set<PluginResourceBindingCardinality>(['one', 'many']);
const RESOURCE_BINDING_ROLES = new Set<PluginResourceBindingRole>([
  'owner',
  'admin',
  'editor',
  'viewer',
]);
const HOST_PAGE_PATHS = new Set([
  '/',
  '/about',
  '/contact',
  '/pricing',
  '/privacy',
  '/terms',
  '/success',
]);
const HOST_PAGE_SLOT_POSITIONS = new Set<PluginHostPageSlotPosition>([
  'hero.before',
  'hero.after',
  'main.before',
  'main.after',
  'main.replace',
]);
const HOST_PAGE_OVERRIDE_MODES = new Set(['main.replace']);
const HOST_PAGE_SHELL_LAYOUTS = new Set(['site']);
const HOST_PAGE_SHELL_CHROME = new Set(['host', 'hidden']);
const HOST_PAGE_SHELL_CONTAINERS = new Set(['fixed', 'fluid', 'full']);

interface RoutePatternDeclaration {
  path: string;
  declaration: string;
  area?: string;
  method?: PluginHttpMethod;
}

export function validatePluginDefinition(definition: PluginDefinition): PluginDiagnostic[] {
  const diagnostics: PluginDiagnostic[] = [];
  const routeKeys = new Set<string>();

  validateIdentity(definition, diagnostics);
  validatePermissions(definition, diagnostics);
  validateData(definition, diagnostics);
  validateRoutes(definition, diagnostics, routeKeys);
  validateMenus(definition, diagnostics);
  validateSlots(definition, diagnostics);
  validateHostPages(definition, diagnostics);
  validateLifecycle(definition, diagnostics);
  validateEvents(definition, definition.events, diagnostics);
  validateJobs(definition, diagnostics);
  validateWebhooks(definition, diagnostics);
  validateHooks(definition, diagnostics);
  validateResources(definition.resources, diagnostics);
  validateTheme(definition.theme, diagnostics);
  validateMeters(definition, diagnostics);
  validateServices(definition, diagnostics);
  validateResourceBindings(definition, diagnostics);
  validateConfig(definition.config, diagnostics);
  validateEgress(definition, diagnostics);

  return diagnostics;
}

function addError(
  diagnostics: PluginDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(
    createPluginDiagnostic({
      code,
      severity: 'error',
      message,
      path,
      fix,
    })
  );
}

function addRouteKey(
  diagnostics: PluginDiagnostic[],
  routeKeys: Set<string>,
  key: string,
  path: string,
  diagnosticPath: string
): void {
  if (routeKeys.has(key)) {
    addError(
      diagnostics,
      'PLUGIN_ROUTE_DUPLICATE',
      `Plugin route "${path}" is declared more than once.`,
      diagnosticPath,
      'Remove the duplicate route or use a different path/method.'
    );
    return;
  }

  routeKeys.add(key);
}

function validateIdentity(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  if (!PLUGIN_ID_PATTERN.test(definition.id)) {
    addError(
      diagnostics,
      'PLUGIN_ID_INVALID',
      `Plugin id "${definition.id}" must contain only lowercase letters, numbers, and hyphens.`,
      'id',
      'Use a stable id like "todo" or "customer-crm".'
    );
  }

  if (!definition.name.trim()) {
    addError(diagnostics, 'PLUGIN_NAME_REQUIRED', 'Plugin name is required.', 'name');
  }

  if (!SEMVER_PATTERN.test(definition.version)) {
    addError(
      diagnostics,
      'PLUGIN_VERSION_INVALID',
      `Plugin version "${definition.version}" must follow semantic versioning.`,
      'version',
      'Use a version like "1.0.0".'
    );
  }

  if (definition.kind && !PLUGIN_KINDS.has(definition.kind)) {
    addError(
      diagnostics,
      'PLUGIN_KIND_INVALID',
      `Unsupported plugin kind "${definition.kind}".`,
      'kind'
    );
  }

  if (definition.trustLevel && !TRUST_LEVELS.has(definition.trustLevel)) {
    addError(
      diagnostics,
      'PLUGIN_TRUST_LEVEL_INVALID',
      `Unsupported plugin trust level "${definition.trustLevel}".`,
      'trustLevel'
    );
  }
}

function validatePermissions(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  const seen = new Set<string>();

  for (const [index, permission] of (definition.permissions ?? []).entries()) {
    const path = `permissions.${index}`;

    if (seen.has(permission)) {
      addError(
        diagnostics,
        'PLUGIN_PERMISSION_DUPLICATE',
        `Permission "${permission}" is declared more than once.`,
        path,
        'Remove the duplicate permission from plugin.ts.'
      );
      continue;
    }

    seen.add(permission);

    if (!HostPermissionValues.has(permission)) {
      addError(
        diagnostics,
        'PLUGIN_PERMISSION_UNKNOWN',
        `Permission "${permission}" is not part of @ploykit/plugin-sdk.`,
        path,
        'Use the Permission export from @ploykit/plugin-sdk.'
      );
      continue;
    }

    if (permission.startsWith(UNSAFE_PERMISSION_PREFIX) && definition.trustLevel !== 'system') {
      addError(
        diagnostics,
        'PLUGIN_UNSAFE_PERMISSION_FORBIDDEN',
        `Unsafe permission "${permission}" can only be declared by system plugins.`,
        path,
        'Remove the unsafe permission or move the plugin into the system plugin model.'
      );
    }
  }
}

function validateRoutes(
  definition: PluginDefinition,
  diagnostics: PluginDiagnostic[],
  routeKeys: Set<string>
): void {
  const pagePatterns: RoutePatternDeclaration[] = [];
  const publicAliasPatterns: RoutePatternDeclaration[] = [];
  const apiPatterns: RoutePatternDeclaration[] = [];

  for (const [index, page] of (definition.routes?.pages ?? []).entries()) {
    const basePath = `routes.pages.${index}`;
    validatePluginRoutePath(definition, page.path, `${basePath}.path`, 'Page route', diagnostics);
    validatePluginModulePath(
      page.component,
      `${basePath}.component`,
      'Page component',
      diagnostics
    );
    validateAuth(page.auth, `${basePath}.auth`, diagnostics);
    validateLayout(page.layout, `${basePath}.layout`, diagnostics);
    validateRoutePermissions(
      page.permissions,
      definition.permissions,
      `${basePath}.permissions`,
      diagnostics
    );
    validateCommercialRequirement(page.commercial, `${basePath}.commercial`, diagnostics);
    validatePublicAliases(
      page.publicAliases,
      {
        basePath: `${basePath}.publicAliases`,
        routeLayout: page.layout ?? 'site',
        routePath: page.path,
        source: 'page',
      },
      diagnostics,
      routeKeys,
      publicAliasPatterns
    );

    if (page.layout === 'dashboard-admin' && page.auth !== 'admin') {
      addError(
        diagnostics,
        'PLUGIN_ROUTE_AUTH_TOO_WEAK',
        'dashboard-admin pages must use auth: "admin".',
        `${basePath}.auth`,
        'Set auth to "admin" or use a non-admin layout.'
      );
    }

    addRouteKey(
      diagnostics,
      routeKeys,
      `page:${pageRouteArea(page.layout)}:${page.path}`,
      page.path,
      `${basePath}.path`
    );
    validateRoutePatternConflict(
      diagnostics,
      pagePatterns,
      {
        path: page.path,
        area: pageRouteArea(page.layout),
        declaration: basePath,
      },
      'PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT',
      'Page',
      `${basePath}.path`
    );
  }

  for (const [index, tool] of (definition.routes?.tools ?? []).entries()) {
    const basePath = `routes.tools.${index}`;
    validatePluginRoutePath(definition, tool.path, `${basePath}.path`, 'Tool route', diagnostics);
    validatePluginModulePath(
      tool.component,
      `${basePath}.component`,
      'Tool component',
      diagnostics
    );
    if (tool.auth && tool.auth !== 'public' && tool.auth !== 'auth') {
      addError(
        diagnostics,
        'PLUGIN_TOOL_ROUTE_AUTH_INVALID',
        'Tool routes may only use auth: "public" or "auth".',
        `${basePath}.auth`,
        'Use auth: "public" for public tools or auth: "auth" for signed-in tools.'
      );
    }
    validateRoutePermissions(
      tool.permissions,
      definition.permissions,
      `${basePath}.permissions`,
      diagnostics
    );
    validateCommercialRequirement(tool.commercial, `${basePath}.commercial`, diagnostics);
    validateToolSeo(tool.seo, `${basePath}.seo`, diagnostics);
    validateToolSitemap(tool.sitemap, `${basePath}.sitemap`, diagnostics);
    validateToolCache(tool.cache, `${basePath}.cache`, diagnostics);
    validateAnonymousPolicy(tool.anonymousPolicy, `${basePath}.anonymousPolicy`, diagnostics);
    validatePublicAliases(
      tool.publicAliases,
      {
        basePath: `${basePath}.publicAliases`,
        routeLayout: 'site',
        routePath: normalizeToolRuntimePath(tool.path),
        source: 'tool',
      },
      diagnostics,
      routeKeys,
      publicAliasPatterns
    );

    const routePath = normalizeToolRuntimePath(tool.path);
    addRouteKey(diagnostics, routeKeys, `page:public:${routePath}`, routePath, `${basePath}.path`);
    validateRoutePatternConflict(
      diagnostics,
      pagePatterns,
      {
        path: routePath,
        area: 'public',
        declaration: basePath,
      },
      'PLUGIN_RUNTIME_PAGE_ROUTE_CONFLICT',
      'Page',
      `${basePath}.path`
    );
  }

  for (const [index, api] of (definition.routes?.apis ?? []).entries()) {
    const basePath = `routes.apis.${index}`;
    validatePluginRoutePath(definition, api.path, `${basePath}.path`, 'API route', diagnostics);
    validatePluginModulePath(api.handler, `${basePath}.handler`, 'API handler', diagnostics);
    validateAuth(api.auth, `${basePath}.auth`, diagnostics);
    validateMachineAuth(api.machineAuth, `${basePath}.machineAuth`, diagnostics);
    validateRoutePermissions(
      api.permissions,
      definition.permissions,
      `${basePath}.permissions`,
      diagnostics
    );
    validateCommercialRequirement(api.commercial, `${basePath}.commercial`, diagnostics);
    validateAnonymousPolicy(api.anonymousPolicy, `${basePath}.anonymousPolicy`, diagnostics);
    if (api.auth === 'public' && !api.anonymousPolicy) {
      addError(
        diagnostics,
        'PLUGIN_PUBLIC_API_ANONYMOUS_POLICY_REQUIRED',
        'Public API routes must declare anonymousPolicy.',
        `${basePath}.anonymousPolicy`,
        'Declare anonymousPolicy with rate limits and allowHighCostActions, or require auth.'
      );
    }

    const methods = api.methods?.length ? api.methods : (['GET'] as const);
    for (const [methodIndex, method] of methods.entries()) {
      if (!HTTP_METHODS.has(method)) {
        addError(
          diagnostics,
          'PLUGIN_API_METHOD_INVALID',
          `Unsupported API method "${method}".`,
          `${basePath}.methods.${methodIndex}`
        );
        continue;
      }

      addRouteKey(
        diagnostics,
        routeKeys,
        `api:${api.path}:${method}`,
        api.path,
        `${basePath}.methods.${methodIndex}`
      );
      validateRoutePatternConflict(
        diagnostics,
        apiPatterns,
        {
          path: api.path,
          method,
          declaration: basePath,
        },
        'PLUGIN_RUNTIME_API_ROUTE_CONFLICT',
        'API',
        `${basePath}.methods.${methodIndex}`
      );
    }
  }
}

function validateCommercialRequirement(
  commercial: PluginCommercialRequirement | undefined,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!commercial) {
    return;
  }

  if (
    commercial.license !== undefined &&
    (typeof commercial.license !== 'string' || !commercial.license.trim())
  ) {
    addError(
      diagnostics,
      'PLUGIN_ROUTE_LICENSE_INVALID',
      'Commercial license requirement must be a non-empty string.',
      `${basePath}.license`
    );
  }

  if (
    commercial.plan !== undefined &&
    (typeof commercial.plan !== 'string' || !commercial.plan.trim())
  ) {
    addError(
      diagnostics,
      'PLUGIN_ROUTE_PLAN_INVALID',
      'Commercial plan requirement must be a non-empty string.',
      `${basePath}.plan`
    );
  }

  if (commercial.purchaseUrl !== undefined && typeof commercial.purchaseUrl === 'string') {
    validateCommercialPurchaseUrl(commercial.purchaseUrl, `${basePath}.purchaseUrl`, diagnostics);
  } else if (commercial.purchaseUrl !== undefined) {
    addError(
      diagnostics,
      'PLUGIN_ROUTE_PURCHASE_URL_INVALID',
      'Commercial purchaseUrl must be a non-empty URL or absolute app path.',
      `${basePath}.purchaseUrl`
    );
  }
}

function validateCommercialPurchaseUrl(
  purchaseUrl: string,
  diagnosticPath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!purchaseUrl.trim()) {
    addError(
      diagnostics,
      'PLUGIN_ROUTE_PURCHASE_URL_INVALID',
      'Commercial purchaseUrl must be a non-empty URL or absolute app path.',
      diagnosticPath
    );
    return;
  }

  if (purchaseUrl.startsWith('/')) {
    if (purchaseUrl.includes('//')) {
      addError(
        diagnostics,
        'PLUGIN_ROUTE_PURCHASE_URL_INVALID',
        'Commercial purchaseUrl app paths must not contain duplicate slashes.',
        diagnosticPath
      );
    }
    return;
  }

  try {
    const url = new URL(purchaseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new TypeError('Unsupported protocol.');
    }
  } catch {
    addError(
      diagnostics,
      'PLUGIN_ROUTE_PURCHASE_URL_INVALID',
      'Commercial purchaseUrl must be an http(s) URL or an absolute app path.',
      diagnosticPath
    );
  }
}

function normalizeToolRuntimePath(path: string): string {
  const routePath = normalizeDeclaredRoutePath(path);
  if (routePath === TOOL_PATH_PREFIX || routePath.startsWith(`${TOOL_PATH_PREFIX}/`)) {
    return routePath;
  }

  return normalizeDeclaredRoutePath(`${TOOL_PATH_PREFIX}${routePath}`);
}

function validateToolSeo(
  seo: PluginToolSeoMetadata | undefined,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!seo || typeof seo !== 'object') {
    addError(
      diagnostics,
      'PLUGIN_TOOL_SEO_REQUIRED',
      'Tool routes must declare seo metadata.',
      basePath,
      'Add title, description, and canonical SEO metadata to the tool route.'
    );
    return;
  }

  const metadata = seo as {
    title?: unknown;
    description?: unknown;
    canonical?: unknown;
    robots?: { index?: unknown; follow?: unknown };
    openGraph?: unknown;
    structuredData?: unknown;
    locales?: Record<string, unknown>;
  };

  if (typeof metadata.title !== 'string' || !metadata.title.trim()) {
    addError(
      diagnostics,
      'PLUGIN_TOOL_SEO_TITLE_REQUIRED',
      'Tool SEO title is required.',
      `${basePath}.title`
    );
  }
  if (typeof metadata.description !== 'string' || !metadata.description.trim()) {
    addError(
      diagnostics,
      'PLUGIN_TOOL_SEO_DESCRIPTION_REQUIRED',
      'Tool SEO description is required.',
      `${basePath}.description`
    );
  }
  if (typeof metadata.canonical !== 'string' || !metadata.canonical.trim()) {
    addError(
      diagnostics,
      'PLUGIN_TOOL_SEO_CANONICAL_REQUIRED',
      'Tool SEO canonical path is required.',
      `${basePath}.canonical`
    );
  } else if (!metadata.canonical.startsWith('/') || metadata.canonical.includes('//')) {
    addError(
      diagnostics,
      'PLUGIN_TOOL_SEO_CANONICAL_INVALID',
      'Tool SEO canonical must be an absolute app path.',
      `${basePath}.canonical`
    );
  }

  const robots = metadata.robots;
  for (const key of ['index', 'follow'] as const) {
    const value = robots?.[key];
    if (
      value !== undefined &&
      typeof value !== 'boolean' &&
      !ROBOTS_DIRECTIVES.has(String(value))
    ) {
      addError(
        diagnostics,
        'PLUGIN_TOOL_SEO_ROBOTS_INVALID',
        `Tool SEO robots.${key} is invalid.`,
        `${basePath}.robots.${key}`
      );
    }
  }

  for (const [locale, localized] of Object.entries(metadata.locales ?? {})) {
    if (!LOCALE_PATTERN.test(locale)) {
      addError(
        diagnostics,
        'PLUGIN_TOOL_SEO_LOCALE_INVALID',
        `Tool SEO locale "${locale}" is invalid.`,
        `${basePath}.locales.${locale}`
      );
    }
    if (!localized || typeof localized !== 'object') {
      addError(
        diagnostics,
        'PLUGIN_TOOL_SEO_LOCALE_INVALID',
        `Tool SEO locale "${locale}" must be an object.`,
        `${basePath}.locales.${locale}`
      );
      continue;
    }
    const localizedMeta = localized as {
      title?: unknown;
      description?: unknown;
      canonical?: unknown;
    };
    for (const key of ['title', 'description', 'canonical'] as const) {
      const value = localizedMeta[key];
      if (value !== undefined && typeof value !== 'string') {
        addError(
          diagnostics,
          'PLUGIN_TOOL_SEO_LOCALE_INVALID',
          `Tool SEO localized ${key} must be a string.`,
          `${basePath}.locales.${locale}.${key}`
        );
      }
    }
  }

  if (metadata.openGraph !== undefined && typeof metadata.openGraph !== 'object') {
    addError(
      diagnostics,
      'PLUGIN_TOOL_SEO_OPEN_GRAPH_INVALID',
      'Tool SEO openGraph must be an object.',
      `${basePath}.openGraph`
    );
  }

  if (metadata.structuredData !== undefined) {
    try {
      JSON.stringify(metadata.structuredData);
    } catch {
      addError(
        diagnostics,
        'PLUGIN_TOOL_SEO_STRUCTURED_DATA_INVALID',
        'Tool SEO structuredData must be JSON serializable.',
        `${basePath}.structuredData`
      );
    }
  }
}

function validateToolSitemap(
  sitemap: PluginToolSitemapDefinition | undefined,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!sitemap) return;
  const value = sitemap as { changeFrequency?: unknown; priority?: unknown; include?: unknown };
  if (
    value.changeFrequency !== undefined &&
    !SITEMAP_CHANGE_FREQUENCIES.has(String(value.changeFrequency))
  ) {
    addError(
      diagnostics,
      'PLUGIN_TOOL_SITEMAP_CHANGE_FREQUENCY_INVALID',
      'Tool sitemap changeFrequency is invalid.',
      `${basePath}.changeFrequency`
    );
  }
  if (
    value.priority !== undefined &&
    (typeof value.priority !== 'number' || value.priority < 0 || value.priority > 1)
  ) {
    addError(
      diagnostics,
      'PLUGIN_TOOL_SITEMAP_PRIORITY_INVALID',
      'Tool sitemap priority must be between 0 and 1.',
      `${basePath}.priority`
    );
  }
  if (value.include !== undefined && typeof value.include !== 'boolean') {
    addError(
      diagnostics,
      'PLUGIN_TOOL_SITEMAP_INCLUDE_INVALID',
      'Tool sitemap include must be a boolean.',
      `${basePath}.include`
    );
  }
}

function validateToolCache(
  cache: PluginToolCacheDefinition | undefined,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!cache) return;
  const value = cache as {
    strategy?: unknown;
    maxAgeSeconds?: unknown;
    staleWhileRevalidateSeconds?: unknown;
  };
  if (!TOOL_CACHE_STRATEGIES.has(String(value.strategy))) {
    addError(
      diagnostics,
      'PLUGIN_TOOL_CACHE_STRATEGY_INVALID',
      'Tool cache strategy is invalid.',
      `${basePath}.strategy`
    );
  }
  for (const key of ['maxAgeSeconds', 'staleWhileRevalidateSeconds'] as const) {
    const seconds = value[key];
    if (
      seconds !== undefined &&
      (!Number.isInteger(seconds) || Number(seconds) < 0 || Number(seconds) > 31536000)
    ) {
      addError(
        diagnostics,
        'PLUGIN_TOOL_CACHE_SECONDS_INVALID',
        `Tool cache ${key} must be an integer between 0 and 31536000.`,
        `${basePath}.${key}`
      );
    }
  }
}

function validateAnonymousPolicy(
  policy: PluginAnonymousPolicy | undefined,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!policy) return;
  const value = policy as {
    rateLimit?: { bucket?: unknown; limit?: unknown; window?: unknown };
    maxUploadBytes?: unknown;
    captcha?: unknown;
    allowHighCostActions?: unknown;
  };
  const rateLimit = value.rateLimit;
  if (rateLimit) {
    const buckets = Array.isArray(rateLimit.bucket) ? rateLimit.bucket : [rateLimit.bucket];
    if (
      buckets.length === 0 ||
      buckets.some((bucket) => !ANONYMOUS_RATE_LIMIT_BUCKETS.has(bucket as never))
    ) {
      addError(
        diagnostics,
        'PLUGIN_ANONYMOUS_RATE_LIMIT_BUCKET_INVALID',
        'Anonymous rateLimit bucket is invalid.',
        `${basePath}.rateLimit.bucket`
      );
    }
    if (
      typeof rateLimit.limit !== 'number' ||
      !Number.isInteger(rateLimit.limit) ||
      rateLimit.limit < 1
    ) {
      addError(
        diagnostics,
        'PLUGIN_ANONYMOUS_RATE_LIMIT_INVALID',
        'Anonymous rateLimit limit must be a positive integer.',
        `${basePath}.rateLimit.limit`
      );
    }
    if (typeof rateLimit.window !== 'string' || !/^\d+[smhd]$/.test(rateLimit.window)) {
      addError(
        diagnostics,
        'PLUGIN_ANONYMOUS_RATE_LIMIT_WINDOW_INVALID',
        'Anonymous rateLimit window must use a duration like "1m" or "1h".',
        `${basePath}.rateLimit.window`
      );
    }
  }
  if (
    value.maxUploadBytes !== undefined &&
    (!Number.isInteger(value.maxUploadBytes) || Number(value.maxUploadBytes) < 0)
  ) {
    addError(
      diagnostics,
      'PLUGIN_ANONYMOUS_MAX_UPLOAD_BYTES_INVALID',
      'Anonymous maxUploadBytes must be a non-negative integer.',
      `${basePath}.maxUploadBytes`
    );
  }
  if (value.captcha !== undefined && !ANONYMOUS_CAPTCHA_POLICIES.has(String(value.captcha))) {
    addError(
      diagnostics,
      'PLUGIN_ANONYMOUS_CAPTCHA_INVALID',
      'Anonymous captcha policy is invalid.',
      `${basePath}.captcha`
    );
  }
  if (value.allowHighCostActions !== undefined && typeof value.allowHighCostActions !== 'boolean') {
    addError(
      diagnostics,
      'PLUGIN_ANONYMOUS_HIGH_COST_ACTIONS_INVALID',
      'Anonymous allowHighCostActions must be a boolean.',
      `${basePath}.allowHighCostActions`
    );
  }
}

function pageRouteArea(layout: PluginRouteLayout | undefined): 'admin' | 'public' {
  return layout === 'dashboard-admin' ? 'admin' : 'public';
}

interface PublicAliasValidationContext {
  basePath: string;
  routeLayout: PluginRouteLayout;
  routePath: string;
  source: 'page' | 'tool';
}

function validatePublicAliases(
  aliases: readonly PluginPublicRouteAliasDeclaration[] | undefined,
  context: PublicAliasValidationContext,
  diagnostics: PluginDiagnostic[],
  routeKeys: Set<string>,
  publicAliasPatterns: RoutePatternDeclaration[]
): void {
  if (!aliases?.length) {
    return;
  }

  if (context.routeLayout !== 'site') {
    addError(
      diagnostics,
      'PLUGIN_PUBLIC_ALIAS_LAYOUT_INVALID',
      'Public route aliases can only target site-layout public pages.',
      context.basePath,
      'Move the route to layout: "site" or remove publicAliases.'
    );
    return;
  }

  for (const [index, alias] of aliases.entries()) {
    const basePath = `${context.basePath}.${index}`;
    const aliasPath = typeof alias === 'string' ? alias : alias.path;

    validatePublicAliasPath(
      aliasPath,
      typeof alias === 'string' ? basePath : `${basePath}.path`,
      diagnostics
    );

    if (typeof alias !== 'string') {
      if (alias.seo !== undefined) {
        validateToolSeo(alias.seo, `${basePath}.seo`, diagnostics);
      }
      validateToolSitemap(alias.sitemap, `${basePath}.sitemap`, diagnostics);
    }

    if (!aliasPath?.startsWith('/')) {
      continue;
    }

    const normalizedAliasPath = normalizeDeclaredRoutePath(aliasPath);
    addRouteKey(
      diagnostics,
      routeKeys,
      `public-alias:${normalizedAliasPath}`,
      normalizedAliasPath,
      typeof alias === 'string' ? basePath : `${basePath}.path`
    );
    validateRoutePatternConflict(
      diagnostics,
      publicAliasPatterns,
      {
        path: normalizedAliasPath,
        area: 'public',
        declaration: `${context.basePath} -> ${context.source}:${context.routePath}`,
      },
      'PLUGIN_PUBLIC_ALIAS_ROUTE_CONFLICT',
      'Page',
      typeof alias === 'string' ? basePath : `${basePath}.path`
    );
  }
}

function validateRoutePatternConflict(
  diagnostics: PluginDiagnostic[],
  declarations: RoutePatternDeclaration[],
  declaration: RoutePatternDeclaration,
  code: string,
  label: 'Page' | 'API' | 'Webhook',
  diagnosticPath: string
): void {
  const normalizedPath = normalizeDeclaredRoutePath(declaration.path);
  const existing = declarations.find((candidate) => {
    if (candidate.area !== declaration.area || candidate.method !== declaration.method) {
      return false;
    }

    return Boolean(findPluginRoutePatternConflict(candidate.path, normalizedPath));
  });
  const conflict = existing ? findPluginRoutePatternConflict(existing.path, normalizedPath) : null;

  if (existing && conflict) {
    const scope =
      declaration.method ??
      (declaration.area ? `${declaration.area} plugin pages` : 'plugin routes');
    addError(
      diagnostics,
      code,
      `${label} route "${normalizedPath}" overlaps with "${existing.path}" for ${scope}; both can match "${conflict.samplePath}".`,
      diagnosticPath,
      `Make the ${label.toLowerCase()} route unambiguous or remove the overlapping declaration. First declaration: ${existing.declaration}.`
    );
  }

  declarations.push({ ...declaration, path: normalizedPath });
}

function validateRoutePermissions(
  routePermissions: readonly PermissionValue[] | undefined,
  pluginPermissions: readonly PermissionValue[] | undefined,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  const declaredPermissions = new Set(pluginPermissions ?? []);
  const seen = new Set<string>();

  for (const [index, permission] of (routePermissions ?? []).entries()) {
    const path = `${basePath}.${index}`;

    if (seen.has(permission)) {
      addError(
        diagnostics,
        'PLUGIN_ROUTE_PERMISSION_DUPLICATE',
        `Route permission "${permission}" is declared more than once.`,
        path,
        'Remove the duplicate route permission.'
      );
      continue;
    }

    seen.add(permission);

    if (!HostPermissionValues.has(permission)) {
      addError(
        diagnostics,
        'PLUGIN_ROUTE_PERMISSION_UNKNOWN',
        `Route permission "${permission}" is not part of @ploykit/plugin-sdk.`,
        path,
        'Use the Permission export from @ploykit/plugin-sdk.'
      );
      continue;
    }

    if (!declaredPermissions.has(permission)) {
      addError(
        diagnostics,
        'PLUGIN_ROUTE_PERMISSION_UNDECLARED',
        `Route permission "${permission}" must also be declared in plugin permissions.`,
        path,
        'Add the permission to the top-level permissions array in plugin.ts.'
      );
    }
  }
}

function validateMenus(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  const menus = toArray(definition.menu);
  if (menus.length > 0 && !hasDeclaredPermission(definition, Permission.NavigationExtend)) {
    addError(
      diagnostics,
      'PLUGIN_NAVIGATION_EXTEND_PERMISSION_REQUIRED',
      'Declaring plugin menu entries requires Permission.NavigationExtend.',
      'menu',
      'Add Permission.NavigationExtend to plugin.ts permissions or remove menu entries.'
    );
  }

  const pageRoutePaths = new Set([
    ...(definition.routes?.pages ?? []).map((route) => normalizeDeclaredRoutePath(route.path)),
    ...(definition.routes?.tools ?? []).map((route) => normalizeToolRuntimePath(route.path)),
  ]);
  const publicAliasPaths = new Set(
    [
      ...(definition.routes?.pages ?? []).flatMap((route) =>
        (route.publicAliases ?? []).map((alias) =>
          normalizeDeclaredRoutePath(typeof alias === 'string' ? alias : alias.path)
        )
      ),
      ...(definition.routes?.tools ?? []).flatMap((route) =>
        (route.publicAliases ?? []).map((alias) =>
          normalizeDeclaredRoutePath(typeof alias === 'string' ? alias : alias.path)
        )
      ),
    ].filter((path) => path.startsWith('/'))
  );

  for (const [index, menu] of menus.entries()) {
    const basePath = `menu.${index}`;
    validateMenu(definition, menu, basePath, pageRoutePaths, publicAliasPaths, diagnostics);
  }
}

function validateMenu(
  definition: PluginDefinition,
  menu: PluginMenuDefinition,
  basePath: string,
  pageRoutePaths: ReadonlySet<string>,
  publicAliasPaths: ReadonlySet<string>,
  diagnostics: PluginDiagnostic[]
): void {
  validateMenuText(menu, basePath, diagnostics);

  if (menu.labelKey !== undefined) {
    validatePluginLocalI18nKey(
      menu.labelKey,
      `${basePath}.labelKey`,
      'Menu labelKey',
      diagnostics,
      'PLUGIN_MENU_I18N_KEY_INVALID'
    );
  }

  if (menu.groupKey !== undefined) {
    validatePluginLocalI18nKey(
      menu.groupKey,
      `${basePath}.groupKey`,
      'Menu groupKey',
      diagnostics,
      'PLUGIN_MENU_I18N_KEY_INVALID'
    );
  }

  if (menu.fallbackLabel !== undefined && !menu.fallbackLabel.trim()) {
    addError(
      diagnostics,
      'PLUGIN_MENU_FALLBACK_LABEL_INVALID',
      'Menu fallbackLabel must not be empty when provided.',
      `${basePath}.fallbackLabel`
    );
  }

  if (menu.label !== undefined && !menu.label.trim()) {
    addError(
      diagnostics,
      'PLUGIN_MENU_LABEL_INVALID',
      'Menu label must not be empty when provided.',
      `${basePath}.label`
    );
  }

  if (menu.fallbackGroup !== undefined && !menu.fallbackGroup.trim()) {
    addError(
      diagnostics,
      'PLUGIN_MENU_FALLBACK_GROUP_INVALID',
      'Menu fallbackGroup must not be empty when provided.',
      `${basePath}.fallbackGroup`
    );
  }

  if (menu.group !== undefined && !menu.group.trim()) {
    addError(
      diagnostics,
      'PLUGIN_MENU_GROUP_INVALID',
      'Menu group must not be empty when provided.',
      `${basePath}.group`
    );
  }

  if (publicAliasPaths.has(normalizeDeclaredRoutePath(menu.path))) {
    validateAbsolutePath(menu.path, `${basePath}.path`, 'Menu path', diagnostics);
  } else {
    validatePluginRoutePath(definition, menu.path, `${basePath}.path`, 'Menu path', diagnostics);
  }

  if (
    menu.path.startsWith('/') &&
    !pageRoutePaths.has(normalizeDeclaredRoutePath(menu.path)) &&
    !publicAliasPaths.has(normalizeDeclaredRoutePath(menu.path))
  ) {
    addError(
      diagnostics,
      'PLUGIN_MENU_ROUTE_UNKNOWN',
      `Menu path "${menu.path}" must point to a declared page route or public alias in plugin.ts.`,
      `${basePath}.path`,
      'Use the same path as one of routes.pages entries, tool routes, or publicAliases entries.'
    );
  }
}

function validateMenuText(
  menu: PluginMenuDefinition,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  const label = menu.label?.trim();
  const labelKey = menu.labelKey?.trim();
  const fallbackLabel = menu.fallbackLabel?.trim();

  if (label || labelKey || fallbackLabel) {
    return;
  }

  addError(
    diagnostics,
    'PLUGIN_MENU_LABEL_REQUIRED',
    'Menu label, labelKey, or fallbackLabel is required.',
    `${basePath}.label`,
    'Use label for a literal label, or labelKey + fallbackLabel with plugin resources.locales.'
  );
}

function validatePluginLocalI18nKey(
  key: string,
  path: string,
  label: string,
  diagnostics: PluginDiagnostic[],
  code = 'PLUGIN_I18N_KEY_INVALID'
): void {
  const trimmed = key.trim();

  if (
    !trimmed ||
    !I18N_KEY_PATTERN.test(trimmed) ||
    trimmed.startsWith('.') ||
    trimmed.endsWith('.') ||
    trimmed.includes('..')
  ) {
    addError(
      diagnostics,
      code,
      `${label} must contain only letters, numbers, dots, underscores, or hyphens, and cannot start, end, or contain consecutive dots.`,
      path,
      'Use a plugin-local key such as "menu.console" or "nav.jobs".'
    );
  }
}

function validateSlotName(
  definition: PluginDefinition,
  slotName: string,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): slotName is PluginSlotName {
  if (VALID_PLUGIN_SLOT_NAMES.has(slotName)) {
    return true;
  }

  if (!isPluginRouteSlotName(slotName)) {
    addError(
      diagnostics,
      'PLUGIN_SLOT_NAME_INVALID',
      `Unsupported slot name "${slotName}".`,
      basePath,
      'Use one of the SlotName values exported from @ploykit/plugin-sdk or a route:/path:main.before route slot.'
    );
    return false;
  }

  const parsed = parsePluginRouteSlotName(slotName);
  const routePath = normalizeDeclaredRoutePath(parsed?.path ?? '');
  const routePaths = new Set([
    ...(definition.routes?.pages ?? []).map((route) => normalizeDeclaredRoutePath(route.path)),
    ...(definition.routes?.tools ?? []).map((route) => normalizeToolRuntimePath(route.path)),
    ...(definition.routes?.pages ?? []).flatMap((route) =>
      (route.publicAliases ?? []).map((alias) =>
        normalizeDeclaredRoutePath(typeof alias === 'string' ? alias : alias.path)
      )
    ),
    ...(definition.routes?.tools ?? []).flatMap((route) =>
      (route.publicAliases ?? []).map((alias) =>
        normalizeDeclaredRoutePath(typeof alias === 'string' ? alias : alias.path)
      )
    ),
  ]);

  if (!routePaths.has(routePath)) {
    addError(
      diagnostics,
      'PLUGIN_ROUTE_SLOT_ROUTE_UNKNOWN',
      `Route slot "${slotName}" must target a declared page, tool route, or public alias.`,
      basePath,
      'Declare the target route first, then add route-scoped slots for it.'
    );
    return false;
  }

  return true;
}

function validateSlotDeclaration(
  declaration: PluginSlotDeclaration,
  path: string,
  diagnostics: PluginDiagnostic[]
): void {
  const component =
    typeof declaration === 'string'
      ? declaration
      : declaration && typeof declaration === 'object'
        ? declaration.component
        : undefined;

  if (typeof component !== 'string') {
    addError(
      diagnostics,
      'PLUGIN_SLOT_COMPONENT_REQUIRED',
      'Slot declaration must be a component path string or an object with a component path.',
      path
    );
    return;
  }

  const componentPath = typeof declaration === 'string' ? path : `${path}.component`;
  validatePluginModulePath(component, componentPath, 'Slot component', diagnostics);

  const priority =
    typeof declaration === 'object' && declaration !== null ? declaration.priority : undefined;
  if (
    priority !== undefined &&
    (typeof priority !== 'number' || !Number.isFinite(priority) || priority < 0)
  ) {
    addError(
      diagnostics,
      'PLUGIN_SLOT_PRIORITY_INVALID',
      'Slot priority must be a non-negative number.',
      `${path}.priority`
    );
  }
}

function validateSlots(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  for (const [slotName, declarationOrDeclarations] of Object.entries(definition.slots ?? {})) {
    const basePath = `slots.${slotName}`;

    if (!validateSlotName(definition, slotName, basePath, diagnostics)) {
      continue;
    }

    if (slotName.startsWith('site.') && slotName.endsWith(':main.replace')) {
      addError(
        diagnostics,
        'PLUGIN_HOST_PAGE_OVERRIDE_SLOT_FORBIDDEN',
        `Host page replace slot "${slotName}" must be declared through hostPages.overrides.`,
        basePath,
        'Move this declaration to hostPages.overrides and declare Permission.HostPageOverride.'
      );
      continue;
    }

    const declarations = Array.isArray(declarationOrDeclarations)
      ? declarationOrDeclarations
      : [declarationOrDeclarations];

    declarations.forEach((declaration, index) =>
      validateSlotDeclaration(declaration, `${basePath}.${index}`, diagnostics)
    );
  }
}

function validateHostPages(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  const hostPages = definition.hostPages;
  if (!hostPages) {
    return;
  }

  validateHostPageSlots(definition, hostPages, diagnostics);
  validateHostPageOverrides(definition, hostPages, diagnostics);
}

function validateHostPageSlots(
  definition: PluginDefinition,
  hostPages: PluginHostPagesDefinition,
  diagnostics: PluginDiagnostic[]
): void {
  const slots = hostPages.slots ?? [];

  if (slots.length > 0 && !hasDeclaredPermission(definition, Permission.HostPageExtend)) {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_EXTEND_PERMISSION_REQUIRED',
      'Declaring host page slots requires Permission.HostPageExtend.',
      'hostPages.slots',
      'Add Permission.HostPageExtend to plugin.ts permissions or remove hostPages.slots.'
    );
  }

  for (const [index, slot] of slots.entries()) {
    const basePath = `hostPages.slots.${index}`;
    validateHostPagePath(slot.page, `${basePath}.page`, diagnostics);
    validateHostPageSlotPosition(slot.position, `${basePath}.position`, diagnostics);
    validatePluginModulePath(
      slot.component,
      `${basePath}.component`,
      'Host page slot component',
      diagnostics
    );
    validateHostPagePriority(slot.priority, `${basePath}.priority`, diagnostics);

    if (slot.position === 'main.replace') {
      addError(
        diagnostics,
        'PLUGIN_HOST_PAGE_SLOT_POSITION_FORBIDDEN',
        'hostPages.slots cannot use main.replace. Use hostPages.overrides instead.',
        `${basePath}.position`,
        'Move this entry to hostPages.overrides.'
      );
    }
  }
}

function validateHostPageOverrides(
  definition: PluginDefinition,
  hostPages: PluginHostPagesDefinition,
  diagnostics: PluginDiagnostic[]
): void {
  const overrides = hostPages.overrides ?? [];

  if (overrides.length > 0 && !hasDeclaredPermission(definition, Permission.HostPageOverride)) {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_OVERRIDE_PERMISSION_REQUIRED',
      'Declaring host page overrides requires Permission.HostPageOverride.',
      'hostPages.overrides',
      'Add Permission.HostPageOverride to plugin.ts permissions or remove hostPages.overrides.'
    );
  }

  if (overrides.length > 0 && (!definition.trustLevel || definition.trustLevel === 'untrusted')) {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_OVERRIDE_TRUST_REQUIRED',
      'Host page overrides require trusted or system plugin trust.',
      'trustLevel',
      'Set trustLevel to "trusted" for reviewed host page overrides.'
    );
  }

  const seenPages = new Set<string>();
  for (const [index, override] of overrides.entries()) {
    const basePath = `hostPages.overrides.${index}`;
    const page = normalizeDeclaredRoutePath(override.page);
    validateHostPagePath(override.page, `${basePath}.page`, diagnostics);

    if (seenPages.has(page)) {
      addError(
        diagnostics,
        'PLUGIN_HOST_PAGE_OVERRIDE_DUPLICATE',
        `Host page "${page}" is overridden more than once by this plugin.`,
        `${basePath}.page`,
        'Keep a single override per host page.'
      );
    }
    seenPages.add(page);

    if (!HOST_PAGE_OVERRIDE_MODES.has(override.mode)) {
      addError(
        diagnostics,
        'PLUGIN_HOST_PAGE_OVERRIDE_MODE_INVALID',
        `Unsupported host page override mode "${String(override.mode)}".`,
        `${basePath}.mode`,
        'Use mode: "main.replace".'
      );
    }

    validatePluginModulePath(
      override.component,
      `${basePath}.component`,
      'Host page override component',
      diagnostics
    );
    validateHostPagePriority(override.priority, `${basePath}.priority`, diagnostics);
    validateHostPageShell(override.shell, `${basePath}.shell`, diagnostics);
    validateHostPageSeo(override.seo, `${basePath}.seo`, diagnostics);
    validateHostPageI18n(override.i18n, `${basePath}.i18n`, diagnostics);
    validateHostPageCache(override.cache, `${basePath}.cache`, diagnostics);
  }
}

function validateHostPagePath(
  page: string,
  diagnosticPath: string,
  diagnostics: PluginDiagnostic[]
): void {
  validateAbsolutePath(page, diagnosticPath, 'Host page', diagnostics);

  if (!page.startsWith('/')) {
    return;
  }

  const normalized = normalizeDeclaredRoutePath(page);
  if (!HOST_PAGE_PATHS.has(normalized)) {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_UNKNOWN',
      `Host page "${page}" is not an extendable host page.`,
      diagnosticPath,
      'Use one of: /, /about, /contact, /pricing, /privacy, /terms, /success.'
    );
  }
}

function validateHostPageSlotPosition(
  position: PluginHostPageSlotPosition,
  diagnosticPath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!HOST_PAGE_SLOT_POSITIONS.has(position)) {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_SLOT_POSITION_INVALID',
      `Unsupported host page slot position "${String(position)}".`,
      diagnosticPath,
      'Use hero.before, hero.after, main.before, main.after, or main.replace.'
    );
  }
}

function validateHostPagePriority(
  priority: number | undefined,
  diagnosticPath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (
    priority !== undefined &&
    (typeof priority !== 'number' || !Number.isFinite(priority) || priority < 0)
  ) {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_PRIORITY_INVALID',
      'Host page priority must be a non-negative number.',
      diagnosticPath
    );
  }
}

function validateHostPageShell(
  shell: PluginHostPageShellDefinition | undefined,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!shell) {
    return;
  }

  if (shell.layout !== undefined && !HOST_PAGE_SHELL_LAYOUTS.has(shell.layout)) {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_SHELL_LAYOUT_INVALID',
      `Unsupported host page shell layout "${String(shell.layout)}".`,
      `${basePath}.layout`,
      'Use layout: "site".'
    );
  }

  for (const key of ['header', 'footer'] as const) {
    const value = shell[key];
    if (value !== undefined && !HOST_PAGE_SHELL_CHROME.has(value)) {
      addError(
        diagnostics,
        'PLUGIN_HOST_PAGE_SHELL_CHROME_INVALID',
        `Host page shell ${key} must be "host" or "hidden".`,
        `${basePath}.${key}`
      );
    }
  }

  if (shell.container !== undefined && !HOST_PAGE_SHELL_CONTAINERS.has(shell.container)) {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_SHELL_CONTAINER_INVALID',
      `Unsupported host page shell container "${String(shell.container)}".`,
      `${basePath}.container`,
      'Use fixed, fluid, or full.'
    );
  }

  if (shell.activeMenuPath !== undefined) {
    validateAbsolutePath(
      shell.activeMenuPath,
      `${basePath}.activeMenuPath`,
      'Active menu path',
      diagnostics
    );
  }
}

function validateHostPageSeo(
  seo: PluginHostPageSeoDefinition | undefined,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!seo || typeof seo !== 'object') {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_SEO_REQUIRED',
      'Host page overrides must declare seo metadata.',
      basePath,
      'Add titleKey, descriptionKey, and canonical to the host page override.'
    );
    return;
  }

  if (typeof seo.titleKey === 'string') {
    validatePluginLocalI18nKey(
      seo.titleKey,
      `${basePath}.titleKey`,
      'Host page SEO titleKey',
      diagnostics
    );
  } else {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_SEO_TITLE_KEY_REQUIRED',
      'Host page SEO titleKey is required.',
      `${basePath}.titleKey`
    );
  }

  if (typeof seo.descriptionKey !== 'string') {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_SEO_DESCRIPTION_KEY_REQUIRED',
      'Host page SEO descriptionKey is required.',
      `${basePath}.descriptionKey`
    );
  } else {
    validatePluginLocalI18nKey(
      seo.descriptionKey,
      `${basePath}.descriptionKey`,
      'Host page SEO descriptionKey',
      diagnostics
    );
  }
  if (typeof seo.canonical === 'string') {
    validateAbsolutePath(
      seo.canonical,
      `${basePath}.canonical`,
      'Host page SEO canonical',
      diagnostics
    );
  } else {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_SEO_CANONICAL_REQUIRED',
      'Host page SEO canonical is required.',
      `${basePath}.canonical`
    );
  }

  for (const key of ['fallbackTitle', 'fallbackDescription'] as const) {
    const value = seo[key];
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
      addError(
        diagnostics,
        'PLUGIN_HOST_PAGE_SEO_FALLBACK_INVALID',
        `Host page SEO ${key} must be a non-empty string when provided.`,
        `${basePath}.${key}`
      );
    }
  }

  const robots = seo.robots;
  for (const key of ['index', 'follow'] as const) {
    const value = robots?.[key];
    if (
      value !== undefined &&
      typeof value !== 'boolean' &&
      !ROBOTS_DIRECTIVES.has(String(value))
    ) {
      addError(
        diagnostics,
        'PLUGIN_HOST_PAGE_SEO_ROBOTS_INVALID',
        `Host page SEO robots.${key} is invalid.`,
        `${basePath}.robots.${key}`
      );
    }
  }

  if (seo.openGraph) {
    for (const key of ['titleKey', 'descriptionKey'] as const) {
      const value = seo.openGraph[key];
      if (value !== undefined) {
        validatePluginLocalI18nKey(
          value,
          `${basePath}.openGraph.${key}`,
          `Host page openGraph ${key}`,
          diagnostics
        );
      }
    }
    if (seo.openGraph.image !== undefined) {
      validateAbsolutePath(
        seo.openGraph.image,
        `${basePath}.openGraph.image`,
        'Host page openGraph image',
        diagnostics
      );
    }
  }

  if (seo.structuredData !== undefined) {
    try {
      JSON.stringify(seo.structuredData);
    } catch {
      addError(
        diagnostics,
        'PLUGIN_HOST_PAGE_SEO_STRUCTURED_DATA_INVALID',
        'Host page SEO structuredData must be JSON serializable.',
        `${basePath}.structuredData`
      );
    }
  }

  validateToolSitemap(seo.sitemap, `${basePath}.sitemap`, diagnostics);
}

function validateHostPageI18n(
  i18n: PluginHostPageI18nDefinition | undefined,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!i18n || typeof i18n !== 'object') {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_I18N_REQUIRED',
      'Host page overrides must declare i18n requirements.',
      basePath,
      'Declare requiredLocales and the plugin locale namespaces used by this override.'
    );
    return;
  }

  if (!Array.isArray(i18n.requiredLocales) || i18n.requiredLocales.length === 0) {
    addError(
      diagnostics,
      'PLUGIN_HOST_PAGE_I18N_LOCALES_REQUIRED',
      'Host page override i18n.requiredLocales must include at least one locale.',
      `${basePath}.requiredLocales`
    );
  } else {
    for (const [index, locale] of i18n.requiredLocales.entries()) {
      if (!LOCALE_PATTERN.test(locale)) {
        addError(
          diagnostics,
          'PLUGIN_HOST_PAGE_I18N_LOCALE_INVALID',
          `Host page override locale "${locale}" is invalid.`,
          `${basePath}.requiredLocales.${index}`
        );
      }
    }
  }

  for (const [index, namespace] of (i18n.namespaces ?? []).entries()) {
    validatePluginLocalI18nKey(
      namespace,
      `${basePath}.namespaces.${index}`,
      'Host page i18n namespace',
      diagnostics
    );
  }
}

function validateHostPageCache(
  cache: PluginHostPageCacheDefinition | undefined,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  validateToolCache(cache, basePath, diagnostics);
}

function validateTheme(theme: PluginThemeDefinition | undefined, diagnostics: PluginDiagnostic[]) {
  if (!theme) {
    return;
  }

  if (!theme.tokens || typeof theme.tokens !== 'object') {
    addError(
      diagnostics,
      'PLUGIN_THEME_TOKENS_REQUIRED',
      'Plugin theme declarations must provide a tokens object.',
      'theme.tokens'
    );
    return;
  }

  validateThemeSection(theme.tokens.common, 'theme.tokens.common', diagnostics, {
    colorBg: 'color',
    colorText: 'color',
    colorPrimary: 'color',
    colorPrimaryText: 'color',
    radius: 'length',
    containerMaxW: 'length',
  });
  validateThemeSection(theme.tokens.header, 'theme.tokens.header', diagnostics, {
    height: 'length',
    bg: 'color',
    text: 'color',
    borderBottom: 'border',
    variant: 'headerVariant',
    sticky: 'boolean',
    paddingX: 'length',
    paddingY: 'length',
  });
  validateThemeSection(theme.tokens.footer, 'theme.tokens.footer', diagnostics, {
    bg: 'color',
    text: 'color',
    borderTop: 'border',
    paddingY: 'length',
    paddingX: 'length',
  });
  validateThemeSection(theme.tokens.content, 'theme.tokens.content', diagnostics, {
    paddingY: 'length',
    bg: 'color',
  });
}

function validateThemeSection(
  section: Record<string, unknown> | undefined,
  basePath: string,
  diagnostics: PluginDiagnostic[],
  allowed: Record<string, 'color' | 'length' | 'border' | 'boolean' | 'headerVariant'>
) {
  if (!section) {
    return;
  }

  if (typeof section !== 'object') {
    addError(
      diagnostics,
      'PLUGIN_THEME_SECTION_INVALID',
      'Theme token sections must be objects.',
      basePath
    );
    return;
  }

  for (const [key, value] of Object.entries(section)) {
    const kind = allowed[key];
    const path = `${basePath}.${key}`;

    if (!kind) {
      addError(
        diagnostics,
        'PLUGIN_THEME_TOKEN_UNKNOWN',
        `Theme token "${key}" is not supported by the host contract.`,
        path,
        'Use only the token keys exported in PluginThemeTokenOverrides.'
      );
      continue;
    }

    validateThemeTokenValue(value, kind, path, diagnostics);
  }
}

function validateThemeTokenValue(
  value: unknown,
  kind: 'color' | 'length' | 'border' | 'boolean' | 'headerVariant',
  path: string,
  diagnostics: PluginDiagnostic[]
) {
  if (kind === 'boolean') {
    if (typeof value !== 'boolean') {
      addError(diagnostics, 'PLUGIN_THEME_TOKEN_INVALID', 'Theme token must be a boolean.', path);
    }
    return;
  }

  if (kind === 'headerVariant') {
    if (!['minimal', 'glass', 'solid', 'transparent'].includes(String(value))) {
      addError(
        diagnostics,
        'PLUGIN_THEME_TOKEN_INVALID',
        'Header variant must be minimal, glass, solid, or transparent.',
        path
      );
    }
    return;
  }

  if (typeof value !== 'string' || !value.trim()) {
    addError(diagnostics, 'PLUGIN_THEME_TOKEN_INVALID', 'Theme token must be a string.', path);
    return;
  }

  if (kind === 'color' && !COLOR_VALUE_PATTERN.test(value)) {
    addError(
      diagnostics,
      'PLUGIN_THEME_TOKEN_INVALID',
      'Theme color token must be a safe CSS color value.',
      path
    );
    return;
  }

  if (kind === 'length' && !LENGTH_VALUE_PATTERN.test(value)) {
    addError(
      diagnostics,
      'PLUGIN_THEME_TOKEN_INVALID',
      'Theme length token must use px, rem, em, or %.',
      path
    );
    return;
  }

  if (kind === 'border' && value !== 'none' && !/^\d+px\s+solid\s+#[0-9a-fA-F]{3,8}$/.test(value)) {
    addError(
      diagnostics,
      'PLUGIN_THEME_TOKEN_INVALID',
      'Theme border token must be "none" or a simple px solid hex border.',
      path
    );
  }
}

function validateLifecycle(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  for (const [key, handler] of Object.entries(definition.lifecycle ?? {})) {
    validatePluginModulePath(handler, `lifecycle.${key}`, 'Lifecycle handler', diagnostics);
  }
}

function validateEvents(
  definition: PluginDefinition,
  events: PluginEventDefinition | undefined,
  diagnostics: PluginDiagnostic[]
): void {
  const publishes = events?.publishes ?? [];
  const subscribes = events?.subscribes ?? {};

  if (publishes.length > 0 && !hasDeclaredPermission(definition, Permission.EventsEmit)) {
    addError(
      diagnostics,
      'PLUGIN_EVENT_EMIT_PERMISSION_MISSING',
      'Declaring published events requires Permission.EventsEmit.',
      'permissions',
      'Add Permission.EventsEmit to plugin.ts permissions or remove events.publishes.'
    );
  }

  if (
    Object.keys(subscribes).length > 0 &&
    !hasDeclaredPermission(definition, Permission.EventsSubscribe)
  ) {
    addError(
      diagnostics,
      'PLUGIN_EVENT_SUBSCRIBE_PERMISSION_MISSING',
      'Declaring event subscriptions requires Permission.EventsSubscribe.',
      'permissions',
      'Add Permission.EventsSubscribe to plugin.ts permissions or remove events.subscribes.'
    );
  }

  for (const [index, eventName] of (events?.publishes ?? []).entries()) {
    validateEventName(eventName, `events.publishes.${index}`, diagnostics);
  }

  for (const [eventName, handler] of Object.entries(subscribes)) {
    validateEventName(eventName, `events.subscribes.${eventName}`, diagnostics);
    validatePluginModulePath(
      handler,
      `events.subscribes.${eventName}`,
      'Event subscription handler',
      diagnostics
    );
  }
}

function hasDeclaredPermission(definition: PluginDefinition, permission: PermissionValue): boolean {
  return (definition.permissions ?? []).includes(permission);
}

function validateJobs(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  const jobs = definition.jobs ?? {};

  if (Object.keys(jobs).length > 0 && !hasDeclaredPermission(definition, Permission.JobsRegister)) {
    addError(
      diagnostics,
      'PLUGIN_JOB_PERMISSION_MISSING',
      'Declaring runtime jobs requires Permission.JobsRegister.',
      'permissions',
      'Add Permission.JobsRegister to plugin.ts permissions or remove the jobs declaration.'
    );
  }

  for (const [name, job] of Object.entries(jobs)) {
    const basePath = `jobs.${name}`;

    if (!JOB_NAME_PATTERN.test(name)) {
      addError(
        diagnostics,
        'PLUGIN_JOB_NAME_INVALID',
        `Job name "${name}" must use lowercase letters, numbers, dots, and hyphens.`,
        basePath
      );
    }

    validatePluginModulePath(job.handler, `${basePath}.handler`, 'Job handler', diagnostics);

    if (job.timeoutMs !== undefined && (!Number.isInteger(job.timeoutMs) || job.timeoutMs <= 0)) {
      addError(
        diagnostics,
        'PLUGIN_JOB_TIMEOUT_INVALID',
        'Job timeoutMs must be a positive integer.',
        `${basePath}.timeoutMs`
      );
    }

    if (job.retries !== undefined && (!Number.isInteger(job.retries) || job.retries < 0)) {
      addError(
        diagnostics,
        'PLUGIN_JOB_RETRIES_INVALID',
        'Job retries must be a non-negative integer.',
        `${basePath}.retries`
      );
    }
  }
}

function validateWebhooks(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  const webhooks = definition.webhooks ?? {};
  const webhookPatterns: RoutePatternDeclaration[] = [];

  if (
    Object.keys(webhooks).length > 0 &&
    !hasDeclaredPermission(definition, Permission.WebhookReceive)
  ) {
    addError(
      diagnostics,
      'PLUGIN_WEBHOOK_PERMISSION_MISSING',
      'Declaring webhook routes requires Permission.WebhookReceive.',
      'permissions',
      'Add Permission.WebhookReceive to plugin.ts permissions or remove the webhooks declaration.'
    );
  }

  for (const [name, webhook] of Object.entries(webhooks)) {
    const basePath = `webhooks.${name}`;
    validatePluginRoutePath(
      definition,
      webhook.path,
      `${basePath}.path`,
      'Webhook path',
      diagnostics
    );
    validatePluginModulePath(
      webhook.handler,
      `${basePath}.handler`,
      'Webhook handler',
      diagnostics
    );

    if (webhook.signature && !WEBHOOK_SIGNATURE_POLICIES.has(webhook.signature)) {
      addError(
        diagnostics,
        'PLUGIN_WEBHOOK_SIGNATURE_INVALID',
        `Unsupported webhook signature policy "${webhook.signature}".`,
        `${basePath}.signature`
      );
    }

    for (const [index, method] of (webhook.methods ?? ['POST']).entries()) {
      if (!HTTP_METHODS.has(method)) {
        addError(
          diagnostics,
          'PLUGIN_WEBHOOK_METHOD_INVALID',
          `Unsupported webhook method "${method}".`,
          `${basePath}.methods.${index}`
        );
        continue;
      }

      validateRoutePatternConflict(
        diagnostics,
        webhookPatterns,
        {
          path: webhook.path,
          method,
          declaration: basePath,
        },
        'PLUGIN_RUNTIME_WEBHOOK_ROUTE_CONFLICT',
        'Webhook',
        `${basePath}.methods.${index}`
      );
    }
  }
}

function validateHookDefinition(
  hook: PluginHookDefinition | undefined,
  path: string,
  label: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!hook) {
    return;
  }

  validatePluginModulePath(hook.handler, `${path}.handler`, `${label} hook handler`, diagnostics);

  if (
    hook.priority !== undefined &&
    (typeof hook.priority !== 'number' || !Number.isFinite(hook.priority) || hook.priority < 0)
  ) {
    addError(
      diagnostics,
      'PLUGIN_HOOK_PRIORITY_INVALID',
      `${label} hook priority must be a non-negative number.`,
      `${path}.priority`
    );
  }
}

function validateHooks(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  validateHookDefinition(
    definition.hooks?.renderHead,
    'hooks.renderHead',
    'renderHead',
    diagnostics
  );
  validateHookDefinition(definition.hooks?.sitemap, 'hooks.sitemap', 'sitemap', diagnostics);
}

function validateResources(
  resources: PluginResourcesDefinition | undefined,
  diagnostics: PluginDiagnostic[]
): void {
  for (const [locale, path] of Object.entries(resources?.locales ?? {})) {
    if (!LOCALE_PATTERN.test(locale)) {
      addError(
        diagnostics,
        'PLUGIN_LOCALE_INVALID',
        `Locale "${locale}" must use a format like "en" or "zh-CN".`,
        `resources.locales.${locale}`
      );
    }

    validatePluginRelativePath(path, `resources.locales.${locale}`, 'Locale resource', diagnostics);
  }

  for (const [index, asset] of (resources?.assets ?? []).entries()) {
    validateAssetDeclaration(asset, `resources.assets.${index}`, diagnostics);
  }
}

function getAssetPath(asset: string | PluginAssetDeclaration): string | undefined {
  return typeof asset === 'string' ? asset : asset.path;
}

function fileExtension(path: string): string {
  const index = path.lastIndexOf('.');
  return index >= 0 ? path.slice(index).toLowerCase() : '';
}

function validateAssetDeclaration(
  asset: string | PluginAssetDeclaration,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  const assetPath = getAssetPath(asset);
  if (!assetPath) {
    addError(
      diagnostics,
      'PLUGIN_ASSET_PATH_REQUIRED',
      'Asset declaration requires a path.',
      `${basePath}.path`
    );
    return;
  }

  validatePluginRelativePath(
    assetPath,
    typeof asset === 'string' ? basePath : `${basePath}.path`,
    'Asset resource',
    diagnostics
  );

  if (!assetPath.replace(/^\.\//, '').startsWith('assets/')) {
    addError(
      diagnostics,
      'PLUGIN_ASSET_PATH_INVALID',
      `Asset "${assetPath}" must live under ./assets/.`,
      typeof asset === 'string' ? basePath : `${basePath}.path`,
      'Move frontend assets under ./assets/ and declare that path.'
    );
  }

  const extension = fileExtension(assetPath);
  if (!ASSET_EXTENSIONS.has(extension)) {
    addError(
      diagnostics,
      'PLUGIN_ASSET_EXTENSION_INVALID',
      `Asset "${assetPath}" uses unsupported extension "${extension || '(none)'}".`,
      typeof asset === 'string' ? basePath : `${basePath}.path`
    );
  }

  const inferredKind = inferAssetKind(assetPath);
  if (inferredKind !== 'asset' && (typeof asset === 'string' || asset.kind !== inferredKind)) {
    addError(
      diagnostics,
      inferredKind === 'worker'
        ? 'PLUGIN_ASSET_WORKER_DECLARATION_REQUIRED'
        : 'PLUGIN_ASSET_WASM_DECLARATION_REQUIRED',
      `Asset "${assetPath}" must be explicitly declared with kind: "${inferredKind}".`,
      typeof asset === 'string' ? basePath : `${basePath}.kind`,
      `Use { path: "${assetPath}", kind: "${inferredKind}" } in resources.assets.`
    );
  }

  if (typeof asset !== 'string') {
    if (asset.kind !== undefined && !ASSET_KINDS.has(asset.kind)) {
      addError(
        diagnostics,
        'PLUGIN_ASSET_KIND_INVALID',
        `Asset kind "${String(asset.kind)}" is invalid.`,
        `${basePath}.kind`
      );
    }

    if (asset.kind === 'worker' && !['.js', '.mjs'].includes(extension)) {
      addError(
        diagnostics,
        'PLUGIN_ASSET_WORKER_INVALID',
        'Worker assets must use .js or .mjs.',
        `${basePath}.path`
      );
    }

    if (asset.kind === 'wasm' && extension !== '.wasm') {
      addError(
        diagnostics,
        'PLUGIN_ASSET_WASM_INVALID',
        'WASM assets must use .wasm.',
        `${basePath}.path`
      );
    }

    if (
      asset.maxBytes !== undefined &&
      (!Number.isInteger(asset.maxBytes) ||
        asset.maxBytes <= 0 ||
        asset.maxBytes > 100 * 1024 * 1024)
    ) {
      addError(
        diagnostics,
        'PLUGIN_ASSET_SIZE_INVALID',
        'Asset maxBytes must be a positive integer at most 100MB.',
        `${basePath}.maxBytes`
      );
    }

    if (asset.cache) {
      validateToolCache(asset.cache, `${basePath}.cache`, diagnostics);
    }
  }
}

function inferAssetKind(assetPath: string): 'asset' | 'worker' | 'wasm' {
  const normalizedPath = assetPath.toLowerCase();
  const extension = fileExtension(normalizedPath);

  if (extension === '.wasm') {
    return 'wasm';
  }

  if (
    normalizedPath.includes('.worker.') ||
    normalizedPath.endsWith('/worker.js') ||
    normalizedPath.endsWith('/worker.mjs')
  ) {
    return 'worker';
  }

  return 'asset';
}

function validateConfig(
  config: PluginConfigDefinition | undefined,
  diagnostics: PluginDiagnostic[]
): void {
  if (config?.component) {
    validatePluginModulePath(config.component, 'config.component', 'Config component', diagnostics);
  }
}

function validateMeters(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  const seen = new Set<string>();
  for (const [index, meter] of (definition.meters ?? []).entries()) {
    const basePath = `meters.${index}`;
    validateMeterDefinition(definition, meter, basePath, diagnostics);
    if (seen.has(meter.id)) {
      addError(
        diagnostics,
        'PLUGIN_METER_DUPLICATE',
        `Meter "${meter.id}" is declared more than once.`,
        `${basePath}.id`,
        'Remove the duplicate meter declaration.'
      );
    }
    seen.add(meter.id);
  }
}

function validateServices(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  const services = definition.services ?? [];
  const seen = new Set<string>();

  if (services.length > 0 && !hasDeclaredPermission(definition, Permission.ServicesInvoke)) {
    addError(
      diagnostics,
      'PLUGIN_SERVICE_PERMISSION_MISSING',
      'Declaring internal services requires Permission.ServicesInvoke.',
      'permissions',
      'Add Permission.ServicesInvoke to plugin.ts permissions or remove services.'
    );
  }

  for (const [index, service] of services.entries()) {
    const basePath = `services.${index}`;
    if (!SERVICE_NAME_PATTERN.test(service.name)) {
      addError(
        diagnostics,
        'PLUGIN_SERVICE_NAME_INVALID',
        `Service name "${service.name}" may only contain letters, numbers, dots, underscores, colons, and hyphens.`,
        `${basePath}.name`
      );
    }

    if (seen.has(service.name)) {
      addError(
        diagnostics,
        'PLUGIN_SERVICE_DUPLICATE',
        `Service "${service.name}" is declared more than once.`,
        `${basePath}.name`,
        'Merge duplicate service declarations.'
      );
    }
    seen.add(service.name);

    if (!service.methods?.length) {
      addError(
        diagnostics,
        'PLUGIN_SERVICE_METHODS_REQUIRED',
        `Service "${service.name}" must declare allowed methods.`,
        `${basePath}.methods`
      );
    }

    for (const [methodIndex, method] of (service.methods ?? []).entries()) {
      if (!HTTP_METHODS.has(method)) {
        addError(
          diagnostics,
          'PLUGIN_SERVICE_METHOD_INVALID',
          `Unsupported service method "${method}".`,
          `${basePath}.methods.${methodIndex}`
        );
      }
    }

    if (!service.paths?.length) {
      addError(
        diagnostics,
        'PLUGIN_SERVICE_PATHS_REQUIRED',
        `Service "${service.name}" must declare allowed paths.`,
        `${basePath}.paths`
      );
    }

    for (const [pathIndex, servicePath] of (service.paths ?? []).entries()) {
      const pathValue = servicePath.replace(/\/\*\*$/, '');
      validateAbsolutePath(
        pathValue || '/',
        `${basePath}.paths.${pathIndex}`,
        'Service path',
        diagnostics
      );
      if (/^https?:\/\//i.test(servicePath)) {
        addError(
          diagnostics,
          'PLUGIN_SERVICE_PATH_ABSOLUTE_FORBIDDEN',
          `Service path "${servicePath}" must be service-local, not an absolute URL.`,
          `${basePath}.paths.${pathIndex}`
        );
      }
    }
  }
}

function validateResourceBindingRoles(
  roles: readonly PluginResourceBindingRole[] | undefined,
  path: string,
  diagnostics: PluginDiagnostic[]
): void {
  for (const [index, role] of (roles ?? []).entries()) {
    if (!RESOURCE_BINDING_ROLES.has(role)) {
      addError(
        diagnostics,
        'PLUGIN_RESOURCE_BINDING_ROLE_INVALID',
        `Unsupported resource binding role "${String(role)}".`,
        `${path}.${index}`
      );
    }
  }
}

function validateResourceBindings(
  definition: PluginDefinition,
  diagnostics: PluginDiagnostic[]
): void {
  const bindings = definition.resourceBindings ?? [];
  const seen = new Set<string>();

  if (
    bindings.length > 0 &&
    !hasDeclaredPermission(definition, Permission.ResourceBindingsRead) &&
    !hasDeclaredPermission(definition, Permission.ResourceBindingsWrite)
  ) {
    addError(
      diagnostics,
      'PLUGIN_RESOURCE_BINDING_PERMISSION_MISSING',
      'Declaring resource bindings requires ResourceBindingsRead or ResourceBindingsWrite.',
      'permissions',
      'Add Permission.ResourceBindingsRead or Permission.ResourceBindingsWrite to plugin.ts permissions.'
    );
  }

  for (const [index, binding] of bindings.entries()) {
    const basePath = `resourceBindings.${index}`;
    if (!RESOURCE_BINDING_TYPE_PATTERN.test(binding.type)) {
      addError(
        diagnostics,
        'PLUGIN_RESOURCE_BINDING_TYPE_INVALID',
        `Resource binding type "${binding.type}" may only contain letters, numbers, dots, underscores, colons, and hyphens.`,
        `${basePath}.type`
      );
    }

    if (!RESOURCE_BINDING_SCOPES.has(binding.scope)) {
      addError(
        diagnostics,
        'PLUGIN_RESOURCE_BINDING_SCOPE_INVALID',
        `Resource binding scope "${String(binding.scope)}" is invalid.`,
        `${basePath}.scope`
      );
    }

    const key = `${binding.scope}:${binding.type}`;
    if (seen.has(key)) {
      addError(
        diagnostics,
        'PLUGIN_RESOURCE_BINDING_DUPLICATE',
        `Resource binding "${binding.type}" for ${binding.scope} scope is declared more than once.`,
        `${basePath}.type`
      );
    }
    seen.add(key);

    if (binding.cardinality && !RESOURCE_BINDING_CARDINALITIES.has(binding.cardinality)) {
      addError(
        diagnostics,
        'PLUGIN_RESOURCE_BINDING_CARDINALITY_INVALID',
        `Resource binding cardinality "${String(binding.cardinality)}" is invalid.`,
        `${basePath}.cardinality`
      );
    }

    validateResourceBindingRoles(
      binding.permissions?.read,
      `${basePath}.permissions.read`,
      diagnostics
    );
    validateResourceBindingRoles(
      binding.permissions?.write,
      `${basePath}.permissions.write`,
      diagnostics
    );
  }
}

function validateMeterDefinition(
  definition: PluginDefinition,
  meter: PluginMeterDefinition,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (typeof meter.id !== 'string' || !METER_ID_PATTERN.test(meter.id)) {
    addError(
      diagnostics,
      'PLUGIN_METER_ID_INVALID',
      `Meter id "${String(meter.id)}" must use lowercase letters, numbers, dots, and hyphens.`,
      `${basePath}.id`,
      'Use a namespaced meter like "my-plugin.ocr.page".'
    );
  } else if (!meter.id.startsWith(`${definition.id}.`)) {
    addError(
      diagnostics,
      'PLUGIN_METER_NAMESPACE_INVALID',
      `Meter "${meter.id}" must start with "${definition.id}.".`,
      `${basePath}.id`,
      `Rename the meter to start with "${definition.id}.".`
    );
  }

  if (typeof meter.unit !== 'string' || !meter.unit.trim()) {
    addError(
      diagnostics,
      'PLUGIN_METER_UNIT_INVALID',
      `Meter "${String(meter.id)}" must declare a unit.`,
      `${basePath}.unit`,
      'Use a unit such as "item", "request", "page", "minute", "token", or "byte".'
    );
  }

  if (
    meter.defaultCreditCost !== undefined &&
    (!Number.isInteger(meter.defaultCreditCost) || meter.defaultCreditCost < 0)
  ) {
    addError(
      diagnostics,
      'PLUGIN_METER_CREDIT_COST_INVALID',
      `Meter "${String(meter.id)}" defaultCreditCost must be a non-negative integer.`,
      `${basePath}.defaultCreditCost`
    );
  }

  if (meter.billable !== undefined && typeof meter.billable !== 'boolean') {
    addError(
      diagnostics,
      'PLUGIN_METER_BILLABLE_INVALID',
      `Meter "${String(meter.id)}" billable must be a boolean.`,
      `${basePath}.billable`
    );
  }
}

function validateEgress(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  for (const [index, origin] of (definition.egress ?? []).entries()) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new TypeError('Unsupported protocol.');
      }

      if (
        url.origin !== origin.replace(/\/$/, '') ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      ) {
        throw new TypeError('Egress must be an origin.');
      }
    } catch {
      addError(
        diagnostics,
        'PLUGIN_EGRESS_INVALID',
        `Egress origin "${origin}" must be a valid http(s) origin.`,
        `egress.${index}`,
        'Use an origin like "https://api.example.com"; do not include a path, query, or hash.'
      );
    }
  }
}

function validateData(definition: PluginDefinition, diagnostics: PluginDiagnostic[]): void {
  if (
    definition.data?.version !== undefined &&
    (!Number.isInteger(definition.data.version) || definition.data.version <= 0)
  ) {
    addError(
      diagnostics,
      'PLUGIN_DATA_VERSION_INVALID',
      'Plugin data.version must be a positive integer.',
      'data.version',
      'Use data.version: 1 and increment it when changing collection schema.'
    );
  }

  for (const [collectionName, collection] of Object.entries(definition.data?.collections ?? {})) {
    const basePath = `data.collections.${collectionName}`;

    if (!COLLECTION_NAME_PATTERN.test(collectionName)) {
      addError(
        diagnostics,
        'PLUGIN_COLLECTION_NAME_INVALID',
        `Collection name "${collectionName}" must use lowercase letters, numbers, and underscores.`,
        basePath,
        'Use a name like "todos" or "customer_notes".'
      );
    }

    validateCollection(collection, basePath, diagnostics);
  }
}

function validateCollection(
  collection: PluginCollectionDefinition,
  basePath: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (Object.keys(collection.fields).length === 0) {
    addError(
      diagnostics,
      'PLUGIN_COLLECTION_FIELDS_REQUIRED',
      'Collection must declare at least one field.',
      `${basePath}.fields`
    );
  }

  for (const [fieldName, field] of Object.entries(collection.fields)) {
    const fieldPath = `${basePath}.fields.${fieldName}`;

    if (!FIELD_NAME_PATTERN.test(fieldName)) {
      addError(
        diagnostics,
        'PLUGIN_COLLECTION_FIELD_NAME_INVALID',
        `Field name "${fieldName}" must use lowercase letters, numbers, and underscores.`,
        fieldPath
      );
    }

    validateField(field, fieldPath, diagnostics);
  }

  for (const [index, indexDefinition] of (collection.indexes ?? []).entries()) {
    for (const [fieldIndex, fieldName] of indexDefinition.fields.entries()) {
      if (!collection.fields[fieldName]) {
        addError(
          diagnostics,
          'PLUGIN_COLLECTION_INDEX_FIELD_UNKNOWN',
          `Index references unknown field "${fieldName}".`,
          `${basePath}.indexes.${index}.fields.${fieldIndex}`
        );
      }
    }
  }
}

function validateField(
  field: PluginCollectionField,
  fieldPath: string,
  diagnostics: PluginDiagnostic[]
): void {
  const definition: PluginCollectionFieldDefinition =
    typeof field === 'string' ? { type: field } : field;
  const normalizedType = definition.type.endsWith('?')
    ? definition.type.slice(0, -1)
    : definition.type;

  if (!FIELD_BASE_TYPES.has(normalizedType as PluginCollectionFieldBase)) {
    addError(
      diagnostics,
      'PLUGIN_COLLECTION_FIELD_TYPE_INVALID',
      `Unsupported field type "${definition.type}".`,
      `${fieldPath}.type`
    );
  }

  if (
    definition.maxLength !== undefined &&
    (!Number.isInteger(definition.maxLength) || definition.maxLength <= 0)
  ) {
    addError(
      diagnostics,
      'PLUGIN_COLLECTION_FIELD_MAX_LENGTH_INVALID',
      'Field maxLength must be a positive integer.',
      `${fieldPath}.maxLength`
    );
  }
}

function validateAbsolutePath(
  path: string,
  diagnosticPath: string,
  label: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!path.startsWith('/')) {
    addError(
      diagnostics,
      'PLUGIN_PATH_NOT_ABSOLUTE',
      `${label} "${path}" must start with "/".`,
      diagnosticPath
    );
  }

  if (path.includes('//')) {
    addError(
      diagnostics,
      'PLUGIN_PATH_INVALID',
      `${label} "${path}" must not contain duplicate slashes.`,
      diagnosticPath
    );
  }
}

function validatePluginRoutePath(
  definition: PluginDefinition,
  routePath: string,
  diagnosticPath: string,
  label: string,
  diagnostics: PluginDiagnostic[]
): void {
  validateAbsolutePath(routePath, diagnosticPath, label, diagnostics);

  if (!routePath.startsWith('/')) {
    return;
  }

  const normalizedPath = normalizeDeclaredRoutePath(routePath);
  if (isHostMountedPath(normalizedPath, definition.id)) {
    addError(
      diagnostics,
      'PLUGIN_ROUTE_PATH_NOT_LOCAL',
      `${label} "${routePath}" must be plugin-local. Do not include host prefixes like /plugins, /api/plugins, /dashboard, /admin, or the plugin id.`,
      diagnosticPath,
      'Use a local path such as "/", "/items", or "/settings". The host will mount it automatically.'
    );
  }
}

function isReservedPublicAliasPath(routePath: string): boolean {
  if (PUBLIC_ALIAS_RESERVED_EXACT_PATHS.has(routePath)) {
    return true;
  }

  return PUBLIC_ALIAS_RESERVED_PREFIXES.some((prefix) => startsWithPath(routePath, prefix));
}

function validatePublicAliasPath(
  aliasPath: string,
  diagnosticPath: string,
  diagnostics: PluginDiagnostic[]
): void {
  validateAbsolutePath(aliasPath, diagnosticPath, 'Public route alias', diagnostics);

  if (!aliasPath.startsWith('/')) {
    return;
  }

  const normalizedPath = normalizeDeclaredRoutePath(aliasPath);
  if (isReservedPublicAliasPath(normalizedPath)) {
    addError(
      diagnostics,
      'PLUGIN_PUBLIC_ALIAS_RESERVED',
      `Public route alias "${aliasPath}" conflicts with a host-reserved route.`,
      diagnosticPath,
      'Use an unreserved public namespace such as /blog, /docs, /products, or /templates.'
    );
  }
}

function normalizeDeclaredRoutePath(routePath: string): string {
  return normalizePluginRoutePath(routePath);
}

function startsWithPath(value: string, prefix: string): boolean {
  return value === prefix || value.startsWith(`${prefix}/`);
}

function isHostMountedPath(routePath: string, pluginId: string): boolean {
  const hostPrefixes = ['/api/plugins', '/plugins', '/dashboard', '/admin'];

  if (hostPrefixes.some((prefix) => startsWithPath(routePath, prefix))) {
    return true;
  }

  return pluginId.length > 0 && startsWithPath(routePath, `/${pluginId}`);
}

function validateAuth(
  auth: PluginRouteAuth | undefined,
  path: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (auth === undefined) {
    return;
  }

  if (!ROUTE_AUTHS.has(auth)) {
    addError(
      diagnostics,
      'PLUGIN_ROUTE_AUTH_INVALID',
      `Unsupported route auth contract "${String(auth)}".`,
      path,
      'Use "public", "auth", or "admin".'
    );
  }
}

function validateMachineAuth(
  machineAuth: PluginRouteMachineAuth | undefined,
  path: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (machineAuth === undefined) {
    return;
  }

  if (!ROUTE_MACHINE_AUTHS.has(machineAuth)) {
    addError(
      diagnostics,
      'PLUGIN_ROUTE_MACHINE_AUTH_INVALID',
      `Unsupported route machineAuth contract "${String(machineAuth)}".`,
      path,
      'Use "apiKey" or remove machineAuth.'
    );
  }
}

function validateLayout(
  layout: PluginRouteLayout | undefined,
  path: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (layout === undefined) {
    return;
  }

  if (!ROUTE_LAYOUTS.has(layout)) {
    addError(diagnostics, 'PLUGIN_ROUTE_LAYOUT_INVALID', `Unsupported layout "${layout}".`, path);
  }
}

function validateEventName(eventName: string, path: string, diagnostics: PluginDiagnostic[]): void {
  if (!EVENT_NAME_PATTERN.test(eventName)) {
    addError(
      diagnostics,
      'PLUGIN_EVENT_NAME_INVALID',
      `Event name "${eventName}" must use lowercase letters, numbers, dots, and hyphens.`,
      path
    );
  }
}

function validatePluginModulePath(
  modulePath: string,
  diagnosticPath: string,
  label: string,
  diagnostics: PluginDiagnostic[]
): void {
  validatePluginRelativePath(modulePath, diagnosticPath, label, diagnostics);
}

function validatePluginRelativePath(
  resourcePath: string,
  diagnosticPath: string,
  label: string,
  diagnostics: PluginDiagnostic[]
): void {
  if (!resourcePath.startsWith('./')) {
    addError(
      diagnostics,
      'PLUGIN_MODULE_PATH_INVALID',
      `${label} "${resourcePath}" must be a plugin-local relative path starting with "./".`,
      diagnosticPath,
      'Move the file inside the plugin directory and reference it with a ./ path.'
    );
    return;
  }

  if (resourcePath.includes('../')) {
    addError(
      diagnostics,
      'PLUGIN_MODULE_PATH_ESCAPES_ROOT',
      `${label} "${resourcePath}" must not escape the plugin directory.`,
      diagnosticPath
    );
  }
}

function toArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value as T];
}
