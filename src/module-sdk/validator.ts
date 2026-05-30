import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import type { ModuleDataDefinition } from './data';
import {
  ModulePermissionValues,
  Permission,
  SystemOnlyPermissions,
  type PermissionValue,
} from './permissions';
import { PRESENTATION_THEME_ALLOWED_TOKENS } from './presentation';
import type {
  ModuleApiRoute,
  ModuleCommercialRequirement,
  ModuleDefinition,
  ModuleHttpMethod,
  ModuleLifecycleDefinition,
  ModulePageRoute,
  ModuleProductShell,
  ModuleRouteAuth,
  ModuleServiceOperationDefinition,
} from './types';

const MODULE_ID_PATTERN = /^[a-z0-9-]+$/;
const MODULE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const SERVICE_NAME_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;
const SERVICE_OPERATION_PATTERN = /^[a-z][a-zA-Z0-9_.:-]*$/;
const I18N_NAMESPACE_PATTERN = /^[a-z][a-z0-9_-]*$/;
const ACTION_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;
const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_.:-]*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
const LOCAL_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;
const ORIGIN_PATTERN = /^https?:\/\/[^/\s]+$/;

const ROUTE_AUTHS = new Set<ModuleRouteAuth>(['public', 'auth', 'admin']);
const HTTP_METHODS = new Set<ModuleHttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const MACHINE_AUTHS = new Set(['apiKey', 'user-or-apiKey']);
const WEBHOOK_SIGNATURES = new Set(['none', 'hmac-sha256', 'stripe', 'github']);
const CACHE_STRATEGIES = new Set(['none', 'public', 'private']);
const ANONYMOUS_POLICY_CAPTCHAS = new Set(['never', 'auto', 'always']);
const ACTION_SIDE_EFFECTS = new Set(['none', 'read', 'write', 'external', 'billing', 'destructive']);
const SURFACE_VISIBILITY_MODES = new Set([
  'always',
  'authenticated',
  'admin',
  'permission',
  'feature',
]);
const SURFACE_RESPONSIVE_PLACEMENTS = new Set(['inline', 'stack', 'drawer', 'modal']);
const SURFACE_FALLBACK_BEHAVIORS = new Set(['hide', 'host', 'placeholder']);
const PAGE_METADATA_REQUIRED_FIELDS = new Set([
  'title',
  'description',
  'canonical',
  'sitemap',
  'openGraph',
]);
const RATE_LIMIT_WINDOW_PATTERN = /^\d+(ms|s|m|h|d)$/;
const DATA_MIGRATION_MODES = new Set(['generated', 'sql']);
const LIFECYCLE_HOOKS = new Set([
  'install',
  'enable',
  'disable',
  'update',
  'seed',
  'activate',
  'deactivate',
  'reset',
]);
const RESERVED_PUBLIC_ALIAS_PATHS = new Set([
  '/',
  '/about',
  '/pricing',
  '/login',
  '/signup',
  '/sign-in',
  '/sign-up',
]);
const RESERVED_PUBLIC_ALIAS_PREFIXES = ['/api', '/admin', '/dashboard'];
const HOST_THEME_ALLOWED_TOKENS = new Set<string>(PRESENTATION_THEME_ALLOWED_TOKENS);
const DATA_SCOPES = new Set(['user', 'workspace', 'product', 'public-read', 'system']);
const SERVICE_CONNECTION_KINDS = new Set(['signed-http']);
const SERVICE_RETRY_BACKOFFS = new Set(['none', 'linear', 'exponential']);
const SERVICE_REQUEST_BODIES = new Set(['none', 'json', 'text']);
const SERVICE_RESPONSE_BODIES = new Set(['json', 'text', 'raw']);
const PRODUCT_KINDS = new Set(['tool', 'product', 'platform']);
const PRODUCT_SHELLS = new Set<ModuleProductShell>(['site', 'dashboard', 'admin']);
const PRODUCT_SHELL_NAVIGATION: Record<ModuleProductShell, readonly string[]> = {
  site: ['site.header', 'site.footer'],
  dashboard: ['dashboard.sidebar'],
  admin: ['admin.sidebar'],
};
const SERVICE_AUTH_TYPES = new Set(['none', 'bearer']);
const SERVICE_SIGNING_TYPES = new Set(['none', 'hmac-sha256']);
const SERVICE_INPUT_FIELDS = new Set(['url', 'path', 'method', 'headers', 'query', 'body', 'json']);
const SERVICE_SIGNING_CANONICAL_FIELDS = new Set([
  'method',
  'path',
  'timestamp',
  'bodySha256',
  'claimsSha256',
]);
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const MANAGED_SERVICE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-service-signature',
  'x-service-timestamp',
  'x-service-claims',
]);

function operationManagedServiceHeaders(operation: ModuleServiceOperationDefinition): Set<string> {
  const headers = new Set(MANAGED_SERVICE_HEADERS);
  if (operation.auth?.type === 'bearer') {
    headers.add((operation.auth.header ?? 'authorization').toLowerCase());
  }
  if (operation.signing?.type === 'hmac-sha256') {
    headers.add((operation.signing.header ?? 'x-service-signature').toLowerCase());
    headers.add((operation.signing.timestampHeader ?? 'x-service-timestamp').toLowerCase());
    headers.add((operation.signing.claimsHeader ?? 'x-service-claims').toLowerCase());
  }
  return headers;
}
const DOCUMENT_FIELD_TYPES = new Set([
  'string',
  'string?',
  'text',
  'text?',
  'number',
  'number?',
  'integer',
  'integer?',
  'boolean',
  'boolean?',
  'date',
  'date?',
  'datetime',
  'datetime?',
  'json',
  'json?',
]);
const COLUMN_KINDS = new Set([
  'uuid',
  'text',
  'integer',
  'number',
  'boolean',
  'jsonb',
  'timestamp',
]);
const DATA_STANDARD_COLUMNS = new Set([
  'id',
  'product_id',
  'module_id',
  'scope_type',
  'scope_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'created_by',
  'updated_by',
]);
const DATA_RELATION_ON_DELETE = new Set(['cascade', 'restrict', 'set-null']);

function addDiagnostic(
  diagnostics: ModuleDiagnostic[],
  severity: ModuleDiagnostic['severity'],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity, message, path, fix }));
}

function addError(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  addDiagnostic(diagnostics, 'error', code, message, path, fix);
}

function addWarning(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  addDiagnostic(diagnostics, 'warning', code, message, path, fix);
}

function validateKey(
  diagnostics: ModuleDiagnostic[],
  key: string,
  path: string,
  label: string
): void {
  if (!MODULE_KEY_PATTERN.test(key)) {
    addError(
      diagnostics,
      'MODULE_KEY_INVALID',
      `${label} "${key}" must use snake_case and start with a letter.`,
      path,
      'Use a key like "orders", "blog_posts", or "create_order".'
    );
  }
}

function validateLocalModulePath(
  diagnostics: ModuleDiagnostic[],
  value: string | undefined,
  path: string,
  label: string,
  required = true
): void {
  if (!value) {
    if (required) {
      addError(diagnostics, 'MODULE_LOCAL_PATH_REQUIRED', `${label} path is required.`, path);
    }
    return;
  }

  if (!LOCAL_PATH_PATTERN.test(value)) {
    addError(
      diagnostics,
      'MODULE_LOCAL_PATH_INVALID',
      `${label} path "${value}" must be a local module path and must not escape the module root.`,
      path,
      'Use a path like "./api/run" or "./pages/HomePage".'
    );
  }
}

function validateContractParts(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  for (const [partName, partPath] of Object.entries(definition.parts ?? {})) {
    validateLocalModulePath(diagnostics, partPath, `parts.${partName}`, `Contract ${partName} part`);
  }

  const parts = definition.parts;
  if (!parts) {
    return;
  }

  if (parts.data && !definition.data) {
    addError(
      diagnostics,
      'MODULE_PART_DATA_NOT_WIRED',
      'parts.data is declared, but module.ts does not expose a data contract.',
      'parts.data',
      'Import the data definition in module.ts and assign it to data.'
    );
  }

  if (parts.routes && !definition.routes) {
    addError(
      diagnostics,
      'MODULE_PART_ROUTES_NOT_WIRED',
      'parts.routes is declared, but module.ts does not expose a routes contract.',
      'parts.routes',
      'Import the route definition in module.ts and assign it to routes.'
    );
  }

  if (parts.presentation && !definition.presentation) {
    addError(
      diagnostics,
      'MODULE_PART_PRESENTATION_NOT_WIRED',
      'parts.presentation is declared, but module.ts does not expose a presentation contract.',
      'parts.presentation',
      'Import the presentation definition in module.ts and assign it to presentation.'
    );
  }

  if (parts.theme && !definition.theme) {
    addError(
      diagnostics,
      'MODULE_PART_THEME_NOT_WIRED',
      'parts.theme is declared, but module.ts does not expose a theme contract.',
      'parts.theme',
      'Import the theme definition in module.ts and assign it to theme.'
    );
  }

  if (parts.i18n && !definition.i18n) {
    addError(
      diagnostics,
      'MODULE_PART_I18N_NOT_WIRED',
      'parts.i18n is declared, but module.ts does not expose an i18n contract.',
      'parts.i18n',
      'Import the i18n definition in module.ts and assign it to i18n.'
    );
  }
}

function validatePermissionList(
  diagnostics: ModuleDiagnostic[],
  permissions: readonly string[] | undefined,
  path: string
): void {
  for (const [index, permission] of (permissions ?? []).entries()) {
    const itemPath = `${path}.${index}`;
    const permissionValue = permission as PermissionValue;
    if (!ModulePermissionValues.has(permissionValue)) {
      addError(
        diagnostics,
        'MODULE_PERMISSION_UNKNOWN',
        `Permission "${permission}" is not part of @ploykit/module-sdk.`,
        itemPath
      );
      continue;
    }

    if (SystemOnlyPermissions.has(permissionValue)) {
      addWarning(
        diagnostics,
        'MODULE_SYSTEM_PERMISSION_CONTEXT_BOUND',
        `System permission "${permission}" can only be executed by CLI or host system context.`,
        itemPath,
        'Keep it only when the capability is used outside request runtime.'
      );
    }
  }
}

function validateDeclaredPermissionList(
  diagnostics: ModuleDiagnostic[],
  permissions: readonly string[] | undefined,
  modulePermissions: ReadonlySet<string>,
  path: string
): void {
  for (const [index, permission] of (permissions ?? []).entries()) {
    const permissionValue = permission as PermissionValue;
    if (!ModulePermissionValues.has(permissionValue)) {
      continue;
    }
    if (!modulePermissions.has(permissionValue)) {
      addError(
        diagnostics,
        'MODULE_ENTRY_PERMISSION_NOT_DECLARED',
        `Entry permission "${permission}" must also be declared in module permissions.`,
        `${path}.${index}`,
        'Add the permission to the top-level permissions array.'
      );
    }
  }
}

function isReservedPublicAlias(value: string): boolean {
  if (RESERVED_PUBLIC_ALIAS_PATHS.has(value)) {
    return true;
  }

  return RESERVED_PUBLIC_ALIAS_PREFIXES.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`)
  );
}

function validateCommercialRequirement(
  diagnostics: ModuleDiagnostic[],
  commercial: ModuleCommercialRequirement | undefined,
  path: string
): void {
  if (!commercial) {
    return;
  }

  for (const [field, values] of [
    ['entitlements', commercial.entitlements ?? []],
    ['plans', commercial.plans ?? []],
  ] as const) {
    for (const [index, value] of values.entries()) {
      if (!value.trim()) {
        addError(
          diagnostics,
          'MODULE_COMMERCIAL_REQUIREMENT_EMPTY',
          `Commercial ${field} entry must not be empty.`,
          `${path}.${field}.${index}`
        );
      }
    }
  }

  if (commercial.meter !== undefined && !commercial.meter.trim()) {
    addError(
      diagnostics,
      'MODULE_COMMERCIAL_METER_EMPTY',
      'Commercial meter must not be empty when declared.',
      `${path}.meter`
    );
  }

  if (commercial.credits && commercial.credits.amount <= 0) {
    addError(
      diagnostics,
      'MODULE_COMMERCIAL_CREDITS_INVALID',
      'Commercial credits amount must be greater than zero.',
      `${path}.credits.amount`
    );
  }
}

function validateRouteBase(
  diagnostics: ModuleDiagnostic[],
  route: {
    path: string;
    auth?: ModuleRouteAuth;
    permissions?: readonly string[];
    commercial?: ModuleCommercialRequirement;
  },
  path: string
): void {
  if (!route.path?.startsWith('/')) {
    addError(
      diagnostics,
      'MODULE_ROUTE_PATH_INVALID',
      `Route path "${route.path}" must start with "/".`,
      `${path}.path`,
      'Declare module-local paths such as "/orders".'
    );
  }

  if (route.auth && !ROUTE_AUTHS.has(route.auth)) {
    addError(
      diagnostics,
      'MODULE_ROUTE_AUTH_INVALID',
      `Route auth "${route.auth}" is not supported.`,
      `${path}.auth`
    );
  }

  validatePermissionList(diagnostics, route.permissions, `${path}.permissions`);
  validateCommercialRequirement(diagnostics, route.commercial, `${path}.commercial`);
}

function validatePublicAliases(
  diagnostics: ModuleDiagnostic[],
  route: ModulePageRoute,
  path: string,
  group: 'site' | 'dashboard' | 'admin'
): void {
  const aliases = route.publicAliases ?? [];
  if (aliases.length === 0) {
    return;
  }

  if (group !== 'site') {
    addError(
      diagnostics,
      'MODULE_PUBLIC_ALIAS_SITE_ONLY',
      'Public aliases are only supported on site page routes.',
      `${path}.publicAliases`,
      'Move this route to routes.site or remove publicAliases.'
    );
  }

  if (route.auth !== 'public') {
    addError(
      diagnostics,
      'MODULE_PUBLIC_ALIAS_PUBLIC_AUTH_REQUIRED',
      'Public aliases require the page route to declare auth: "public".',
      `${path}.auth`,
      'Set auth: "public" or remove publicAliases.'
    );
  }

  const seen = new Set<string>();
  for (const [index, alias] of aliases.entries()) {
    const aliasPath = `${path}.publicAliases.${index}`;

    if (!alias.startsWith('/') || alias.includes('?') || alias.includes('#')) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_ALIAS_PATH_INVALID',
        `Public alias "${alias}" must be an absolute path without query or hash.`,
        aliasPath,
        'Use a path like "/tools/json-formatter".'
      );
      continue;
    }

    if (alias.includes(':') || alias.includes('*')) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_ALIAS_DYNAMIC_UNSUPPORTED',
        `Public alias "${alias}" must be a static host path.`,
        aliasPath,
        'Use a fixed path such as "/tools/json-formatter".'
      );
    }

    if (isReservedPublicAlias(alias)) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_ALIAS_RESERVED',
        `Public alias "${alias}" conflicts with a reserved host path.`,
        aliasPath,
        'Use a product-specific path such as "/tools/my-tool".'
      );
    }

    if (seen.has(alias)) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_ALIAS_DUPLICATE',
        `Public alias "${alias}" is duplicated in this route.`,
        aliasPath
      );
    }
    seen.add(alias);
  }
}

function validateRouteAliases(
  diagnostics: ModuleDiagnostic[],
  route: ModulePageRoute,
  path: string,
  group: 'site' | 'dashboard' | 'admin'
): void {
  const aliases = route.aliases ?? [];
  if (aliases.length === 0) {
    return;
  }

  if (group === 'site') {
    addError(
      diagnostics,
      'MODULE_ROUTE_ALIAS_NON_SITE_ONLY',
      'Route aliases are only supported on dashboard and admin page routes.',
      `${path}.aliases`,
      'Use publicAliases for public site compatibility paths.'
    );
  }

  const seen = new Set<string>();
  for (const [index, alias] of aliases.entries()) {
    const aliasPath = `${path}.aliases.${index}`;

    if (!alias.startsWith('/') || alias.includes('?') || alias.includes('#')) {
      addError(
        diagnostics,
        'MODULE_ROUTE_ALIAS_PATH_INVALID',
        `Route alias "${alias}" must be an absolute path without query or hash.`,
        aliasPath,
        'Use a module-local alias path like "/orders" or "/billing".'
      );
      continue;
    }

    if (alias.includes(':') || alias.includes('*')) {
      addError(
        diagnostics,
        'MODULE_ROUTE_ALIAS_DYNAMIC_UNSUPPORTED',
        `Route alias "${alias}" must be a static path.`,
        aliasPath,
        'Use a fixed alias path that resolves to this canonical route.'
      );
    }

    if (alias === route.path) {
      addError(
        diagnostics,
        'MODULE_ROUTE_ALIAS_SELF_REFERENCE',
        `Route alias "${alias}" duplicates the canonical ${group} route path.`,
        aliasPath,
        'Remove the alias or point it at another compatibility path.'
      );
    }

    if (seen.has(alias)) {
      addError(
        diagnostics,
        'MODULE_ROUTE_ALIAS_DUPLICATE',
        `Route alias "${alias}" is duplicated in this route.`,
        aliasPath
      );
    }
    seen.add(alias);
  }
}

function validateRoutePathConflicts(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  for (const group of ['site', 'dashboard', 'admin'] as const) {
    const owners = new Map<string, string>();
    for (const [index, route] of (definition.routes?.[group] ?? []).entries()) {
      const routePath = `routes.${group}.${index}`;
      const paths = [
        { path: route.path, source: 'path', diagnosticPath: `${routePath}.path` },
        ...(route.aliases ?? []).map((alias, aliasIndex) => ({
          path: alias,
          source: 'alias',
          diagnosticPath: `${routePath}.aliases.${aliasIndex}`,
        })),
        ...(route.publicAliases ?? []).map((alias, aliasIndex) => ({
          path: alias,
          source: 'publicAlias',
          diagnosticPath: `${routePath}.publicAliases.${aliasIndex}`,
        })),
      ];

      for (const item of paths) {
        const owner = owners.get(item.path);
        if (owner) {
          addError(
            diagnostics,
            'MODULE_ROUTE_PATH_CONFLICT',
            `${group} route ${item.source} "${item.path}" conflicts with ${owner}.`,
            item.diagnosticPath,
            'Keep each canonical path, route alias, and public alias unique within the same route group.'
          );
        } else {
          owners.set(item.path, `${routePath}.${item.source}`);
        }
      }
    }
  }
}

function validatePageRoute(
  diagnostics: ModuleDiagnostic[],
  route: ModulePageRoute,
  path: string,
  group: 'site' | 'dashboard' | 'admin'
): void {
  validateRouteBase(diagnostics, route, path);
  validateLocalModulePath(diagnostics, route.component, `${path}.component`, 'Page component');
  validateLocalModulePath(diagnostics, route.loader, `${path}.loader`, 'Page loader', false);
  validateLocalModulePath(diagnostics, route.metadata, `${path}.metadata`, 'Page metadata', false);
  validateRouteAliases(diagnostics, route, path, group);
  validatePublicAliases(diagnostics, route, path, group);

  for (const [index, field] of (route.metadataResult?.required ?? []).entries()) {
    if (!PAGE_METADATA_REQUIRED_FIELDS.has(field)) {
      addError(
        diagnostics,
        'MODULE_PAGE_METADATA_REQUIRED_FIELD_INVALID',
        `Page metadata required field "${field}" is not supported.`,
        `${path}.metadataResult.required.${index}`,
        `Use one of: ${Array.from(PAGE_METADATA_REQUIRED_FIELDS).join(', ')}.`
      );
    }
  }

  if (route.cache) {
    if (!CACHE_STRATEGIES.has(route.cache.strategy)) {
      addError(
        diagnostics,
        'MODULE_ROUTE_CACHE_STRATEGY_INVALID',
        `Cache strategy "${route.cache.strategy}" is not supported.`,
        `${path}.cache.strategy`
      );
    }

    if (
      route.cache.revalidateSeconds !== undefined &&
      (!Number.isInteger(route.cache.revalidateSeconds) || route.cache.revalidateSeconds <= 0)
    ) {
      addError(
        diagnostics,
        'MODULE_ROUTE_CACHE_REVALIDATE_INVALID',
        'Cache revalidateSeconds must be a positive integer when declared.',
        `${path}.cache.revalidateSeconds`
      );
    }

    for (const [index, tag] of (route.cache.tags ?? []).entries()) {
      if (!tag.trim()) {
        addError(
          diagnostics,
          'MODULE_ROUTE_CACHE_TAG_EMPTY',
          'Cache tags must not be empty.',
          `${path}.cache.tags.${index}`
        );
      }
    }
  }

  if (group === 'site' && route.auth === 'public') {
    if (!route.metadata) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_SITE_METADATA_REQUIRED',
        'Public site routes must declare a metadata loader for title, description, canonical, and sitemap behavior.',
        `${path}.metadata`,
        'Add metadata: "./loaders/metadata" and return structured SEO metadata.'
      );
    }

    if (!route.cache) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_SITE_CACHE_REQUIRED',
        'Public site routes must declare an explicit cache strategy.',
        `${path}.cache`,
        'Add cache: { strategy: "public", revalidateSeconds: 300, tags: ["module-id"] } or strategy: "none".'
      );
    }
  }

  if (route.auth === 'public' && route.cache?.strategy === 'private') {
    addError(
      diagnostics,
      'MODULE_PUBLIC_ROUTE_PRIVATE_CACHE',
      'Public routes cannot use private cache strategy.',
      `${path}.cache.strategy`,
      'Use "public" or "none".'
    );
  }
}

function validateAnonymousPolicy(
  diagnostics: ModuleDiagnostic[],
  route: ModuleApiRoute,
  path: string
): void {
  const policy = route.anonymousPolicy;
  if (!policy) {
    return;
  }

  if (!policy.rateLimit) {
    addError(
      diagnostics,
      'MODULE_PUBLIC_API_RATE_LIMIT_REQUIRED',
      'Public API routes must declare anonymousPolicy.rateLimit.',
      `${path}.anonymousPolicy.rateLimit`,
      'Add an IP, route, module, method, or custom bucket rate limit.'
    );
  } else {
    if (!Number.isInteger(policy.rateLimit.limit) || policy.rateLimit.limit <= 0) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_API_RATE_LIMIT_INVALID',
        'anonymousPolicy.rateLimit.limit must be a positive integer.',
        `${path}.anonymousPolicy.rateLimit.limit`
      );
    }

    if (!RATE_LIMIT_WINDOW_PATTERN.test(policy.rateLimit.window)) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_API_RATE_LIMIT_WINDOW_INVALID',
        'anonymousPolicy.rateLimit.window must use a duration such as "30s", "1m", or "1h".',
        `${path}.anonymousPolicy.rateLimit.window`
      );
    }
  }

  if (
    policy.maxUploadBytes !== undefined &&
    (!Number.isInteger(policy.maxUploadBytes) || policy.maxUploadBytes <= 0)
  ) {
    addError(
      diagnostics,
      'MODULE_PUBLIC_API_UPLOAD_LIMIT_INVALID',
      'anonymousPolicy.maxUploadBytes must be a positive integer when declared.',
      `${path}.anonymousPolicy.maxUploadBytes`
    );
  }

  if (policy.captcha && !ANONYMOUS_POLICY_CAPTCHAS.has(policy.captcha)) {
    addError(
      diagnostics,
      'MODULE_PUBLIC_API_CAPTCHA_INVALID',
      `Anonymous captcha policy "${policy.captcha}" is not supported.`,
      `${path}.anonymousPolicy.captcha`,
      'Use "never", "auto", or "always".'
    );
  }

  if (route.commercial && policy.allowHighCostActions === true) {
    addError(
      diagnostics,
      'MODULE_PUBLIC_API_HIGH_COST_ANONYMOUS_FORBIDDEN',
      'Public commercial API routes cannot allow anonymous high-cost actions.',
      `${path}.anonymousPolicy.allowHighCostActions`,
      'Set allowHighCostActions: false and require auth for high-cost execution.'
    );
  }
}

function validateApiRoute(
  diagnostics: ModuleDiagnostic[],
  route: ModuleApiRoute,
  path: string
): void {
  validateRouteBase(diagnostics, route, path);
  validateLocalModulePath(diagnostics, route.handler, `${path}.handler`, 'API handler');

  for (const [index, method] of (route.methods ?? ['GET']).entries()) {
    if (!HTTP_METHODS.has(method)) {
      addError(
        diagnostics,
        'MODULE_API_METHOD_INVALID',
        `HTTP method "${method}" is not supported.`,
        `${path}.methods.${index}`
      );
    }
  }

  if (route.machineAuth && !MACHINE_AUTHS.has(route.machineAuth)) {
    addError(
      diagnostics,
      'MODULE_API_MACHINE_AUTH_INVALID',
      `Machine auth "${route.machineAuth}" is not supported.`,
      `${path}.machineAuth`,
      'Use "apiKey" or "user-or-apiKey".'
    );
  }

  if (route.machineAuth && route.auth === 'public') {
    addError(
      diagnostics,
      'MODULE_API_MACHINE_AUTH_NOT_PUBLIC',
      'Machine-auth API routes cannot use auth: "public".',
      `${path}.auth`,
      'Use auth: "auth" or auth: "admin".'
    );
  }

  if (route.auth === 'public' && !route.anonymousPolicy) {
    addError(
      diagnostics,
      'MODULE_PUBLIC_API_ANONYMOUS_POLICY_REQUIRED',
      'Public API routes must declare anonymousPolicy.',
      `${path}.anonymousPolicy`,
      'Add rateLimit, upload, captcha, or high-cost policy for this public API.'
    );
  }

  if (route.auth === 'public') {
    validateAnonymousPolicy(diagnostics, route, path);
  }
}

function validateRoutes(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  const modulePermissions = new Set(definition.permissions ?? []);
  for (const group of ['site', 'dashboard', 'admin'] as const) {
    for (const [index, route] of (definition.routes?.[group] ?? []).entries()) {
      const path = `routes.${group}.${index}`;
      validatePageRoute(diagnostics, route, path, group);
      validateDeclaredPermissionList(
        diagnostics,
        route.permissions,
        modulePermissions,
        `${path}.permissions`
      );
    }
  }

  validateRoutePathConflicts(diagnostics, definition);

  for (const [index, route] of (definition.routes?.api ?? []).entries()) {
    const path = `routes.api.${index}`;
    validateApiRoute(diagnostics, route, path);
    validateDeclaredPermissionList(
      diagnostics,
      route.permissions,
      modulePermissions,
      `${path}.permissions`
    );
  }
}

function validateData(
  diagnostics: ModuleDiagnostic[],
  data: ModuleDataDefinition | undefined
): void {
  if (!data) {
    return;
  }

  if (!Number.isInteger(data.version) || data.version < 1) {
    addError(
      diagnostics,
      'MODULE_DATA_VERSION_INVALID',
      'Data definition version must be a positive integer.',
      'data.version'
    );
  }

  for (const [documentName, document] of Object.entries(data.documents ?? {})) {
    validateKey(diagnostics, documentName, `data.documents.${documentName}`, 'Document');

    if (document.scope && !DATA_SCOPES.has(document.scope)) {
      addError(
        diagnostics,
        'MODULE_DATA_SCOPE_INVALID',
        `Document scope "${document.scope}" is not supported.`,
        `data.documents.${documentName}.scope`
      );
    }

    if (Object.keys(document.fields ?? {}).length === 0) {
      addError(
        diagnostics,
        'MODULE_DATA_DOCUMENT_FIELDS_REQUIRED',
        `Document "${documentName}" must declare at least one field.`,
        `data.documents.${documentName}.fields`
      );
    }

    for (const [fieldName, field] of Object.entries(document.fields ?? {})) {
      validateKey(
        diagnostics,
        fieldName,
        `data.documents.${documentName}.fields.${fieldName}`,
        'Document field'
      );
      const fieldType = typeof field === 'string' ? field : field.type;
      if (!DOCUMENT_FIELD_TYPES.has(fieldType)) {
        addError(
          diagnostics,
          'MODULE_DATA_DOCUMENT_FIELD_TYPE_INVALID',
          `Document field type "${fieldType}" is not supported.`,
          `data.documents.${documentName}.fields.${fieldName}.type`
        );
      }
    }
  }

  for (const [tableName, table] of Object.entries(data.tables ?? {})) {
    validateKey(diagnostics, tableName, `data.tables.${tableName}`, 'Table');

    if (table.$$type !== 'ploykit.data.table') {
      addError(
        diagnostics,
        'MODULE_DATA_TABLE_DSL_REQUIRED',
        `Table "${tableName}" must be created with table(...).`,
        `data.tables.${tableName}`,
        'Use table({ scope, columns, indexes, unique }).'
      );
    }

    if (!DATA_SCOPES.has(table.scope)) {
      addError(
        diagnostics,
        'MODULE_DATA_SCOPE_INVALID',
        `Table scope "${table.scope}" is not supported.`,
        `data.tables.${tableName}.scope`
      );
    }

    if (Object.keys(table.columns ?? {}).length === 0) {
      addError(
        diagnostics,
        'MODULE_DATA_TABLE_COLUMNS_REQUIRED',
        `Table "${tableName}" must declare at least one column.`,
        `data.tables.${tableName}.columns`
      );
    }

    for (const [columnName, column] of Object.entries(table.columns ?? {})) {
      validateKey(
        diagnostics,
        columnName,
        `data.tables.${tableName}.columns.${columnName}`,
        'Table column'
      );
      if (!COLUMN_KINDS.has(column.kind)) {
        addError(
          diagnostics,
          'MODULE_DATA_TABLE_COLUMN_KIND_INVALID',
          `Table column kind "${column.kind}" is not supported.`,
          `data.tables.${tableName}.columns.${columnName}.kind`
        );
      }
    }

    const columnNames = new Set(Object.keys(table.columns ?? {}));
    const addressableColumnNames = new Set([...DATA_STANDARD_COLUMNS, ...columnNames]);
    for (const [kind, groups] of [
      ['unique', table.unique ?? []],
      ['indexes', table.indexes ?? []],
    ] as const) {
      for (const [groupIndex, fields] of groups.entries()) {
        for (const [fieldIndex, field] of fields.entries()) {
          if (!columnNames.has(field)) {
            addError(
              diagnostics,
              'MODULE_DATA_TABLE_INDEX_FIELD_UNKNOWN',
              `Table "${tableName}" ${kind} field "${field}" is not declared as a column.`,
              `data.tables.${tableName}.${kind}.${groupIndex}.${fieldIndex}`
            );
          }
        }
      }
    }

    for (const [relationName, relation] of Object.entries(table.relations ?? {})) {
      validateKey(
        diagnostics,
        relationName,
        `data.tables.${tableName}.relations.${relationName}`,
        'Table relation'
      );

      const targetTable = data.tables?.[relation.table];
      if (!targetTable) {
        addError(
          diagnostics,
          'MODULE_DATA_TABLE_RELATION_TARGET_UNKNOWN',
          `Relation "${relationName}" references unknown table "${relation.table}".`,
          `data.tables.${tableName}.relations.${relationName}.table`
        );
      }

      if (!addressableColumnNames.has(relation.local)) {
        addError(
          diagnostics,
          'MODULE_DATA_TABLE_RELATION_LOCAL_FIELD_UNKNOWN',
          `Relation "${relationName}" local field "${relation.local}" is not declared.`,
          `data.tables.${tableName}.relations.${relationName}.local`
        );
      }

      const targetColumnNames = new Set([
        ...DATA_STANDARD_COLUMNS,
        ...Object.keys(targetTable?.columns ?? {}),
      ]);
      if (targetTable && !targetColumnNames.has(relation.foreign)) {
        addError(
          diagnostics,
          'MODULE_DATA_TABLE_RELATION_FOREIGN_FIELD_UNKNOWN',
          `Relation "${relationName}" foreign field "${relation.foreign}" is not declared on "${relation.table}".`,
          `data.tables.${tableName}.relations.${relationName}.foreign`
        );
      }

      if (relation.onDelete && !DATA_RELATION_ON_DELETE.has(relation.onDelete)) {
        addError(
          diagnostics,
          'MODULE_DATA_TABLE_RELATION_ON_DELETE_INVALID',
          `Relation "${relationName}" onDelete "${relation.onDelete}" is not supported.`,
          `data.tables.${tableName}.relations.${relationName}.onDelete`
        );
      }
    }
  }

  for (const [viewName, view] of Object.entries(data.views ?? {})) {
    validateKey(diagnostics, viewName, `data.views.${viewName}`, 'View');
    if (!view.source?.trim()) {
      addError(
        diagnostics,
        'MODULE_DATA_VIEW_SOURCE_REQUIRED',
        `View "${viewName}" must declare a source model.`,
        `data.views.${viewName}.source`
      );
    }
    if (view.scope && !DATA_SCOPES.has(view.scope)) {
      addError(
        diagnostics,
        'MODULE_DATA_SCOPE_INVALID',
        `View scope "${view.scope}" is not supported.`,
        `data.views.${viewName}.scope`
      );
    }
  }

  const modelNames = new Set([
    ...Object.keys(data.documents ?? {}),
    ...Object.keys(data.tables ?? {}),
    ...Object.keys(data.views ?? {}),
  ]);

  for (const [grantName, grant] of Object.entries(data.grants ?? {})) {
    validateKey(diagnostics, grantName, `data.grants.${grantName}`, 'Grant');
    if (!grant.model?.trim()) {
      addError(
        diagnostics,
        'MODULE_DATA_GRANT_MODEL_REQUIRED',
        `Grant "${grantName}" must reference a model.`,
        `data.grants.${grantName}.model`
      );
    } else if (!modelNames.has(grant.model)) {
      addError(
        diagnostics,
        'MODULE_DATA_GRANT_MODEL_UNKNOWN',
        `Grant "${grantName}" references unknown model "${grant.model}".`,
        `data.grants.${grantName}.model`
      );
    }
    if ((grant.operations ?? []).length === 0) {
      addError(
        diagnostics,
        'MODULE_DATA_GRANT_OPERATIONS_REQUIRED',
        `Grant "${grantName}" must declare at least one operation.`,
        `data.grants.${grantName}.operations`
      );
    }
  }

  for (const [checkName, check] of Object.entries(data.checks ?? {})) {
    validateKey(diagnostics, checkName, `data.checks.${checkName}`, 'Check');
    if (!check.model?.trim()) {
      addError(
        diagnostics,
        'MODULE_DATA_CHECK_MODEL_REQUIRED',
        `Check "${checkName}" must reference a model.`,
        `data.checks.${checkName}.model`
      );
    } else if (!modelNames.has(check.model)) {
      addError(
        diagnostics,
        'MODULE_DATA_CHECK_MODEL_UNKNOWN',
        `Check "${checkName}" references unknown model "${check.model}".`,
        `data.checks.${checkName}.model`
      );
    }
  }

  const hasPhysicalDataDefinition =
    Object.keys(data.tables ?? {}).length > 0 ||
    Object.keys(data.views ?? {}).length > 0 ||
    Object.keys(data.grants ?? {}).length > 0 ||
    Object.keys(data.checks ?? {}).length > 0;

  if (hasPhysicalDataDefinition && !data.migrations) {
    addError(
      diagnostics,
      'MODULE_DATA_MIGRATIONS_REQUIRED',
      'Physical Data v2 definitions must declare an explicit migrations block.',
      'data.migrations',
      'Add migrations: { mode: "generated", dir: "./migrations" } or use mode: "sql".'
    );
  }

  if (data.migrations) {
    if (!DATA_MIGRATION_MODES.has(data.migrations.mode)) {
      addError(
        diagnostics,
        'MODULE_DATA_MIGRATION_MODE_INVALID',
        `Data migration mode "${data.migrations.mode}" is not supported.`,
        'data.migrations.mode',
        'Use "generated" or "sql".'
      );
    }

    validateLocalModulePath(
      diagnostics,
      data.migrations.dir,
      'data.migrations.dir',
      'Data migrations directory'
    );
  }
}

function validateActions(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  const modulePermissions = new Set(definition.permissions ?? []);
  for (const [actionName, action] of Object.entries(definition.actions ?? {})) {
    if (!ACTION_KEY_PATTERN.test(actionName)) {
      addError(
        diagnostics,
        'MODULE_ACTION_NAME_INVALID',
        `Action "${actionName}" must start with a letter and contain only letters, numbers, or underscores.`,
        `actions.${actionName}`,
        'Use a name like "createPost" or "create_post".'
      );
    }
    validateLocalModulePath(diagnostics, action.handler, `actions.${actionName}.handler`, 'Action');
    validateLocalModulePath(
      diagnostics,
      action.input,
      `actions.${actionName}.input`,
      'Action input',
      false
    );

    if (action.auth && !ROUTE_AUTHS.has(action.auth)) {
      addError(
        diagnostics,
        'MODULE_ACTION_AUTH_INVALID',
        `Action auth "${action.auth}" is not supported.`,
        `actions.${actionName}.auth`
      );
    }

    if (action.timeoutMs !== undefined && action.timeoutMs <= 0) {
      addError(
        diagnostics,
        'MODULE_ACTION_TIMEOUT_INVALID',
        'Action timeoutMs must be greater than zero.',
        `actions.${actionName}.timeoutMs`
      );
    }

    validatePermissionList(diagnostics, action.permissions, `actions.${actionName}.permissions`);
    validateDeclaredPermissionList(
      diagnostics,
      action.permissions,
      modulePermissions,
      `actions.${actionName}.permissions`
    );
    validateCommercialRequirement(
      diagnostics,
      action.commercial,
      `actions.${actionName}.commercial`
    );

    if (action.sideEffect && !ACTION_SIDE_EFFECTS.has(action.sideEffect)) {
      addError(
        diagnostics,
        'MODULE_ACTION_SIDE_EFFECT_INVALID',
        `Action sideEffect "${action.sideEffect}" is not supported.`,
        `actions.${actionName}.sideEffect`,
        `Use one of: ${Array.from(ACTION_SIDE_EFFECTS).join(', ')}.`
      );
    }

    if (
      (action.sideEffect === 'destructive' || action.sideEffect === 'billing') &&
      action.confirmation?.required !== true
    ) {
      addError(
        diagnostics,
        'MODULE_ACTION_CONFIRMATION_REQUIRED',
        `Action "${actionName}" is ${action.sideEffect} and must require explicit confirmation.`,
        `actions.${actionName}.confirmation`,
        'Add confirmation: { required: true, fallbackMessage: "..." }.'
      );
    }

    if (action.confirmation?.required && !action.confirmation.fallbackMessage?.trim()) {
      addError(
        diagnostics,
        'MODULE_ACTION_CONFIRMATION_MESSAGE_REQUIRED',
        'Confirmed actions must provide a fallback confirmation message.',
        `actions.${actionName}.confirmation.fallbackMessage`,
        'Add a concise fallbackMessage for operators and generated clients.'
      );
    }

    if (
      (action.sideEffect === 'external' || action.sideEffect === 'billing') &&
      action.idempotency?.required !== true
    ) {
      addError(
        diagnostics,
        'MODULE_ACTION_IDEMPOTENCY_REQUIRED',
        `Action "${actionName}" is ${action.sideEffect} and must require idempotency.`,
        `actions.${actionName}.idempotency`,
        'Add idempotency: { required: true, keyFrom: "request" }.'
      );
    }

    if (action.idempotency?.required && !action.idempotency.keyFrom) {
      addError(
        diagnostics,
        'MODULE_ACTION_IDEMPOTENCY_KEY_SOURCE_REQUIRED',
        'Idempotent actions must declare idempotency.keyFrom.',
        `actions.${actionName}.idempotency.keyFrom`,
        'Use "request", "user", "scope", or "input".'
      );
    }
  }
}

function validateSurfaces(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  const modulePermissions = new Set(definition.permissions ?? []);
  for (const [surfaceId, surface] of Object.entries(definition.surfaces ?? {})) {
    validateLocalModulePath(
      diagnostics,
      surface.component,
      `surfaces.${surfaceId}.component`,
      'Surface component'
    );
    validateLocalModulePath(
      diagnostics,
      surface.loader,
      `surfaces.${surfaceId}.loader`,
      'Surface loader',
      false
    );
    validatePermissionList(diagnostics, surface.permissions, `surfaces.${surfaceId}.permissions`);
    validateDeclaredPermissionList(
      diagnostics,
      surface.permissions,
      modulePermissions,
      `surfaces.${surfaceId}.permissions`
    );
    validateCommercialRequirement(
      diagnostics,
      surface.commercial,
      `surfaces.${surfaceId}.commercial`
    );

    if (
      surface.placement?.responsive &&
      !SURFACE_RESPONSIVE_PLACEMENTS.has(surface.placement.responsive)
    ) {
      addError(
        diagnostics,
        'MODULE_SURFACE_PLACEMENT_RESPONSIVE_INVALID',
        `Surface responsive placement "${surface.placement.responsive}" is not supported.`,
        `surfaces.${surfaceId}.placement.responsive`,
        `Use one of: ${Array.from(SURFACE_RESPONSIVE_PLACEMENTS).join(', ')}.`
      );
    }

    if (surface.fallback?.behavior && !SURFACE_FALLBACK_BEHAVIORS.has(surface.fallback.behavior)) {
      addError(
        diagnostics,
        'MODULE_SURFACE_FALLBACK_INVALID',
        `Surface fallback behavior "${surface.fallback.behavior}" is not supported.`,
        `surfaces.${surfaceId}.fallback.behavior`,
        `Use one of: ${Array.from(SURFACE_FALLBACK_BEHAVIORS).join(', ')}.`
      );
    }

    if (surface.visibility?.mode && !SURFACE_VISIBILITY_MODES.has(surface.visibility.mode)) {
      addError(
        diagnostics,
        'MODULE_SURFACE_VISIBILITY_INVALID',
        `Surface visibility mode "${surface.visibility.mode}" is not supported.`,
        `surfaces.${surfaceId}.visibility.mode`,
        `Use one of: ${Array.from(SURFACE_VISIBILITY_MODES).join(', ')}.`
      );
    }

    if (surface.visibility?.mode === 'permission' && !surface.visibility.permission) {
      addError(
        diagnostics,
        'MODULE_SURFACE_VISIBILITY_PERMISSION_REQUIRED',
        'Permission-gated surfaces must declare visibility.permission.',
        `surfaces.${surfaceId}.visibility.permission`,
        'Add the permission needed to see this surface.'
      );
    }

    if (surface.visibility?.permission) {
      validatePermissionList(
        diagnostics,
        [surface.visibility.permission],
        `surfaces.${surfaceId}.visibility.permission`
      );
      validateDeclaredPermissionList(
        diagnostics,
        [surface.visibility.permission],
        modulePermissions,
        `surfaces.${surfaceId}.visibility.permission`
      );
    }

    if (surface.visibility?.mode === 'feature' && !surface.visibility.feature?.trim()) {
      addError(
        diagnostics,
        'MODULE_SURFACE_VISIBILITY_FEATURE_REQUIRED',
        'Feature-gated surfaces must declare visibility.feature.',
        `surfaces.${surfaceId}.visibility.feature`,
        'Add a product feature flag or capability key.'
      );
    }

    if (
      surface.mode === 'replace' &&
      !modulePermissions.has(Permission.SurfaceOverride) &&
      !(surface.permissions ?? []).includes(Permission.SurfaceOverride)
    ) {
      addError(
        diagnostics,
        'MODULE_SURFACE_REPLACE_PERMISSION_REQUIRED',
        `Surface "${surfaceId}" uses replace mode but does not declare SurfaceOverride.`,
        `surfaces.${surfaceId}.permissions`,
        'Add Permission.SurfaceOverride at module or surface level.'
      );
    }

    if (isHostPageOverrideSurfaceId(surfaceId) && !surface.loader) {
      addError(
        diagnostics,
        'MODULE_HOST_PAGE_OVERRIDE_LOADER_REQUIRED',
        `Host page override "${surfaceId}" must declare a loader for SEO, shell, cache and i18n metadata.`,
        `surfaces.${surfaceId}.loader`,
        'Add a loader that returns structured page override metadata.'
      );
    }
  }
}

function isHostPageOverrideSurfaceId(surfaceId: string): boolean {
  if (surfaceId.includes(':override')) {
    return true;
  }
  if (!surfaceId.startsWith('host.page:')) {
    return false;
  }
  return surfaceId.split(':').length === 2;
}

function validateTheme(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  const theme = definition.theme;
  if (!theme) {
    return;
  }

  const hasTokens = Object.keys(theme.tokens ?? {}).length > 0;
  const hasCss = typeof theme.css === 'string' && theme.css.trim().length > 0;
  if ((hasTokens || hasCss) && !(definition.permissions ?? []).includes(Permission.ThemeWrite)) {
    addError(
      diagnostics,
      'MODULE_THEME_PERMISSION_REQUIRED',
      'Module theme declarations require Permission.ThemeWrite.',
      'permissions',
      'Add Permission.ThemeWrite or remove the theme declaration.'
    );
  }

  if (hasCss) {
    addError(
      diagnostics,
      'MODULE_THEME_CSS_UNSUPPORTED',
      'theme.css is not allowed in the global host theme path.',
      'theme.css',
      'Use theme.tokens with host-approved semantic tokens instead.'
    );
  }

  for (const token of Object.keys(theme.tokens ?? {})) {
    if (!HOST_THEME_ALLOWED_TOKENS.has(token)) {
      addError(
        diagnostics,
        'MODULE_THEME_TOKEN_NOT_ALLOWED',
        `Theme token "${token}" is not in the host allowlist.`,
        `theme.tokens.${token}`,
        `Use one of: ${Array.from(HOST_THEME_ALLOWED_TOKENS).join(', ')}.`
      );
    }
  }

  for (const [token, value] of Object.entries(theme.tokens ?? {})) {
    if (typeof value === 'string' && (value.includes('</') || /[{};]/.test(value))) {
      addError(
        diagnostics,
        'MODULE_THEME_TOKEN_VALUE_UNSAFE',
        `Theme token "${token}" contains unsafe CSS characters.`,
        `theme.tokens.${token}`,
        'Use a plain color, length, font family, or shadow token value.'
      );
    }
  }
}

function validateNavigation(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  const items = Array.isArray(definition.navigation)
    ? definition.navigation
    : definition.navigation
      ? [definition.navigation]
      : [];

  for (const [index, item] of items.entries()) {
    if (!item.path.startsWith('/')) {
      addError(
        diagnostics,
        'MODULE_NAVIGATION_PATH_INVALID',
        `Navigation path "${item.path}" must start with "/".`,
        `navigation.${index}.path`
      );
    }

    if (!item.fallbackLabel.trim()) {
      addError(
        diagnostics,
        'MODULE_NAVIGATION_LABEL_REQUIRED',
        'Navigation fallbackLabel is required.',
        `navigation.${index}.fallbackLabel`
      );
    }
  }
}

function navigationItems(definition: ModuleDefinition) {
  return Array.isArray(definition.navigation)
    ? definition.navigation
    : definition.navigation
      ? [definition.navigation]
      : [];
}

function shellRoutePaths(
  definition: ModuleDefinition,
  shell: ModuleProductShell
): Set<string> {
  return new Set((definition.routes?.[shell] ?? []).map((route) => route.path));
}

function hasNavigationForShell(definition: ModuleDefinition, shell: ModuleProductShell): boolean {
  const locations = PRODUCT_SHELL_NAVIGATION[shell];
  return navigationItems(definition).some((item) => locations.includes(item.location));
}

function validateProduct(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  const product = definition.product;
  if (!product) {
    return;
  }

  if (!PRODUCT_KINDS.has(product.kind)) {
    addError(
      diagnostics,
      'MODULE_PRODUCT_KIND_INVALID',
      `Product kind "${product.kind}" is not supported.`,
      'product.kind',
      'Use "tool", "product", or "platform".'
    );
  }

  for (const [index, shell] of (product.requiredShells ?? []).entries()) {
    if (!PRODUCT_SHELLS.has(shell)) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_REQUIRED_SHELL_INVALID',
        `Product required shell "${shell}" is not supported.`,
        `product.requiredShells.${index}`,
        'Use "site", "dashboard", or "admin".'
      );
      continue;
    }

    if ((definition.routes?.[shell] ?? []).length === 0) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_REQUIRED_SHELL_ROUTE_MISSING',
        `Product module declares required shell "${shell}" but has no ${shell} routes.`,
        `routes.${shell}`,
        `Add routes.${shell} entries or remove "${shell}" from product.requiredShells.`
      );
    }

    if (!hasNavigationForShell(definition, shell)) {
      addWarning(
        diagnostics,
        'MODULE_PRODUCT_REQUIRED_SHELL_NAVIGATION_MISSING',
        `Product module declares required shell "${shell}" but does not contribute ${PRODUCT_SHELL_NAVIGATION[shell].join(' or ')} navigation.`,
        'navigation',
        `Add navigation for ${PRODUCT_SHELL_NAVIGATION[shell].join(' or ')}.`
      );
    }
  }

  if ((definition.routes?.admin ?? []).length > 0 && !hasNavigationForShell(definition, 'admin')) {
    addWarning(
      diagnostics,
      'MODULE_ADMIN_ROUTE_NAVIGATION_MISSING',
      'Module declares admin routes but does not contribute admin.sidebar navigation.',
      'navigation',
      'Add an admin.sidebar navigation item so administrators can reach the module admin pages.'
    );
  }

  if ((definition.routes?.site ?? []).length > 0 && !hasNavigationForShell(definition, 'site')) {
    addWarning(
      diagnostics,
      'MODULE_SITE_ROUTE_NAVIGATION_MISSING',
      'Module declares site routes but does not contribute site.header or site.footer navigation.',
      'navigation',
      'Add site.header or site.footer navigation when public users need a discoverable entry.'
    );
  }

  for (const [index, page] of (product.pages ?? []).entries()) {
    const path = `product.pages.${index}`;
    if (!PRODUCT_SHELLS.has(page.shell)) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_SHELL_INVALID',
        `Product page shell "${page.shell}" is not supported.`,
        `${path}.shell`,
        'Use "site", "dashboard", or "admin".'
      );
      continue;
    }

    if (!page.path.startsWith('/')) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_PATH_INVALID',
        `Product page path "${page.path}" must start with "/".`,
        `${path}.path`
      );
    }

    if (!page.audience.trim()) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_AUDIENCE_REQUIRED',
        'Product pages must declare the audience they serve.',
        `${path}.audience`
      );
    }

    if (!page.userQuestion.trim()) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_QUESTION_REQUIRED',
        'Product pages must declare the user question they answer.',
        `${path}.userQuestion`
      );
    }

    if (!Array.isArray(page.primaryActions) || page.primaryActions.length === 0) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_ACTIONS_REQUIRED',
        'Product pages must declare at least one primary action.',
        `${path}.primaryActions`
      );
    }

    if (page.samplePath !== undefined && !page.samplePath.startsWith('/')) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_SAMPLE_PATH_INVALID',
        `Product page samplePath "${page.samplePath}" must start with "/".`,
        `${path}.samplePath`
      );
    }

    if (page.required !== false && !shellRoutePaths(definition, page.shell).has(page.path)) {
      addError(
        diagnostics,
        'MODULE_PRODUCT_PAGE_ROUTE_MISSING',
        `Product page "${page.path}" is declared for "${page.shell}" but no matching route exists.`,
        `${path}.path`,
        `Add routes.${page.shell} with path "${page.path}" or set required: false.`
      );
    }
  }
}

function validateResources(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  for (const [locale, localePath] of Object.entries(definition.resources?.locales ?? {})) {
    validateLocalModulePath(
      diagnostics,
      localePath,
      `resources.locales.${locale}`,
      'Locale resource'
    );
  }

  for (const [index, asset] of (definition.resources?.assets ?? []).entries()) {
    validateLocalModulePath(diagnostics, asset.path, `resources.assets.${index}.path`, 'Asset');

    if (asset.path.endsWith('.wasm') && asset.kind !== 'wasm') {
      addError(
        diagnostics,
        'MODULE_ASSET_WASM_KIND_REQUIRED',
        'WASM assets must explicitly declare kind: "wasm".',
        `resources.assets.${index}.kind`,
        'Add kind: "wasm".'
      );
    }

    if (asset.path.includes('.worker.') && asset.kind !== 'worker') {
      addError(
        diagnostics,
        'MODULE_ASSET_WORKER_KIND_REQUIRED',
        'Worker assets must explicitly declare kind: "worker".',
        `resources.assets.${index}.kind`,
        'Add kind: "worker".'
      );
    }

    if (asset.maxBytes !== undefined && asset.maxBytes <= 0) {
      addError(
        diagnostics,
        'MODULE_ASSET_MAX_BYTES_INVALID',
        'Asset maxBytes must be greater than zero.',
        `resources.assets.${index}.maxBytes`
      );
    }
  }
}

function validateI18n(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  const i18n = definition.i18n;
  if (!i18n) {
    return;
  }

  const localeResources = definition.resources?.locales ?? {};
  const requiredLanguages = i18n.requiredLanguages ?? [];

  if (i18n.defaultLanguage && !localeResources[i18n.defaultLanguage]) {
    addError(
      diagnostics,
      'MODULE_I18N_DEFAULT_LOCALE_MISSING',
      `Default language "${i18n.defaultLanguage}" must have a declared locale resource.`,
      'i18n.defaultLanguage',
      `Add resources.locales.${i18n.defaultLanguage}.`
    );
  }

  for (const language of requiredLanguages) {
    if (!localeResources[language]) {
      addError(
        diagnostics,
        'MODULE_I18N_REQUIRED_LOCALE_MISSING',
        `Required language "${language}" must have a declared locale resource.`,
        `i18n.requiredLanguages.${language}`,
        `Add resources.locales.${language}.`
      );
    }
  }

  for (const namespace of i18n.namespaces ?? []) {
    if (!I18N_NAMESPACE_PATTERN.test(namespace)) {
      addError(
        diagnostics,
        'MODULE_I18N_NAMESPACE_INVALID',
        `I18n namespace "${namespace}" must be kebab-case or snake_case and start with a letter.`,
        `i18n.namespaces.${namespace}`,
        'Use a namespace like "nav", "seo", or "billing_overview".'
      );
    }
  }

  if (i18n.strict) {
    const items = Array.isArray(definition.navigation)
      ? definition.navigation
      : definition.navigation
        ? [definition.navigation]
        : [];

    for (const [index, item] of items.entries()) {
      if (!item.labelKey?.trim()) {
        addError(
          diagnostics,
          'MODULE_I18N_NAVIGATION_LABEL_KEY_REQUIRED',
          'Strict i18n modules must declare navigation labelKey instead of relying on fallbackLabel.',
          `navigation.${index}.labelKey`,
          'Add a module locale key such as "nav.dashboard".'
        );
      }
    }

    for (const [actionName, action] of Object.entries(definition.actions ?? {})) {
      if (action.confirmation?.required && !action.confirmation.messageKey?.trim()) {
        addError(
          diagnostics,
          'MODULE_I18N_ACTION_CONFIRMATION_MESSAGE_KEY_REQUIRED',
          `Strict i18n module action "${actionName}" must declare confirmation.messageKey.`,
          `actions.${actionName}.confirmation.messageKey`,
          'Add a module locale key such as "actions.confirmDelete".'
        );
      }
    }

    for (const [surfaceId, surface] of Object.entries(definition.surfaces ?? {})) {
      const visibleFallback =
        surface.fallback?.behavior === 'placeholder' || surface.fallback?.fallbackMessage?.trim();
      if (visibleFallback && !surface.fallback?.messageKey?.trim()) {
        addError(
          diagnostics,
          'MODULE_I18N_SURFACE_FALLBACK_MESSAGE_KEY_REQUIRED',
          `Strict i18n module surface "${surfaceId}" must declare fallback.messageKey.`,
          `surfaces.${surfaceId}.fallback.messageKey`,
          'Add a module locale key such as "surfaces.empty".'
        );
      }
    }
  }
}

function validatePresentation(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  const presentation = definition.presentation;
  if (!presentation) {
    return;
  }

  const modulePermissions = new Set(definition.permissions ?? []);
  const surfaceEntries = Object.entries(definition.surfaces ?? {});
  const declaredReplaces = new Set(presentation.replaces ?? []);
  const hostReplaceSurfaces = surfaceEntries.filter(
    ([surfaceId, surface]) => isHostPageOverrideSurfaceId(surfaceId) && surface.mode === 'replace'
  );

  if (presentation.whiteLabel && declaredReplaces.size === 0) {
    addError(
      diagnostics,
      'MODULE_PRESENTATION_REPLACES_REQUIRED',
      'White-label modules must declare the host pages they replace.',
      'presentation.replaces',
      'Add presentation.replaces with host.page surface ids.'
    );
  }

  if (presentation.whiteLabel && !definition.i18n) {
    addError(
      diagnostics,
      'MODULE_PRESENTATION_I18N_REQUIRED',
      'White-label modules must declare an i18n contract.',
      'i18n',
      'Add i18n.defaultLanguage, requiredLanguages, namespaces, and strict: true.'
    );
  }

  if (presentation.whiteLabel && Object.keys(definition.resources?.locales ?? {}).length === 0) {
    addError(
      diagnostics,
      'MODULE_PRESENTATION_LOCALES_REQUIRED',
      'White-label modules must declare module locale resources.',
      'resources.locales',
      'Add resources.locales for every required presentation language.'
    );
  }

  for (const surfaceId of declaredReplaces) {
    if (!surfaceId.startsWith('host.page:') || surfaceId.split(':').length !== 2) {
      addError(
        diagnostics,
        'MODULE_PRESENTATION_REPLACE_TARGET_INVALID',
        `Presentation replace target "${surfaceId}" must be a host.page surface id.`,
        `presentation.replaces.${surfaceId}`,
        'Use a target like "host.page:site.home".'
      );
      continue;
    }

    const surface = definition.surfaces?.[surfaceId];
    if (!surface) {
      addError(
        diagnostics,
        'MODULE_PRESENTATION_REPLACE_SURFACE_MISSING',
        `Presentation replace target "${surfaceId}" has no matching surface contribution.`,
        `presentation.replaces.${surfaceId}`,
        `Add surfaces["${surfaceId}"] with mode: "replace".`
      );
      continue;
    }

    if (surface.mode !== 'replace') {
      addError(
        diagnostics,
        'MODULE_PRESENTATION_REPLACE_SURFACE_MODE_INVALID',
        `Presentation replace target "${surfaceId}" must use replace mode.`,
        `surfaces.${surfaceId}.mode`,
        'Set mode: "replace".'
      );
    }

    if (!surface.loader) {
      addError(
        diagnostics,
        'MODULE_PRESENTATION_REPLACE_LOADER_REQUIRED',
        `Presentation replace target "${surfaceId}" must declare a page presentation loader.`,
        `surfaces.${surfaceId}.loader`,
        'Add a loader that returns ModulePagePresentation.'
      );
    }
  }

  for (const [surfaceId] of hostReplaceSurfaces) {
    if (presentation.whiteLabel && !declaredReplaces.has(surfaceId)) {
      addError(
        diagnostics,
        'MODULE_PRESENTATION_REPLACE_NOT_DECLARED',
        `Host page replace surface "${surfaceId}" is missing from presentation.replaces.`,
        'presentation.replaces',
        `Add "${surfaceId}" to presentation.replaces.`
      );
    }
  }

  for (const namespace of presentation.seoNamespaces ?? []) {
    if (!definition.i18n?.namespaces?.includes(namespace)) {
      addError(
        diagnostics,
        'MODULE_PRESENTATION_SEO_NAMESPACE_MISSING',
        `SEO namespace "${namespace}" must also be declared in i18n.namespaces.`,
        `presentation.seoNamespaces.${namespace}`,
        'Add the namespace to i18n.namespaces.'
      );
    }
  }

  if (
    presentation.themeScope &&
    definition.theme &&
    !modulePermissions.has(Permission.ThemeWrite)
  ) {
    addError(
      diagnostics,
      'MODULE_PRESENTATION_THEME_PERMISSION_REQUIRED',
      'Presentation theme declarations require Permission.ThemeWrite.',
      'permissions',
      'Add Permission.ThemeWrite or remove the module theme declaration.'
    );
  }
}

function validateJobsEventsWebhooks(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  const modulePermissions = new Set(definition.permissions ?? []);

  for (const [jobName, job] of Object.entries(definition.jobs ?? {})) {
    validateKey(diagnostics, jobName, `jobs.${jobName}`, 'Job');
    validateLocalModulePath(diagnostics, job.handler, `jobs.${jobName}.handler`, 'Job handler');
    if (job.timeoutMs !== undefined && job.timeoutMs <= 0) {
      addError(
        diagnostics,
        'MODULE_JOB_TIMEOUT_INVALID',
        'Job timeoutMs must be greater than zero.',
        `jobs.${jobName}.timeoutMs`
      );
    }
    if (job.retries !== undefined && (!Number.isInteger(job.retries) || job.retries < 0)) {
      addError(
        diagnostics,
        'MODULE_JOB_RETRIES_INVALID',
        'Job retries must be a non-negative integer.',
        `jobs.${jobName}.retries`
      );
    }
  }

  const publishedEvents = definition.events?.publishes ?? [];
  const subscribedEvents = Object.entries(definition.events?.subscribes ?? {});
  const webhookEntries = Object.entries(definition.webhooks ?? {});

  if (publishedEvents.length > 0 && !modulePermissions.has(Permission.EventsEmit)) {
    addError(
      diagnostics,
      'MODULE_EVENTS_EMIT_PERMISSION_REQUIRED',
      'Event publish declarations require Permission.EventsEmit.',
      'permissions',
      'Add Permission.EventsEmit or remove events.publishes.'
    );
  }

  if (subscribedEvents.length > 0 && !modulePermissions.has(Permission.EventsSubscribe)) {
    addError(
      diagnostics,
      'MODULE_EVENTS_SUBSCRIBE_PERMISSION_REQUIRED',
      'Event subscription declarations require Permission.EventsSubscribe.',
      'permissions',
      'Add Permission.EventsSubscribe or remove events.subscribes.'
    );
  }

  if (webhookEntries.length > 0 && !modulePermissions.has(Permission.WebhookReceive)) {
    addError(
      diagnostics,
      'MODULE_WEBHOOK_RECEIVE_PERMISSION_REQUIRED',
      'Webhook declarations require Permission.WebhookReceive.',
      'permissions',
      'Add Permission.WebhookReceive or remove webhooks.'
    );
  }

  for (const [index, eventName] of publishedEvents.entries()) {
    if (!EVENT_NAME_PATTERN.test(eventName)) {
      addError(
        diagnostics,
        'MODULE_EVENT_NAME_INVALID',
        `Published event "${eventName}" must start with a lowercase letter and contain only lowercase letters, numbers, "_", ".", ":", or "-".`,
        `events.publishes.${index}`
      );
    }
  }

  for (const [eventName, handler] of subscribedEvents) {
    if (!EVENT_NAME_PATTERN.test(eventName)) {
      addError(
        diagnostics,
        'MODULE_EVENT_NAME_INVALID',
        `Subscribed event "${eventName}" must start with a lowercase letter and contain only lowercase letters, numbers, "_", ".", ":", or "-".`,
        `events.subscribes.${eventName}`
      );
    }
    validateLocalModulePath(
      diagnostics,
      handler,
      `events.subscribes.${eventName}`,
      'Event subscription handler'
    );
  }

  for (const [webhookName, webhook] of webhookEntries) {
    validateKey(diagnostics, webhookName, `webhooks.${webhookName}`, 'Webhook');
    validateRouteBase(diagnostics, webhook, `webhooks.${webhookName}`);
    validateLocalModulePath(
      diagnostics,
      webhook.handler,
      `webhooks.${webhookName}.handler`,
      'Webhook handler'
    );

    if (webhook.signature && !WEBHOOK_SIGNATURES.has(webhook.signature)) {
      addError(
        diagnostics,
        'MODULE_WEBHOOK_SIGNATURE_INVALID',
        `Webhook signature "${webhook.signature}" is not supported.`,
        `webhooks.${webhookName}.signature`,
        'Use "none", "hmac-sha256", "stripe", or "github".'
      );
    }

    for (const [index, method] of (webhook.methods ?? ['POST']).entries()) {
      if (!HTTP_METHODS.has(method)) {
        addError(
          diagnostics,
          'MODULE_WEBHOOK_METHOD_INVALID',
          `Webhook method "${method}" is not supported.`,
          `webhooks.${webhookName}.methods.${index}`
        );
      }
    }
  }
}

function validateLifecycle(
  diagnostics: ModuleDiagnostic[],
  lifecycle: ModuleLifecycleDefinition | undefined
): void {
  for (const [hookName, hookPath] of Object.entries(lifecycle ?? {})) {
    if (!LIFECYCLE_HOOKS.has(hookName)) {
      addError(
        diagnostics,
        'MODULE_LIFECYCLE_HOOK_UNKNOWN',
        `Lifecycle hook "${hookName}" is not supported.`,
        `lifecycle.${hookName}`,
        `Use one of ${[...LIFECYCLE_HOOKS].join(', ')}.`
      );
    }

    validateLocalModulePath(
      diagnostics,
      hookPath,
      `lifecycle.${hookName}`,
      `Lifecycle ${hookName} hook`
    );
  }
}

function validateDependencies(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  const npmDependencies = definition.dependencies?.npm;
  if (!npmDependencies) {
    return;
  }

  const entries = Array.isArray(npmDependencies)
    ? npmDependencies.map((name) => [name, '*'] as const)
    : Object.entries(npmDependencies);

  for (const [name, version] of entries) {
    if (!name.trim()) {
      addError(
        diagnostics,
        'MODULE_DEPENDENCY_NAME_REQUIRED',
        'Dependency name must not be empty.',
        'dependencies.npm'
      );
    }
    if (typeof version === 'string' && !version.trim()) {
      addError(
        diagnostics,
        'MODULE_DEPENDENCY_VERSION_REQUIRED',
        `Dependency "${name}" must declare a version range.`,
        `dependencies.npm.${name}`
      );
    }
  }
}

function serviceRequirementUsesV2Policy(
  requirement: NonNullable<ModuleDefinition['serviceRequirements']>[string]
): boolean {
  return Boolean(
    requirement.kind ||
      requirement.connection ||
      requirement.secrets ||
      requirement.claims ||
      requirement.operations
  );
}

function isAllowedServiceClaimExpression(expression: string): boolean {
  return (
    /^ctx\.module\.(id|version)$/.test(expression) ||
    /^ctx\.scope\.(productId|workspaceId|userId|actorId)$/.test(expression) ||
    /^ctx\.auth\.(actorId|isAuthenticated)$/.test(expression) ||
    /^ctx\.request\.(id|method|path|correlationId)$/.test(expression) ||
    /^resource\.[a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z][a-zA-Z0-9_]*$/.test(expression) ||
    /^input\.[a-zA-Z][a-zA-Z0-9_]*$/.test(expression)
  );
}

function validateServiceClaimsTemplate(
  diagnostics: ModuleDiagnostic[],
  template: string,
  path: string
): void {
  for (const match of template.matchAll(/\$\{([^}]+)\}/g)) {
    const expression = match[1]?.trim() ?? '';
    if (!isAllowedServiceClaimExpression(expression)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_CLAIMS_TEMPLATE_INVALID',
        `Service claims template "${template}" uses unsupported variable "${expression}".`,
        path,
        'Use only ctx.module, ctx.scope, ctx.auth, ctx.request, resource.<binding>.<field>, or allowlisted input.<field>.'
      );
    }
  }
}

function serviceHostnameIsPrivate(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1'
  ) {
    return true;
  }
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) {
    return true;
  }
  const octets = normalized.split('.').map((part) => Number(part));
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }
  const [first, second] = octets as [number, number, number, number];
  return (
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function validateServiceEgressOrigin(
  diagnostics: ModuleDiagnostic[],
  origin: string,
  path: string
): void {
  if (!ORIGIN_PATTERN.test(origin) || origin.includes('*')) {
    addError(
      diagnostics,
      'MODULE_SERVICE_EGRESS_INVALID',
      `Service egress origin "${origin}" must be an explicit HTTPS origin.`,
      path,
      'Use an origin like "https://api.example.com".'
    );
    return;
  }
  const parsed = new URL(origin);
  if (parsed.protocol !== 'https:') {
    addError(
      diagnostics,
      'MODULE_SERVICE_EGRESS_INVALID',
      `Service egress origin "${origin}" must use HTTPS.`,
      path,
      'Use an HTTPS origin.'
    );
  }
  if (serviceHostnameIsPrivate(parsed.hostname)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_PRIVATE_NETWORK_FORBIDDEN',
      `Service egress origin "${origin}" points at a private network host.`,
      path,
      'Use a public HTTPS service origin or add a dedicated host-managed provider.'
    );
  }
}

function validateServiceRequirement(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition,
  name: string,
  requirement: NonNullable<ModuleDefinition['serviceRequirements']>[string]
): void {
  if (!SERVICE_NAME_PATTERN.test(name)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_NAME_INVALID',
      `Service requirement "${name}" must start with a letter and contain only letters, digits, and underscores.`,
      `serviceRequirements.${name}`
    );
  }
  if (requirement.required === true && !requirement.provider?.trim()) {
    addError(
      diagnostics,
      'MODULE_SERVICE_PROVIDER_REQUIRED',
      `Required service "${name}" must declare a provider.`,
      `serviceRequirements.${name}.provider`,
      'Declare provider: "openai", "stripe", "email-webhook", or another host provider id.'
    );
  }
  if (requirement.provider !== undefined && !requirement.provider.trim()) {
    addError(
      diagnostics,
      'MODULE_SERVICE_PROVIDER_EMPTY',
      `Service requirement "${name}" provider must not be empty when declared.`,
      `serviceRequirements.${name}.provider`
    );
  }

  const usesV2Policy = serviceRequirementUsesV2Policy(requirement);
  if (usesV2Policy && definition.contractVersion !== 2) {
    addError(
      diagnostics,
      'MODULE_CONTRACT_V2_REQUIRED',
      `Service requirement "${name}" uses operation policy and must declare contractVersion: 2.`,
      'contractVersion',
      'Set contractVersion: 2 for modules that use service operation policies.'
    );
  }

  if (requirement.kind !== undefined && !SERVICE_CONNECTION_KINDS.has(requirement.kind)) {
    addError(
      diagnostics,
      'MODULE_SERVICE_CONNECTION_KIND_INVALID',
      `Service requirement "${name}" kind "${requirement.kind}" is not supported.`,
      `serviceRequirements.${name}.kind`,
      'Use kind: "signed-http".'
    );
  }

  const operations = requirement.operations ?? {};
  if (requirement.required === true && Object.keys(operations).length === 0) {
    addError(
      diagnostics,
      'MODULE_SERVICE_OPERATION_REQUIRED',
      `Required service "${name}" must declare at least one operation.`,
      `serviceRequirements.${name}.operations`,
      'Declare operation policies so runtime can enforce auth, signing, egress and redaction.'
    );
  }

  const signedHttp = requirement.kind === 'signed-http' || Object.keys(operations).length > 0;
  if (signedHttp) {
    const egress = requirement.connection?.egress ?? [];
    if (egress.length === 0) {
      addError(
        diagnostics,
        'MODULE_SERVICE_EGRESS_REQUIRED',
        `Signed HTTP service "${name}" must declare at least one HTTPS egress origin.`,
        `serviceRequirements.${name}.connection.egress`,
        'Declare egress: ["https://api.example.com"].'
      );
    }
    egress.forEach((origin, index) =>
      validateServiceEgressOrigin(
        diagnostics,
        origin,
        `serviceRequirements.${name}.connection.egress.${index}`
      )
    );
  }

  const declaredSecrets = new Set(Object.keys(requirement.secrets ?? {}));
  for (const [claimName, template] of Object.entries(requirement.claims ?? {})) {
    validateServiceClaimsTemplate(
      diagnostics,
      template,
      `serviceRequirements.${name}.claims.${claimName}`
    );
  }

  for (const [operationName, operation] of Object.entries(operations)) {
    if (!SERVICE_OPERATION_PATTERN.test(operationName)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_OPERATION_NAME_INVALID',
        `Service operation "${name}.${operationName}" must use a stable operation id.`,
        `serviceRequirements.${name}.operations.${operationName}`,
        'Use names like "admin.request" or "runs.create".'
      );
    }
    if (operation.method !== undefined && !HTTP_METHODS.has(operation.method)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_OPERATION_METHOD_INVALID',
        `Service operation "${name}.${operationName}" method "${operation.method}" is not supported.`,
        `serviceRequirements.${name}.operations.${operationName}.method`
      );
    }
    if (operation.path !== undefined && !operation.path.startsWith('/')) {
      addError(
        diagnostics,
        'MODULE_SERVICE_OPERATION_PATH_INVALID',
        `Service operation "${name}.${operationName}" path must start with "/".`,
        `serviceRequirements.${name}.operations.${operationName}.path`
      );
    }
    for (const [index, field] of (operation.input?.allow ?? []).entries()) {
      if (!SERVICE_INPUT_FIELDS.has(field)) {
        addError(
          diagnostics,
          'MODULE_SERVICE_INPUT_FIELD_INVALID',
          `Service operation "${name}.${operationName}" allows unsupported input field "${field}".`,
          `serviceRequirements.${name}.operations.${operationName}.input.allow.${index}`,
          'Use url, path, method, headers, query, body, or json.'
        );
      }
    }
    for (const [index, field] of (operation.input?.claimsAllow ?? []).entries()) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field)) {
        addError(
          diagnostics,
          'MODULE_SERVICE_CLAIMS_INPUT_FIELD_INVALID',
          `Service operation "${name}.${operationName}" claimsAllow field "${field}" is not supported.`,
          `serviceRequirements.${name}.operations.${operationName}.input.claimsAllow.${index}`,
          'Use top-level input field names like "workflowId".'
        );
      }
    }
    if (operation.auth && !SERVICE_AUTH_TYPES.has(operation.auth.type)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_AUTH_TYPE_INVALID',
        `Service operation "${name}.${operationName}" auth type "${operation.auth.type}" is not supported.`,
        `serviceRequirements.${name}.operations.${operationName}.auth.type`
      );
    }
    if (
      operation.auth?.type === 'bearer' &&
      (!operation.auth.secret || !declaredSecrets.has(operation.auth.secret))
    ) {
      addError(
        diagnostics,
        'MODULE_SERVICE_SECRET_REQUIRED',
        `Service operation "${name}.${operationName}" bearer auth references an undeclared secret.`,
        `serviceRequirements.${name}.operations.${operationName}.auth.secret`,
        'Declare the secret under serviceRequirements.<service>.secrets.'
      );
    }
    if (operation.auth?.header && !HTTP_HEADER_NAME_PATTERN.test(operation.auth.header)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_HEADER_INVALID',
        `Service operation "${name}.${operationName}" auth header "${operation.auth.header}" is invalid.`,
        `serviceRequirements.${name}.operations.${operationName}.auth.header`
      );
    }
    if (operation.signing && !SERVICE_SIGNING_TYPES.has(operation.signing.type)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_SIGNING_TYPE_INVALID',
        `Service operation "${name}.${operationName}" signing type "${operation.signing.type}" is not supported.`,
        `serviceRequirements.${name}.operations.${operationName}.signing.type`
      );
    }
    if (
      operation.signing?.type === 'hmac-sha256' &&
      (!operation.signing.secret || !declaredSecrets.has(operation.signing.secret))
    ) {
      addError(
        diagnostics,
        'MODULE_SERVICE_SECRET_REQUIRED',
        `Service operation "${name}.${operationName}" HMAC signing references an undeclared secret.`,
        `serviceRequirements.${name}.operations.${operationName}.signing.secret`,
        'Declare the secret under serviceRequirements.<service>.secrets.'
      );
    }
    for (const [headerPath, header] of [
      ['header', operation.signing?.header],
      ['timestampHeader', operation.signing?.timestampHeader],
      ['claimsHeader', operation.signing?.claimsHeader],
    ] as const) {
      if (header && !HTTP_HEADER_NAME_PATTERN.test(header)) {
        addError(
          diagnostics,
          'MODULE_SERVICE_HEADER_INVALID',
          `Service operation "${name}.${operationName}" signing header "${header}" is invalid.`,
          `serviceRequirements.${name}.operations.${operationName}.signing.${headerPath}`
        );
      }
    }
    for (const [index, field] of (operation.signing?.canonical ?? []).entries()) {
      if (!SERVICE_SIGNING_CANONICAL_FIELDS.has(field)) {
        addError(
          diagnostics,
          'MODULE_SERVICE_SIGNING_CANONICAL_INVALID',
          `Service operation "${name}.${operationName}" canonical signing field "${field}" is not supported.`,
          `serviceRequirements.${name}.operations.${operationName}.signing.canonical.${index}`,
          'Use method, path, timestamp, bodySha256, or claimsSha256.'
        );
      }
    }
    if (
      operation.signing?.type === 'hmac-sha256' &&
      !Object.values(requirement.claims ?? {}).includes('${ctx.request.id}')
    ) {
      addError(
        diagnostics,
        'MODULE_SERVICE_REQUEST_ID_REQUIRED',
        `Service operation "${name}.${operationName}" HMAC claims must include ctx.request.id.`,
        `serviceRequirements.${name}.claims`,
        'Add requestId: "${ctx.request.id}" to the service claims template.'
      );
    }
    if (operation.request?.body && !SERVICE_REQUEST_BODIES.has(operation.request.body)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_REQUEST_BODY_INVALID',
        `Service operation "${name}.${operationName}" request body policy is not supported.`,
        `serviceRequirements.${name}.operations.${operationName}.request.body`
      );
    }
    if (operation.response?.body && !SERVICE_RESPONSE_BODIES.has(operation.response.body)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_RESPONSE_BODY_INVALID',
        `Service operation "${name}.${operationName}" response body policy is not supported.`,
        `serviceRequirements.${name}.operations.${operationName}.response.body`
      );
    }
    const managedServiceHeaders = operationManagedServiceHeaders(operation);
    for (const [index, header] of (operation.request?.allowHeaders ?? []).entries()) {
      if (!HTTP_HEADER_NAME_PATTERN.test(header)) {
        addError(
          diagnostics,
          'MODULE_SERVICE_HEADER_INVALID',
          `Service operation "${name}.${operationName}" has invalid allowed header "${header}".`,
          `serviceRequirements.${name}.operations.${operationName}.request.allowHeaders.${index}`
        );
      }
      if (managedServiceHeaders.has(header.toLowerCase())) {
        addError(
          diagnostics,
          'MODULE_SERVICE_MANAGED_HEADER_DENIED',
          `Service operation "${name}.${operationName}" cannot allow module-controlled header "${header}".`,
          `serviceRequirements.${name}.operations.${operationName}.request.allowHeaders.${index}`,
          'Runtime manages auth, cookie and signature headers.'
        );
      }
    }
    for (const [index, header] of (operation.request?.denyHeaders ?? []).entries()) {
      if (header.trim() && !HTTP_HEADER_NAME_PATTERN.test(header)) {
        addError(
          diagnostics,
          'MODULE_SERVICE_HEADER_INVALID',
          `Service operation "${name}.${operationName}" has invalid denied header "${header}".`,
          `serviceRequirements.${name}.operations.${operationName}.request.denyHeaders.${index}`
        );
      }
    }
    if (
      operation.request?.denyHeaders &&
      operation.request.denyHeaders.some((header) => !header.trim())
    ) {
      addError(
        diagnostics,
        'MODULE_SERVICE_DENY_HEADER_INVALID',
        `Service operation "${name}.${operationName}" has an empty denied header.`,
        `serviceRequirements.${name}.operations.${operationName}.request.denyHeaders`
      );
    }
  }

  if (requirement.connection?.retry?.backoff) {
    const backoff = requirement.connection.retry.backoff;
    if (!SERVICE_RETRY_BACKOFFS.has(backoff)) {
      addError(
        diagnostics,
        'MODULE_SERVICE_RETRY_BACKOFF_INVALID',
        `Service requirement "${name}" retry backoff "${backoff}" is not supported.`,
        `serviceRequirements.${name}.connection.retry.backoff`
      );
    }
  }
}

function validateCapabilityMetadata(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  for (const [meterName, meter] of Object.entries(definition.meters ?? {})) {
    validateKey(diagnostics, meterName, `meters.${meterName}`, 'Meter');
    if (meter.unit !== undefined && !meter.unit.trim()) {
      addError(
        diagnostics,
        'MODULE_METER_UNIT_EMPTY',
        `Meter "${meterName}" unit must not be empty when declared.`,
        `meters.${meterName}.unit`
      );
    }
  }

  for (const [name, requirement] of Object.entries(definition.serviceRequirements ?? {})) {
    validateServiceRequirement(diagnostics, definition, name, requirement);
  }

  for (const [name, binding] of Object.entries(definition.resourceBindings ?? {})) {
    validateKey(diagnostics, name, `resourceBindings.${name}`, 'Resource binding');
    if (!binding.kind?.trim()) {
      addError(
        diagnostics,
        'MODULE_RESOURCE_BINDING_KIND_REQUIRED',
        `Resource binding "${name}" must declare a kind.`,
        `resourceBindings.${name}.kind`
      );
    }
  }

  for (const [name, config] of Object.entries(definition.config ?? {})) {
    validateKey(diagnostics, name, `config.${name}`, 'Config field');
    if (!['string', 'number', 'boolean', 'json'].includes(config.type)) {
      addError(
        diagnostics,
        'MODULE_CONFIG_TYPE_INVALID',
        `Config field "${name}" type "${config.type}" is not supported.`,
        `config.${name}.type`
      );
    }

    if (config.secret === true && config.default !== undefined) {
      addError(
        diagnostics,
        'MODULE_SECRET_DEFAULT_FORBIDDEN',
        `Secret config field "${name}" must not declare a default value.`,
        `config.${name}.default`,
        'Remove the default and provide the value through ctx.secrets or host secret configuration.'
      );
    }
  }
}

function validateEgress(diagnostics: ModuleDiagnostic[], definition: ModuleDefinition): void {
  const egress = definition.egress ?? [];
  const permissions = new Set(definition.permissions ?? []);

  if (egress.length > 0 && !permissions.has(Permission.ExternalHttp)) {
    addError(
      diagnostics,
      'MODULE_EGRESS_PERMISSION_REQUIRED',
      'Modules that declare egress origins must also declare Permission.ExternalHttp.',
      'permissions',
      'Add Permission.ExternalHttp or remove the unused egress declaration.'
    );
  }

  if (permissions.has(Permission.ExternalHttp) && egress.length === 0) {
    addError(
      diagnostics,
      'MODULE_HTTP_EGRESS_REQUIRED',
      'Permission.ExternalHttp requires at least one explicit egress origin.',
      'egress',
      'Declare egress: ["https://api.example.com"].'
    );
  }

  for (const [index, origin] of (definition.egress ?? []).entries()) {
    if (!ORIGIN_PATTERN.test(origin) || origin.includes('*')) {
      addError(
        diagnostics,
        'MODULE_EGRESS_ORIGIN_INVALID',
        `Egress origin "${origin}" must be an explicit http(s) origin.`,
        `egress.${index}`,
        'Use an origin like "https://api.example.com".'
      );
    }
  }
}

export function validateModuleDefinition(definition: ModuleDefinition): ModuleDiagnostic[] {
  const diagnostics: ModuleDiagnostic[] = [];

  if (
    definition.contractVersion !== undefined &&
    definition.contractVersion !== 1 &&
    definition.contractVersion !== 2
  ) {
    addError(
      diagnostics,
      'MODULE_CONTRACT_VERSION_UNSUPPORTED',
      `Module contract version "${definition.contractVersion}" is not supported.`,
      'contractVersion',
      'Use contractVersion: 1, contractVersion: 2, or omit the field to use the current default.'
    );
  }

  if (!MODULE_ID_PATTERN.test(definition.id)) {
    addError(
      diagnostics,
      'MODULE_ID_INVALID',
      `Module id "${definition.id}" must contain only lowercase letters, numbers, and hyphens.`,
      'id',
      'Use an id like "cms", "shop", or "workflow".'
    );
  }

  if (!definition.name.trim()) {
    addError(diagnostics, 'MODULE_NAME_REQUIRED', 'Module name is required.', 'name');
  }

  if (!SEMVER_PATTERN.test(definition.version)) {
    addError(
      diagnostics,
      'MODULE_VERSION_INVALID',
      `Module version "${definition.version}" must follow semantic versioning.`,
      'version',
      'Use a version like "0.1.0".'
    );
  }

  validatePermissionList(diagnostics, definition.permissions, 'permissions');
  validateContractParts(diagnostics, definition);
  validateData(diagnostics, definition.data);
  validateRoutes(diagnostics, definition);
  validateActions(diagnostics, definition);
  validateSurfaces(diagnostics, definition);
  validateTheme(diagnostics, definition);
  validateNavigation(diagnostics, definition);
  validateProduct(diagnostics, definition);
  validateResources(diagnostics, definition);
  validateI18n(diagnostics, definition);
  validatePresentation(diagnostics, definition);
  validateJobsEventsWebhooks(diagnostics, definition);
  validateLifecycle(diagnostics, definition.lifecycle);
  validateDependencies(diagnostics, definition);
  validateCapabilityMetadata(diagnostics, definition);
  validateEgress(diagnostics, definition);

  return diagnostics;
}
