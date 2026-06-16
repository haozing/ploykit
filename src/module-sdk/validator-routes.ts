import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import { validateAnonymousPolicy } from './validator-anonymous-policy';
import { ModulePermissionValues, SystemOnlyPermissions, type PermissionValue } from './permissions';
import type {
  ModuleApiRoute,
  ModuleCommercialRequirement,
  ModuleDefinition,
  ModuleHttpMethod,
  ModulePageRoute,
  ModuleRouteAuth,
} from './types';

const LOCAL_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;

const ROUTE_AUTHS = new Set<ModuleRouteAuth>(['public', 'auth', 'admin']);
const HTTP_METHODS = new Set<ModuleHttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const MACHINE_AUTHS = new Set(['apiKey', 'user-or-apiKey']);
const CACHE_STRATEGIES = new Set(['none', 'public', 'private']);
const PAGE_METADATA_REQUIRED_FIELDS = new Set([
  'title',
  'description',
  'canonical',
  'sitemap',
  'openGraph',
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

function isReservedPublicAlias(value: string): boolean {
  if (RESERVED_PUBLIC_ALIAS_PATHS.has(value)) {
    return true;
  }

  return RESERVED_PUBLIC_ALIAS_PREFIXES.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`)
  );
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

function validateRoutePathConflicts(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
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

export function validateRoutes(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
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
