import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import { validateAnonymousPolicy } from './validator-anonymous-policy';
import {
  ModulePermissionValues,
  ReservedRuntimePermissions,
  SystemOnlyPermissions,
  type PermissionValue,
} from './permissions';
import type {
  ModuleCommercialRequirement,
  ModuleApiDefinitionContract,
  ModuleDefinition,
  ModuleHttpMethod,
  ModulePageArea,
  ModulePageDefinition,
  ModuleResourceDefinition,
  ModuleSchemaDefinition,
  ModuleSchemaFieldDefinition,
  ModuleSchemaPrimitive,
  ModuleSchemaReference,
  ModuleRouteAuth,
} from './types';

const LOCAL_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;
const MODULE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const SCHEMA_FIELD_TYPES = new Set<ModuleSchemaPrimitive>([
  'string',
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'datetime',
  'json',
  'uuid',
]);
const PAGE_AREAS = new Set<ModulePageArea>(['site', 'dashboard', 'admin']);
const PAGE_ID_PATTERN = /^[a-z][a-z0-9_.-]*$/;
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
const ROUTE_PARAM_PATTERN = /(?:\[\.{3}([A-Za-z][A-Za-z0-9_]*)\]|\[([A-Za-z][A-Za-z0-9_]*)\]|:([A-Za-z][A-Za-z0-9_]*))/g;
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
const TENANT_AUTHORITY_FIELDS = new Set(['tenant_id', 'workspace_id', 'organization_id']);

function addError(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity: 'error', message, path, fix }));
}

function addWarning(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity: 'warning', message, path, fix }));
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
      'Use a path like "./pages/NotesListPage".'
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
    if (ReservedRuntimePermissions.has(permissionValue)) {
      addError(
        diagnostics,
        'MODULE_PERMISSION_RESERVED_RUNTIME',
        `Permission "${permission}" is reserved and has no request runtime capability.`,
        itemPath,
        'Remove it until the host exposes and guards the matching capability.'
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

function validateEntryBase(
  diagnostics: ModuleDiagnostic[],
  entry: {
    auth?: ModuleRouteAuth;
    permissions?: readonly string[];
    commercial?: ModuleCommercialRequirement;
  },
  path: string,
  modulePermissions: ReadonlySet<string>
): void {
  if (entry.auth && !ROUTE_AUTHS.has(entry.auth)) {
    addError(
      diagnostics,
      'MODULE_ROUTE_AUTH_INVALID',
      `Route auth "${entry.auth}" is not supported.`,
      `${path}.auth`
    );
  }
  validatePermissionList(diagnostics, entry.permissions, `${path}.permissions`);
  validateDeclaredPermissionList(
    diagnostics,
    entry.permissions,
    modulePermissions,
    `${path}.permissions`
  );
  validateCommercialRequirement(diagnostics, entry.commercial, `${path}.commercial`);
}

function isReservedPublicAlias(value: string): boolean {
  if (RESERVED_PUBLIC_ALIAS_PATHS.has(value)) {
    return true;
  }

  return RESERVED_PUBLIC_ALIAS_PREFIXES.some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`)
  );
}

function routeParamNames(routePath: string): Set<string> {
  const names = new Set<string>();
  for (const match of routePath.matchAll(ROUTE_PARAM_PATTERN)) {
    const name = match[1] ?? match[2] ?? match[3];
    if (name) {
      names.add(name);
    }
  }
  return names;
}

function validateSingleParamSelector(
  diagnostics: ModuleDiagnostic[],
  selector: Record<string, unknown> | undefined,
  path: string,
  routeParams: ReadonlySet<string>
): string | undefined {
  if (!selector) {
    return undefined;
  }
  const selectorParams = Object.keys(selector);
  if (selectorParams.length !== 1) {
    addError(
      diagnostics,
      'MODULE_ROUTE_PARAM_SELECTOR_COUNT_INVALID',
      'Route param selectors must declare exactly one route parameter.',
      path,
      'Use a shape like { section: { guide: "./loaders/guide" } }.'
    );
    return undefined;
  }
  const [paramName] = selectorParams;
  if (!routeParams.has(paramName)) {
    addError(
      diagnostics,
      'MODULE_ROUTE_PARAM_SELECTOR_UNKNOWN',
      `Route param selector "${paramName}" does not exist in the page path.`,
      path,
      'Use one of the dynamic parameter names from the page path.'
    );
  }
  return paramName;
}

function validateParamLoaderMap(
  diagnostics: ModuleDiagnostic[],
  selector: ModulePageDefinition['loaderByParam'],
  path: string,
  label: string,
  routeParams: ReadonlySet<string>
): void {
  const paramName = validateSingleParamSelector(
    diagnostics,
    selector as Record<string, unknown> | undefined,
    path,
    routeParams
  );
  if (!paramName || !selector) {
    return;
  }
  const branches = selector[paramName] ?? {};
  const entries = Object.entries(branches);
  if (entries.length === 0) {
    addError(
      diagnostics,
      'MODULE_ROUTE_PARAM_SELECTOR_EMPTY',
      `${label} param selector must declare at least one branch.`,
      `${path}.${paramName}`
    );
  }
  for (const [value, localPath] of entries) {
    if (!value.trim()) {
      addError(
        diagnostics,
        'MODULE_ROUTE_PARAM_VALUE_EMPTY',
        `${label} param branch values must not be empty.`,
        `${path}.${paramName}`
      );
    }
    validateLocalModulePath(
      diagnostics,
      localPath,
      `${path}.${paramName}.${value}`,
      `${label} param branch`
    );
  }
}

function validateCachePolicy(
  diagnostics: ModuleDiagnostic[],
  cache: ModulePageDefinition['cache'],
  path: string
): void {
  if (!cache) {
    return;
  }

  if (!CACHE_STRATEGIES.has(cache.strategy)) {
    addError(
      diagnostics,
      'MODULE_ROUTE_CACHE_STRATEGY_INVALID',
      `Cache strategy "${cache.strategy}" is not supported.`,
      `${path}.strategy`
    );
  }

  if (
    cache.revalidateSeconds !== undefined &&
    (!Number.isInteger(cache.revalidateSeconds) || cache.revalidateSeconds <= 0)
  ) {
    addError(
      diagnostics,
      'MODULE_ROUTE_CACHE_REVALIDATE_INVALID',
      'Cache revalidateSeconds must be a positive integer when declared.',
      `${path}.revalidateSeconds`
    );
  }

  for (const [index, tag] of (cache.tags ?? []).entries()) {
    if (!tag.trim()) {
      addError(
        diagnostics,
        'MODULE_ROUTE_CACHE_TAG_EMPTY',
        'Cache tags must not be empty.',
        `${path}.tags.${index}`
      );
    }
  }
}

function validateParamCacheMap(
  diagnostics: ModuleDiagnostic[],
  selector: ModulePageDefinition['cacheByParam'],
  path: string,
  routeParams: ReadonlySet<string>
): void {
  const paramName = validateSingleParamSelector(
    diagnostics,
    selector as Record<string, unknown> | undefined,
    path,
    routeParams
  );
  if (!paramName || !selector) {
    return;
  }
  const branches = selector[paramName] ?? {};
  const entries = Object.entries(branches);
  if (entries.length === 0) {
    addError(
      diagnostics,
      'MODULE_ROUTE_PARAM_SELECTOR_EMPTY',
      'Cache param selector must declare at least one branch.',
      `${path}.${paramName}`
    );
  }
  for (const [value, cache] of entries) {
    if (!value.trim()) {
      addError(
        diagnostics,
        'MODULE_ROUTE_PARAM_VALUE_EMPTY',
        'Cache param branch values must not be empty.',
        `${path}.${paramName}`
      );
    }
    validateCachePolicy(diagnostics, cache, `${path}.${paramName}.${value}`);
  }
}

function validatePublicParamCachePolicy(
  diagnostics: ModuleDiagnostic[],
  selector: ModulePageDefinition['cacheByParam'],
  path: string
): void {
  for (const [paramName, branches] of Object.entries(selector ?? {})) {
    for (const [value, cache] of Object.entries(branches ?? {})) {
      if (cache?.strategy === 'private') {
        addError(
          diagnostics,
          'MODULE_PUBLIC_ROUTE_PRIVATE_CACHE',
          'Public pages cannot use private cache strategy.',
          `${path}.${paramName}.${value}.strategy`,
          'Use "public" or "none".'
        );
      }
    }
  }
}

function validatePageAliases(
  diagnostics: ModuleDiagnostic[],
  page: ModulePageDefinition,
  path: string
): void {
  const aliases = page.aliases ?? [];
  if (aliases.length > 0 && page.area === 'site') {
    addError(
      diagnostics,
      'MODULE_ROUTE_ALIAS_NON_SITE_ONLY',
      'Page aliases are only supported on dashboard and admin pages.',
      `${path}.aliases`,
      'Use publicAliases for public site alternate paths.'
    );
  }

  const aliasSeen = new Set<string>();
  for (const [index, alias] of aliases.entries()) {
    const aliasPath = `${path}.aliases.${index}`;
    if (!alias.startsWith('/') || alias.includes('?') || alias.includes('#')) {
      addError(
        diagnostics,
        'MODULE_ROUTE_ALIAS_PATH_INVALID',
        `Page alias "${alias}" must be an absolute path without query or hash.`,
        aliasPath,
        'Use a module-local alias path like "/orders" or "/billing".'
      );
      continue;
    }
    if (alias.includes(':') || alias.includes('*')) {
      addError(
        diagnostics,
        'MODULE_ROUTE_ALIAS_DYNAMIC_UNSUPPORTED',
        `Page alias "${alias}" must be a static path.`,
        aliasPath,
        'Use a fixed alias path that resolves to this canonical page.'
      );
    }
    if (alias === page.path) {
      addError(
        diagnostics,
        'MODULE_ROUTE_ALIAS_SELF_REFERENCE',
        `Page alias "${alias}" duplicates the canonical page path.`,
        aliasPath,
        'Remove the alias or point it at another alternate path.'
      );
    }
    if (aliasSeen.has(alias)) {
      addError(
        diagnostics,
        'MODULE_ROUTE_ALIAS_DUPLICATE',
        `Page alias "${alias}" is duplicated in this page.`,
        aliasPath
      );
    }
    aliasSeen.add(alias);
  }

  const publicAliases = page.publicAliases ?? [];
  if (publicAliases.length > 0 && page.area !== 'site') {
    addError(
      diagnostics,
      'MODULE_PUBLIC_ALIAS_SITE_ONLY',
      'Public aliases are only supported on site pages.',
      `${path}.publicAliases`,
      'Move this page to area: "site" or remove publicAliases.'
    );
  }
  if (publicAliases.length > 0 && page.auth !== 'public') {
    addError(
      diagnostics,
      'MODULE_PUBLIC_ALIAS_PUBLIC_AUTH_REQUIRED',
      'Public aliases require the page to declare auth: "public".',
      `${path}.auth`,
      'Set auth: "public" or remove publicAliases.'
    );
  }

  const publicAliasSeen = new Set<string>();
  for (const [index, alias] of publicAliases.entries()) {
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
    if (publicAliasSeen.has(alias)) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_ALIAS_DUPLICATE',
        `Public alias "${alias}" is duplicated in this page.`,
        aliasPath
      );
    }
    publicAliasSeen.add(alias);
  }
}

function isSchemaDefinition(value: ModuleSchemaReference | undefined): value is ModuleSchemaDefinition {
  return Boolean(value && typeof value === 'object' && value.$$type === 'ploykit.schema');
}

function validateSchemaReference(
  diagnostics: ModuleDiagnostic[],
  value: ModuleSchemaReference | undefined,
  path: string,
  label: string
): void {
  if (!value) {
    addError(
      diagnostics,
      'MODULE_SCHEMA_REQUIRED',
      `${label} must declare a runtime schema.`,
      path,
      'Use schema({...}) or a module-local schema path.'
    );
    return;
  }

  if (typeof value === 'string') {
    validateLocalModulePath(diagnostics, value, path, label);
    return;
  }

  validateSchemaDefinition(diagnostics, value, path, label);
}

function validateSchemaDefinition(
  diagnostics: ModuleDiagnostic[],
  schema: ModuleSchemaDefinition,
  path: string,
  label: string
): void {
  if (schema.$$type !== 'ploykit.schema') {
    addError(
      diagnostics,
      'MODULE_SCHEMA_DSL_REQUIRED',
      `${label} must be created with schema(...).`,
      path,
      'Use schema({ fields: { ... } }).'
    );
  }

  const fields = Object.entries(schema.fields ?? {});
  if (fields.length === 0) {
    addError(
      diagnostics,
      'MODULE_SCHEMA_FIELDS_REQUIRED',
      `${label} must declare at least one field.`,
      `${path}.fields`
    );
  }

  for (const [fieldName, field] of fields) {
    validateSchemaField(diagnostics, fieldName, field, `${path}.fields.${fieldName}`);
  }
}

function validateSchemaField(
  diagnostics: ModuleDiagnostic[],
  fieldName: string,
  field: ModuleSchemaFieldDefinition,
  path: string
): void {
  if (!MODULE_KEY_PATTERN.test(fieldName)) {
    addError(
      diagnostics,
      'MODULE_SCHEMA_FIELD_NAME_INVALID',
      `Schema field "${fieldName}" must use snake_case and start with a letter.`,
      path
    );
  }

  if (!SCHEMA_FIELD_TYPES.has(field.type)) {
    addError(
      diagnostics,
      'MODULE_SCHEMA_FIELD_TYPE_INVALID',
      `Schema field type "${field.type}" is not supported.`,
      `${path}.type`
    );
  }
}

function validatePage(
  diagnostics: ModuleDiagnostic[],
  page: ModulePageDefinition,
  path: string,
  modulePermissions: ReadonlySet<string>
): void {
  const routeParams = routeParamNames(page.path ?? '');

  if (!page.id || !PAGE_ID_PATTERN.test(page.id)) {
    addError(
      diagnostics,
      'MODULE_PAGE_ID_INVALID',
      'Page id must be present and use lowercase letters, numbers, dots, dashes, or underscores.',
      `${path}.id`
    );
  }

  if (!PAGE_AREAS.has(page.area)) {
    addError(
      diagnostics,
      'MODULE_PAGE_AREA_INVALID',
      `Page area "${page.area}" is not supported.`,
      `${path}.area`
    );
  }

  if (!page.path?.startsWith('/')) {
    addError(
      diagnostics,
      'MODULE_ROUTE_PATH_INVALID',
      `Page path "${page.path}" must start with "/".`,
      `${path}.path`
    );
  }

  if (!page.frame || !String(page.frame).trim()) {
    addError(
      diagnostics,
      'MODULE_PAGE_FRAME_REQUIRED',
      'Page frame is required.',
      `${path}.frame`,
      'Declare the host frame, for example frame: "workspace".'
    );
  }

  validateEntryBase(diagnostics, page, path, modulePermissions);
  validateLocalModulePath(diagnostics, page.component, `${path}.component`, 'Page component');
  validateLocalModulePath(diagnostics, page.loader, `${path}.loader`, 'Page loader', false);
  validateParamLoaderMap(
    diagnostics,
    page.loaderByParam,
    `${path}.loaderByParam`,
    'Page loader',
    routeParams
  );
  validateLocalModulePath(diagnostics, page.metadata, `${path}.metadata`, 'Page metadata', false);
  validateParamLoaderMap(
    diagnostics,
    page.metadataByParam,
    `${path}.metadataByParam`,
    'Page metadata',
    routeParams
  );
  validatePageAliases(diagnostics, page, path);

  for (const [index, field] of (page.metadataResult?.required ?? []).entries()) {
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

  validateCachePolicy(diagnostics, page.cache, `${path}.cache`);
  validateParamCacheMap(diagnostics, page.cacheByParam, `${path}.cacheByParam`, routeParams);

  if (page.area === 'site' && page.auth === 'public') {
    if (!page.metadata && !page.metadataByParam) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_SITE_METADATA_REQUIRED',
        'Public site pages must declare a metadata loader for title, description, canonical, and sitemap behavior.',
        `${path}.metadata`,
        'Add metadata: "./loaders/metadata" and return structured SEO metadata.'
      );
    }

    if (!page.cache && !page.cacheByParam) {
      addError(
        diagnostics,
        'MODULE_PUBLIC_SITE_CACHE_REQUIRED',
        'Public site pages must declare an explicit cache strategy.',
        `${path}.cache`,
        'Add cache: { strategy: "public", revalidateSeconds: 300, tags: ["module-id"] } or strategy: "none".'
      );
    }
  }

  if (page.auth === 'public' && page.cache?.strategy === 'private') {
    addError(
      diagnostics,
      'MODULE_PUBLIC_ROUTE_PRIVATE_CACHE',
      'Public pages cannot use private cache strategy.',
      `${path}.cache.strategy`,
      'Use "public" or "none".'
    );
  }
  if (page.auth === 'public') {
    validatePublicParamCachePolicy(diagnostics, page.cacheByParam, `${path}.cacheByParam`);
  }
}

function validatePagePathConflicts(
  diagnostics: ModuleDiagnostic[],
  pages: readonly ModulePageDefinition[] | undefined
): void {
  for (const area of ['site', 'dashboard', 'admin'] as const) {
    const owners = new Map<string, string>();
    for (const [index, page] of (pages ?? []).entries()) {
      if (page.area !== area) {
        continue;
      }
      const pagePath = `pages.${index}`;
      const paths = [
        { path: page.path, source: 'path', diagnosticPath: `${pagePath}.path` },
        ...(page.aliases ?? []).map((alias, aliasIndex) => ({
          path: alias,
          source: 'alias',
          diagnosticPath: `${pagePath}.aliases.${aliasIndex}`,
        })),
        ...(page.publicAliases ?? []).map((alias, aliasIndex) => ({
          path: alias,
          source: 'publicAlias',
          diagnosticPath: `${pagePath}.publicAliases.${aliasIndex}`,
        })),
      ];

      for (const item of paths) {
        const owner = owners.get(item.path);
        if (owner) {
          addError(
            diagnostics,
            'MODULE_ROUTE_PATH_CONFLICT',
            `${area} page ${item.source} "${item.path}" conflicts with ${owner}.`,
            item.diagnosticPath,
            'Keep each canonical path, page alias, and public alias unique within the same page area.'
          );
        } else {
          owners.set(item.path, `${pagePath}.${item.source}`);
        }
      }
    }
  }
}

function validateApiContract(
  diagnostics: ModuleDiagnostic[],
  api: ModuleApiDefinitionContract,
  path: string,
  modulePermissions: ReadonlySet<string>
): void {
  if (!api.id || !PAGE_ID_PATTERN.test(api.id)) {
    addError(
      diagnostics,
      'MODULE_API_ID_INVALID',
      'API id must be present and use lowercase letters, numbers, dots, dashes, or underscores.',
      `${path}.id`
    );
  }

  if (!api.path?.startsWith('/')) {
    addError(
      diagnostics,
      'MODULE_ROUTE_PATH_INVALID',
      `API path "${api.path}" must start with "/".`,
      `${path}.path`
    );
  }

  validateEntryBase(diagnostics, api, path, modulePermissions);

  for (const [index, method] of (api.methods ?? ['GET']).entries()) {
    if (!HTTP_METHODS.has(method)) {
      addError(
        diagnostics,
        'MODULE_API_METHOD_INVALID',
        `HTTP method "${method}" is not supported.`,
        `${path}.methods.${index}`
      );
    }
  }

  if (api.machineAuth && !MACHINE_AUTHS.has(api.machineAuth)) {
    addError(
      diagnostics,
      'MODULE_API_MACHINE_AUTH_INVALID',
      `Machine auth "${api.machineAuth}" is not supported.`,
      `${path}.machineAuth`,
      'Use "apiKey" or "user-or-apiKey".'
    );
  }

  if (api.machineAuth && api.auth === 'public') {
    addError(
      diagnostics,
      'MODULE_API_MACHINE_AUTH_NOT_PUBLIC',
      'Machine-auth API routes cannot use auth: "public".',
      `${path}.auth`,
      'Use auth: "auth" or auth: "admin".'
    );
  }

  if (api.auth === 'public' && !api.anonymousPolicy) {
    addError(
      diagnostics,
      'MODULE_PUBLIC_API_ANONYMOUS_POLICY_REQUIRED',
      'Public API routes must declare anonymousPolicy.',
      `${path}.anonymousPolicy`,
      'Add rateLimit, upload, captcha, or high-cost policy for this public API.'
    );
  }

  if (api.auth === 'public') {
    validateAnonymousPolicy(diagnostics, api, path);
  }

  if (api.idempotency?.required && !api.idempotency.keyFrom) {
    addError(
      diagnostics,
      'MODULE_API_IDEMPOTENCY_KEY_SOURCE_REQUIRED',
      'Idempotent API routes must declare idempotency.keyFrom.',
      `${path}.idempotency.keyFrom`,
      'Use "request" to require an Idempotency-Key request header.'
    );
  }

  if (api.idempotency?.keyFrom && api.idempotency.keyFrom !== 'request') {
    addError(
      diagnostics,
      'MODULE_API_IDEMPOTENCY_KEY_SOURCE_INVALID',
      `API route idempotency.keyFrom "${api.idempotency.keyFrom}" is not supported.`,
      `${path}.idempotency.keyFrom`,
      'Use "request".'
    );
  }

  validateLocalModulePath(diagnostics, api.handler, `${path}.handler`, 'API handler');
  validateSchemaReference(diagnostics, api.input, `${path}.input`, 'API input');
  validateSchemaReference(diagnostics, api.output, `${path}.output`, 'API output');
}

function validateResource(
  diagnostics: ModuleDiagnostic[],
  resourceName: string,
  resource: ModuleResourceDefinition,
  path: string,
  modulePermissions: ReadonlySet<string>
): void {
  if (!MODULE_KEY_PATTERN.test(resourceName)) {
    addError(
      diagnostics,
      'MODULE_RESOURCE_NAME_INVALID',
      `Resource "${resourceName}" must use snake_case and start with a letter.`,
      path
    );
  }

  if (resource.$$type !== 'ploykit.resource') {
    addError(
      diagnostics,
      'MODULE_RESOURCE_DSL_REQUIRED',
      `Resource "${resourceName}" must be created with resource(...).`,
      path
    );
  }

  validatePermissionList(diagnostics, resource.permissions, `${path}.permissions`);
  validateDeclaredPermissionList(
    diagnostics,
    resource.permissions,
    modulePermissions,
    `${path}.permissions`
  );
  validateSchemaReference(diagnostics, resource.schema, `${path}.schema`, `Resource "${resourceName}" schema`);

  if (!resource.storage?.table && !resource.storage?.document) {
    addError(
      diagnostics,
      'MODULE_RESOURCE_STORAGE_REQUIRED',
      `Resource "${resourceName}" must declare storage.table or storage.document.`,
      `${path}.storage`
    );
  }

  for (const authorityField of TENANT_AUTHORITY_FIELDS) {
    if (isSchemaDefinition(resource.schema) && authorityField in resource.schema.fields) {
      addError(
        diagnostics,
        'MODULE_TENANT_AUTHORITY_FIELD_FORBIDDEN',
        `Resource "${resourceName}" must not define "${authorityField}" as module-owned authority.`,
        `${path}.schema.fields.${authorityField}`,
        'Use Data v2 scope and ctx.scope instead.'
      );
    }
  }

  if ('pages' in resource) {
    addError(
      diagnostics,
      'MODULE_RESOURCE_PAGES_UNSUPPORTED',
      `Resource "${resourceName}" must not declare pages. Declare runtime pages in the top-level pages array.`,
      `${path}.pages`,
      'Move every resource page to top-level pages; resources only describe business schema and storage.'
    );
  }
}

export function validateCleanContract(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  const modulePermissions = new Set(definition.permissions ?? []);

  const unknownDefinition = definition as ModuleDefinition & { routes?: unknown };
  if (unknownDefinition.routes) {
    addError(
      diagnostics,
      'MODULE_CLEAN_ROUTES_UNSUPPORTED',
      'Modules must use pages/apis instead of routes.',
      'routes'
    );
  }

  const oldStaticResources = definition.resources as {
    locales?: unknown;
    icons?: unknown;
    assets?: unknown;
  } | undefined;
  if (oldStaticResources?.locales || oldStaticResources?.icons || oldStaticResources?.assets) {
    addError(
      diagnostics,
      'MODULE_CLEAN_STATIC_RESOURCES_MOVED',
      'Modules must declare locales, icons, and static assets under assets.',
      'resources',
      'Move static locales, icons, and asset declarations to assets.'
    );
  }

  for (const [resourceName, resource] of Object.entries(definition.resources ?? {})) {
    validateResource(
      diagnostics,
      resourceName,
      resource as ModuleResourceDefinition,
      `resources.${resourceName}`,
      modulePermissions
    );
  }

  for (const [index, page] of (definition.pages ?? []).entries()) {
    validatePage(diagnostics, page, `pages.${index}`, modulePermissions);
  }
  validatePagePathConflicts(diagnostics, definition.pages);

  for (const [index, api] of (definition.apis ?? []).entries()) {
    validateApiContract(diagnostics, api, `apis.${index}`, modulePermissions);
  }

  for (const [actionName, action] of Object.entries(definition.actions ?? {})) {
    validateSchemaReference(
      diagnostics,
      action.input,
      `actions.${actionName}.input`,
      `Action "${actionName}" input`
    );
  }
}
