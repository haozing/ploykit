import type { ModuleDataDefinition, ModuleDataScope } from './data';
import type { ModuleContext } from './context';
import type { PermissionValue } from './permissions';
import type { ModuleI18nDefinition, ModulePresentationDefinition } from './presentation';

export type ModuleRouteAuth = 'public' | 'auth' | 'admin';
export type ModuleHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type ModuleSurfaceMode = 'append' | 'prepend' | 'replace' | 'panel' | 'action';
export type ModuleWorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
export type ModuleProfile = 'app' | 'ai-tool' | 'digital-commerce' | 'cms';
export type ModuleCapability =
  | 'files'
  | 'async'
  | 'events'
  | 'notifications'
  | 'ai'
  | 'rag'
  | 'services'
  | 'commercial';
export type ModuleActionSideEffect =
  | 'none'
  | 'read'
  | 'write'
  | 'external'
  | 'billing'
  | 'destructive';
export type ModuleSurfaceVisibility =
  | 'always'
  | 'authenticated'
  | 'admin'
  | 'permission'
  | 'feature';

export interface ModuleCommercialRequirement {
  entitlements?: readonly string[];
  plans?: readonly string[];
  meter?: string;
  credits?: {
    amount: number;
    unit?: string;
  };
}

export interface ModuleScopeDefinition {
  required?: boolean;
  resource?: 'user' | 'workspace' | 'product';
}

export interface ModuleCommercialDefinition {
  meters?: Record<string, ModuleMeterDefinition>;
  entitlements?: readonly string[];
}

export interface ModuleRouteBase {
  path: string;
  auth?: ModuleRouteAuth;
  permissions?: readonly PermissionValue[];
  commercial?: ModuleCommercialRequirement;
}

export interface ModulePageRoute extends ModuleRouteBase {
  component: string;
  frame?: ModulePageFrame | (string & {});
  loader?: string;
  loaderByParam?: ModulePageRouteParamLoaderMap;
  metadata?: string;
  metadataByParam?: ModulePageRouteParamLoaderMap;
  metadataResult?: {
    type?: 'page';
    required?: readonly ('title' | 'description' | 'canonical' | 'sitemap' | 'openGraph')[];
    i18nNamespaces?: readonly string[];
  };
  aliases?: readonly string[];
  publicAliases?: readonly string[];
  cache?: ModulePageRouteCacheDefinition;
  cacheByParam?: ModulePageRouteParamCacheMap;
}

export interface ModulePageRouteCacheDefinition {
  strategy: 'none' | 'public' | 'private';
  revalidateSeconds?: number;
  tags?: readonly string[];
}

export type ModulePageRouteParamLoaderMap = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

export type ModulePageRouteParamCacheMap = Readonly<
  Record<string, Readonly<Record<string, ModulePageRouteCacheDefinition>>>
>;

export interface ModuleApiRoute extends ModuleRouteBase {
  handler: string;
  methods?: readonly ModuleHttpMethod[];
  machineAuth?: 'apiKey' | 'user-or-apiKey';
  idempotency?: {
    required?: boolean;
    keyFrom?: 'request';
  };
  anonymousPolicy?: {
    rateLimit?: {
      bucket: 'ip' | 'userAgent' | 'route' | 'module' | 'method' | readonly string[];
      limit: number;
      window: string;
    };
    allowHighCostActions?: boolean;
    maxUploadBytes?: number;
    captcha?: 'never' | 'auto' | 'always';
  };
}

export type ModuleSchemaPrimitive =
  | 'string'
  | 'text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'json'
  | 'uuid';

export interface ModuleSchemaFieldDefinition {
  type: ModuleSchemaPrimitive;
  required?: boolean;
  array?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  enum?: readonly string[];
  description?: string;
  default?: unknown;
}

export interface ModuleSchemaDefinition {
  $$type: 'ploykit.schema';
  name?: string;
  description?: string;
  fields: Record<string, ModuleSchemaFieldDefinition>;
}

export type ModuleSchemaReference = string | ModuleSchemaDefinition;

export interface ModuleActionDefinition {
  handler: string;
  auth?: ModuleRouteAuth;
  permissions?: readonly PermissionValue[];
  commercial?: ModuleCommercialRequirement;
  input?: ModuleSchemaReference;
  output?: ModuleSchemaReference;
  timeoutMs?: number;
  sideEffect?: ModuleActionSideEffect;
  confirmation?: {
    required?: boolean;
    messageKey?: string;
    fallbackMessage?: string;
    confirmText?: string;
  };
  idempotency?: {
    required?: boolean;
    keyFrom?: 'request' | 'user' | 'scope' | 'input';
  };
}

export type ModuleActionHandler<TContext = ModuleContext, TInput = unknown, TResult = unknown> = (
  ctx: TContext,
  input: TInput
) => TResult | Promise<TResult>;

export interface ModuleActionRuntimeDefinition<
  TContext = ModuleContext,
  TInput = unknown,
  TResult = unknown,
> {
  run: ModuleActionHandler<TContext, TInput, TResult>;
}

export interface ModuleActionDefinitionMarker {
  readonly type: 'ploykit.action';
  readonly sdkVersion: '0.1.0';
}

export type DefinedAction<
  TDefinition extends ModuleActionRuntimeDefinition<any, any, any> = ModuleActionRuntimeDefinition,
> = Readonly<TDefinition> & {
  readonly $$ploykit: ModuleActionDefinitionMarker;
};

export type ModulePageArea = 'site' | 'dashboard' | 'admin';
export type ModulePageFrame = 'public' | 'site' | 'dashboard' | 'workspace' | 'admin' | 'none';

export interface ModulePageDefinition extends ModuleRouteBase {
  $$type?: 'ploykit.page';
  id: string;
  area: ModulePageArea;
  frame: ModulePageFrame | (string & {});
  component: string;
  loader?: string;
  loaderByParam?: ModulePageRouteParamLoaderMap;
  metadata?: string;
  metadataByParam?: ModulePageRouteParamLoaderMap;
  metadataResult?: ModulePageRoute['metadataResult'];
  aliases?: readonly string[];
  publicAliases?: readonly string[];
  cache?: ModulePageRouteCacheDefinition;
  cacheByParam?: ModulePageRouteParamCacheMap;
}

export interface ModuleApiDefinitionContract extends ModuleApiRoute {
  $$type?: 'ploykit.api-route';
  id: string;
  input: ModuleSchemaReference;
  output: ModuleSchemaReference;
}

export interface ModuleNavigationItem {
  location: 'site.header' | 'site.footer' | 'dashboard.sidebar' | 'admin.sidebar';
  labelKey?: string;
  fallbackLabel: string;
  groupKey?: string;
  fallbackGroup?: string;
  icon?: string;
  path: string;
  weight?: number;
  requires?: {
    scopeRoles?: readonly ModuleWorkspaceRole[];
    entitlements?: readonly string[];
    serviceConnections?: readonly string[];
  };
}

export interface ModuleSurfaceDefinition {
  mode?: ModuleSurfaceMode;
  component: string;
  loader?: string;
  priority?: number;
  permissions?: readonly PermissionValue[];
  commercial?: ModuleCommercialRequirement;
  placement?: {
    surfaceId?: string;
    area?: 'site' | 'auth' | 'dashboard' | 'admin' | 'dev';
    slot?: string;
    responsive?: 'inline' | 'stack' | 'drawer' | 'modal';
  };
  fallback?: {
    behavior?: 'hide' | 'host' | 'placeholder';
    messageKey?: string;
    fallbackMessage?: string;
  };
  visibility?: {
    mode?: ModuleSurfaceVisibility;
    permission?: PermissionValue;
    feature?: string;
  };
}

export interface ModuleAssetsDefinition {
  locales?: Record<string, string>;
  icons?: Record<
    string,
    | {
        kind: 'lucide';
        name?: string;
      }
    | {
        kind: 'svg';
        path: string;
      }
  >;
  assets?: readonly {
    path: string;
    kind?: 'asset' | 'worker' | 'wasm';
    contentType?: string;
    maxBytes?: number;
  }[];
}

export interface ModuleResourceStorageDefinition {
  table?: string;
  document?: string;
}

export interface ModuleResourceDefinition {
  $$type?: 'ploykit.resource';
  scope: ModuleDataScope;
  schema: ModuleSchemaReference;
  storage?: ModuleResourceStorageDefinition;
  permissions?: readonly PermissionValue[];
}

export interface ModuleMeterDefinition {
  unit?: string;
  description?: string;
  aggregation?: 'sum' | 'count' | 'max';
}

export interface ModuleServiceRetryPolicy {
  attempts?: number;
  backoff?: 'none' | 'linear' | 'exponential';
  retryOn?: readonly number[];
}

export interface ModuleServiceConnectionPolicy {
  baseUrl?: string;
  egress?: readonly string[];
  pathPrefix?: string;
  timeoutMs?: number;
  retry?: ModuleServiceRetryPolicy;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  redirect?: 'manual';
}

export interface ModuleServiceSecretDefinition {
  required?: boolean;
  description?: string;
}

export interface ModuleServiceOperationInputPolicy {
  allow?: readonly string[];
  claimsAllow?: readonly string[];
}

export interface ModuleServiceOperationAuthPolicy {
  type: 'none' | 'bearer';
  secret?: string;
  header?: string;
}

export interface ModuleServiceOperationSigningPolicy {
  type: 'none' | 'hmac-sha256';
  secret?: string;
  header?: string;
  timestampHeader?: string;
  claimsHeader?: string;
  canonical?: readonly string[];
  timestampToleranceSeconds?: number;
}

export interface ModuleServiceOperationRequestPolicy {
  body?: 'none' | 'json' | 'text';
  allowHeaders?: readonly string[];
  denyHeaders?: readonly string[];
}

export interface ModuleServiceOperationResponsePolicy {
  body?: 'json' | 'text' | 'raw';
  maxBytes?: number;
}

export interface ModuleServiceOperationAuditPolicy {
  event?: string;
  includeClaims?: readonly string[];
}

export interface ModuleServiceOperationRedactionPolicy {
  request?: readonly string[];
  response?: readonly string[];
  error?: readonly string[];
}

export interface ModuleServiceOperationDefinition {
  method?: ModuleHttpMethod;
  path?: string;
  input?: ModuleServiceOperationInputPolicy;
  auth?: ModuleServiceOperationAuthPolicy;
  signing?: ModuleServiceOperationSigningPolicy;
  request?: ModuleServiceOperationRequestPolicy;
  response?: ModuleServiceOperationResponsePolicy;
  audit?: ModuleServiceOperationAuditPolicy;
  redaction?: ModuleServiceOperationRedactionPolicy;
}

export interface ModuleServiceRequirementDefinition {
  required?: boolean;
  provider?: string;
  description?: string;
  kind?: 'signed-http';
  connection?: ModuleServiceConnectionPolicy;
  secrets?: Record<string, ModuleServiceSecretDefinition>;
  claims?: Record<string, string>;
  operations?: Record<string, ModuleServiceOperationDefinition>;
}

export interface ModuleJobDefinition {
  handler: string;
  schedule?: string;
  timeoutMs?: number;
  retries?: number;
}

export interface ModuleEventsDefinition {
  publishes?: readonly string[];
  subscribes?: Record<string, string>;
}

export interface ModuleWebhookDefinition {
  path: string;
  handler: string;
  methods?: readonly ModuleHttpMethod[];
  signature?: 'none' | 'hmac-sha256' | 'stripe' | 'github';
}

export interface ModuleDefinition {
  id: string;
  name: string;
  version: string;
  description?: string;
  profile: ModuleProfile;
  capabilities?: readonly ModuleCapability[];
  permissions?: readonly PermissionValue[];
  scope?: ModuleScopeDefinition;
  data?: ModuleDataDefinition;
  pages?: readonly ModulePageDefinition[];
  apis?: readonly ModuleApiDefinitionContract[];
  navigation?: ModuleNavigationItem | readonly ModuleNavigationItem[];
  surfaces?: Record<string, ModuleSurfaceDefinition>;
  assets?: ModuleAssetsDefinition;
  resources?: Record<string, ModuleResourceDefinition>;
  i18n?: ModuleI18nDefinition;
  serviceRequirements?: Record<string, ModuleServiceRequirementDefinition>;
  actions?: Record<string, ModuleActionDefinition>;
  jobs?: Record<string, ModuleJobDefinition>;
  events?: ModuleEventsDefinition;
  webhooks?: Record<string, ModuleWebhookDefinition>;
  commercial?: ModuleCommercialDefinition;
}

export interface ModuleDefinitionMarker {
  readonly type: 'ploykit.module';
  readonly sdkVersion: '0.1.0';
}

export type DefinedModule<TDefinition extends object = ModuleDefinition> =
  Readonly<TDefinition> & {
    readonly $$ploykit: ModuleDefinitionMarker;
  };

export type ModuleApiHandler<TContext = ModuleContext> = (
  ctx: TContext
) => Response | Promise<Response>;

export type ModuleApiDefinition<TContext = ModuleContext> = Partial<
  Record<'get' | 'post' | 'put' | 'patch' | 'delete', ModuleApiHandler<TContext>>
>;

export interface ModuleApiDefinitionMarker {
  readonly type: 'ploykit.api';
  readonly sdkVersion: '0.1.0';
}

export type DefinedApi<TDefinition extends ModuleApiDefinition = ModuleApiDefinition> =
  Readonly<TDefinition> & {
    readonly $$ploykit: ModuleApiDefinitionMarker;
  };
