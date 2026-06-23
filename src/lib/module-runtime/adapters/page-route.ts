import type { ModuleContext, ModulePageRoute, ModuleUser } from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import { createModuleRuntimeContext } from '../context';
import type { ModuleRuntimeHost } from '../host';
import { resolveModuleEntryLoader } from '../loader';
import { createRuntimeLogger } from '../observability/logger';
import {
  findModuleRouteMatch,
  type ModuleRuntimeRouteKind,
  type ModuleRuntimeRouteMatch,
} from '../routes';
import { checkModuleRuntimeAccess, type ModuleRuntimeAccessSession } from '../security';
import { readModuleDefaultExport } from './module-export';

export type ModulePageRouteKind = Exclude<ModuleRuntimeRouteKind, 'api'>;

export interface ResolveModulePageRouteInput {
  request: Request;
  kind: ModulePageRouteKind;
  pathname: string;
  user?: ModuleUser | null;
  session?: ModuleRuntimeAccessSession;
  params?: Record<string, string>;
  createContext?: (input: CreateModulePageContextInput) => ModuleContext;
  onTimingSpan?: (span: ModulePageRouteTimingSpan) => void;
}

export interface CreateModulePageContextInput {
  host: ModuleRuntimeHost;
  moduleId: string;
  route: ModulePageRoute;
  request: Request;
  user: ModuleUser | null;
  session: ModuleRuntimeAccessSession;
  params: Record<string, string>;
}

export interface ModulePageRouteTimingSpan {
  name: 'component' | 'loader' | 'metadata';
  moduleId: string;
  pathname: string;
  durationMs: number;
}

export interface ResolvedModulePageRoute {
  moduleId: string;
  kind: ModulePageRouteKind;
  route: ModulePageRoute;
  effectiveRoute: ResolvedModulePageEffectiveRoute;
  matchedPath: string;
  routeSource: 'route' | 'alias' | 'publicAlias';
  canonicalPath: string;
  params: Record<string, string>;
  contract: ModuleRuntimeContract;
  component: unknown;
  loaderData: unknown;
  metadata: unknown;
}

export interface ResolvedModulePageEffectiveRoute {
  loader?: string;
  metadata?: string;
  cache?: ModulePageRoute['cache'];
  selectedParams: readonly {
    kind: 'loader' | 'metadata' | 'cache';
    param: string;
    value: string;
    matched: boolean;
  }[];
}

export interface ResolvedModulePageRouteResult {
  ok: true;
  status: 200;
  page: ResolvedModulePageRoute;
}

export interface ResolvedModulePageRouteMetadata {
  moduleId: string;
  kind: ModulePageRouteKind;
  route: ModulePageRoute;
  effectiveRoute: ResolvedModulePageEffectiveRoute;
  matchedPath: string;
  routeSource: 'route' | 'alias' | 'publicAlias';
  canonicalPath: string;
  params: Record<string, string>;
  contract: ModuleRuntimeContract;
  metadata: unknown;
}

export interface ResolvedModulePageRouteMetadataResult {
  ok: true;
  status: 200;
  page: ResolvedModulePageRouteMetadata;
}

export interface ModulePageRouteErrorContext {
  moduleId: string;
  kind: ModulePageRouteKind;
  route: ModulePageRoute;
  effectiveRoute?: ResolvedModulePageEffectiveRoute;
  matchedPath: string;
  routeSource: 'route' | 'alias' | 'publicAlias';
  canonicalPath: string;
  params: Record<string, string>;
  contract: ModuleRuntimeContract;
  metadata?: unknown;
}

export interface ModulePageRouteErrorResult {
  ok: false;
  status: 401 | 403 | 404 | 500;
  code: string;
  message: string;
  routeContext?: ModulePageRouteErrorContext;
}

export type ResolveModulePageRouteResult =
  | ResolvedModulePageRouteResult
  | ModulePageRouteErrorResult;

export type ResolveModulePageRouteMetadataResult =
  | ResolvedModulePageRouteMetadataResult
  | ModulePageRouteErrorResult;

interface ResolvedModulePageRouteParts {
  match: ModuleRuntimeRouteMatch;
  route: ModulePageRoute;
  contract: ModuleRuntimeContract;
  params: Record<string, string>;
  accessSession: ModuleRuntimeAccessSession;
  user: ModuleUser | null;
}

function pageError(
  status: ModulePageRouteErrorResult['status'],
  code: string,
  message: string,
  routeContext?: ModulePageRouteErrorContext
): ModulePageRouteErrorResult {
  return routeContext
    ? { ok: false, status, code, message, routeContext }
    : { ok: false, status, code, message };
}

function isModulePageRouteErrorResult(
  value: ResolvedModulePageRouteParts | ModulePageRouteErrorResult
): value is ModulePageRouteErrorResult {
  return 'ok' in value && value.ok === false;
}

function moduleRouteContext(input: {
  match: ModuleRuntimeRouteMatch;
  kind: ModulePageRouteKind;
  route: ModulePageRoute;
  contract: ModuleRuntimeContract;
  params: Record<string, string>;
  metadata?: unknown;
  effectiveRoute?: ResolvedModulePageEffectiveRoute;
}): ModulePageRouteErrorContext {
  return {
    moduleId: input.match.entry.moduleId,
    kind: input.kind,
    route: input.route,
    effectiveRoute: input.effectiveRoute,
    matchedPath: input.match.entry.path,
    routeSource: input.match.entry.source,
    canonicalPath: input.match.entry.canonicalPath,
    params: input.params,
    contract: input.contract,
    metadata: input.metadata,
  };
}

function selectParamBranch<T>(
  selector: Readonly<Record<string, Readonly<Record<string, T>>>> | undefined,
  params: Record<string, string>,
  kind: 'loader' | 'metadata' | 'cache'
): { value?: T; selected?: ResolvedModulePageEffectiveRoute['selectedParams'][number] } {
  const [param, branches] = Object.entries(selector ?? {})[0] ?? [];
  if (!param || !branches) {
    return {};
  }
  const paramValue = params[param];
  const matched =
    paramValue !== undefined && Object.prototype.hasOwnProperty.call(branches, paramValue);
  return {
    value: matched ? branches[paramValue as string] : undefined,
    selected: {
      kind,
      param,
      value: paramValue ?? '',
      matched,
    },
  };
}

function selectedParamValueOrRouteDefault<T>(
  selected: { value?: T; selected?: ResolvedModulePageEffectiveRoute['selectedParams'][number] },
  routeDefault: T | undefined
): T | undefined {
  return selected.selected ? selected.value : routeDefault;
}

function resolveEffectiveRoute(
  route: ModulePageRoute,
  params: Record<string, string>
): ResolvedModulePageEffectiveRoute {
  const selectedParams: Array<ResolvedModulePageEffectiveRoute['selectedParams'][number]> = [];
  const loader = selectParamBranch(route.loaderByParam, params, 'loader');
  const metadata = selectParamBranch(route.metadataByParam, params, 'metadata');
  const cache = selectParamBranch(route.cacheByParam, params, 'cache');
  for (const selected of [loader.selected, metadata.selected, cache.selected]) {
    if (selected) {
      selectedParams.push(selected);
    }
  }
  return {
    loader: selectedParamValueOrRouteDefault(loader, route.loader),
    metadata: selectedParamValueOrRouteDefault(metadata, route.metadata),
    cache: selectedParamValueOrRouteDefault(cache, route.cache),
    selectedParams,
  };
}

function missingEffectiveRouteParamBranch(
  effectiveRoute: ResolvedModulePageEffectiveRoute
): ResolvedModulePageEffectiveRoute['selectedParams'][number] | undefined {
  return effectiveRoute.selectedParams.find((selected) => !selected.matched);
}

async function resolveErrorMetadata(
  metadataLoader: (() => Promise<unknown>) | null,
  context: ModuleContext
): Promise<unknown> {
  try {
    return await resolveOptionalRouteExport(metadataLoader, context);
  } catch (error) {
    logModulePageHandlerError(error);
    return undefined;
  }
}

const modulePageRouteLogger = createRuntimeLogger({
  sink(record) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[module-page-route]', record);
    }
  },
});

function errorMetadata(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { error };
}

function logModulePageHandlerError(error: unknown): void {
  modulePageRouteLogger.error('Module page route handler failed.', errorMetadata(error));
}

async function loadDefaultExport(loader: () => Promise<unknown>): Promise<unknown> {
  return readModuleDefaultExport(await loader());
}

async function resolveOptionalRouteExport(
  loader: (() => Promise<unknown>) | null,
  context: ModuleContext
): Promise<unknown> {
  if (!loader) {
    return null;
  }

  const exported = await loadDefaultExport(loader);
  return typeof exported === 'function'
    ? (exported as (ctx: ModuleContext) => unknown | Promise<unknown>)(context)
    : exported;
}

async function measurePageRouteTiming<T>(
  input: ResolveModulePageRouteInput,
  parts: Pick<ResolvedModulePageRouteParts, 'match'>,
  name: ModulePageRouteTimingSpan['name'],
  fn: () => Promise<T>
): Promise<T> {
  if (!input.onTimingSpan) {
    return fn();
  }

  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    input.onTimingSpan({
      name,
      moduleId: parts.match.entry.moduleId,
      pathname: input.pathname,
      durationMs: Date.now() - startedAt,
    });
  }
}

function createContext(
  host: ModuleRuntimeHost,
  contract: ModuleRuntimeContract,
  route: ModulePageRoute,
  input: ResolveModulePageRouteInput,
  match: ModuleRuntimeRouteMatch,
  params: Record<string, string>,
  user: ModuleUser | null,
  session: ModuleRuntimeAccessSession
): ModuleContext {
  return (
    input.createContext?.({
      host,
      moduleId: match.entry.moduleId,
      route,
      request: input.request,
      user,
      session,
      params,
    }) ??
    createModuleRuntimeContext({
      contract,
      request: input.request,
      user,
      params,
      data: host.createDataApi?.({
        contract,
        request: input.request,
        user,
        params,
        session,
      }),
      session,
    })
  );
}

function resolveModulePageRouteParts(
  host: ModuleRuntimeHost,
  input: ResolveModulePageRouteInput
): ResolvedModulePageRouteParts | ModulePageRouteErrorResult {
  const match = findModuleRouteMatch(host.routes, input.kind, input.pathname);
  if (!match) {
    return pageError(404, 'MODULE_PAGE_ROUTE_NOT_FOUND', 'Module page route was not found.');
  }

  const route = match.entry.route as ModulePageRoute;
  const accessSession = input.session ?? { user: input.user ?? null };
  const user = accessSession.user;

  const entry = host.getMapEntry(match.entry.moduleId);
  const contract = host.getContract(match.entry.moduleId);
  if (!entry || !contract) {
    return pageError(500, 'MODULE_PAGE_RUNTIME_ENTRY_MISSING', 'Module runtime entry is missing.');
  }

  const params = { ...match.params, ...input.params };
  const accessDenied = checkModuleRuntimeAccess({
    kind: 'page',
    contract,
    session: accessSession,
    auth: match.entry.auth,
    permissions: match.entry.permissions,
    commercial: route.commercial,
  });
  if (accessDenied) {
    return pageError(accessDenied.status, accessDenied.code, accessDenied.message);
  }

  return {
    match,
    route,
    contract,
    params,
    accessSession,
    user,
  };
}

export async function resolveModulePageRoute(
  host: ModuleRuntimeHost,
  input: ResolveModulePageRouteInput
): Promise<ResolveModulePageRouteResult> {
  const parts = resolveModulePageRouteParts(host, input);
  if (isModulePageRouteErrorResult(parts)) {
    return parts;
  }
  const { match, route, contract, params, accessSession, user } = parts;
  const effectiveRoute = resolveEffectiveRoute(route, params);
  const entry = host.getMapEntry(match.entry.moduleId);
  if (!entry) {
    return pageError(500, 'MODULE_PAGE_RUNTIME_ENTRY_MISSING', 'Module runtime entry is missing.');
  }
  const baseRouteContext = moduleRouteContext({
    match,
    kind: input.kind,
    route,
    contract,
    params,
    effectiveRoute,
  });

  const componentLoader = resolveModuleEntryLoader(entry, 'pages', route.component);
  const loader = effectiveRoute.loader
    ? resolveModuleEntryLoader(entry, 'loaders', effectiveRoute.loader)
    : null;
  const metadataLoader = effectiveRoute.metadata
    ? resolveModuleEntryLoader(entry, 'loaders', effectiveRoute.metadata)
    : null;
  const context = createContext(host, contract, route, input, match, params, user, accessSession);
  const missingParamBranch = missingEffectiveRouteParamBranch(effectiveRoute);
  if (missingParamBranch) {
    return pageError(
      404,
      'MODULE_PAGE_PARAM_BRANCH_NOT_FOUND',
      `Module page ${missingParamBranch.kind} branch is not declared for route parameter "${missingParamBranch.param}".`,
      baseRouteContext
    );
  }

  if (!componentLoader) {
    const metadata = await resolveErrorMetadata(metadataLoader, context);
    return pageError(
      500,
      'MODULE_PAGE_COMPONENT_MISSING',
      'Module page component is missing.',
      moduleRouteContext({
        match,
        kind: input.kind,
        route,
        effectiveRoute,
        contract,
        params,
        metadata,
      })
    );
  }

  if (effectiveRoute.loader && !loader) {
    const metadata = await resolveErrorMetadata(metadataLoader, context);
    return pageError(
      500,
      'MODULE_PAGE_LOADER_MISSING',
      'Module page loader is missing.',
      moduleRouteContext({
        match,
        kind: input.kind,
        route,
        effectiveRoute,
        contract,
        params,
        metadata,
      })
    );
  }

  if (effectiveRoute.metadata && !metadataLoader) {
    return pageError(
      500,
      'MODULE_PAGE_METADATA_MISSING',
      'Module page metadata is missing.',
      baseRouteContext
    );
  }

  let component: unknown;
  try {
    component = await measurePageRouteTiming(input, parts, 'component', () =>
      loadDefaultExport(componentLoader)
    );
  } catch (error) {
    logModulePageHandlerError(error);
    const metadata = await resolveErrorMetadata(metadataLoader, context);
    return pageError(
      500,
      'MODULE_PAGE_HANDLER_ERROR',
      'Module page route failed.',
      moduleRouteContext({
        match,
        kind: input.kind,
        route,
        effectiveRoute,
        contract,
        params,
        metadata,
      })
    );
  }

  let loaderData: unknown;
  try {
    loaderData = await measurePageRouteTiming(input, parts, 'loader', () =>
      resolveOptionalRouteExport(loader, context)
    );
  } catch (error) {
    logModulePageHandlerError(error);
    const metadata = await resolveErrorMetadata(metadataLoader, context);
    return pageError(
      500,
      'MODULE_PAGE_HANDLER_ERROR',
      'Module page route failed.',
      moduleRouteContext({
        match,
        kind: input.kind,
        route,
        effectiveRoute,
        contract,
        params,
        metadata,
      })
    );
  }

  let metadata: unknown;
  try {
    metadata = await measurePageRouteTiming(input, parts, 'metadata', () =>
      resolveOptionalRouteExport(metadataLoader, context)
    );
  } catch (error) {
    logModulePageHandlerError(error);
    return pageError(
      500,
      'MODULE_PAGE_HANDLER_ERROR',
      'Module page route failed.',
      moduleRouteContext({ match, kind: input.kind, route, effectiveRoute, contract, params })
    );
  }

  return {
    ok: true,
    status: 200,
    page: {
      moduleId: match.entry.moduleId,
      kind: input.kind,
      route,
      effectiveRoute,
      matchedPath: match.entry.path,
      routeSource: match.entry.source,
      canonicalPath: match.entry.canonicalPath,
      params,
      contract,
      component,
      loaderData,
      metadata,
    },
  };
}

export async function resolveModulePageRouteMetadata(
  host: ModuleRuntimeHost,
  input: ResolveModulePageRouteInput
): Promise<ResolveModulePageRouteMetadataResult> {
  const parts = resolveModulePageRouteParts(host, input);
  if (isModulePageRouteErrorResult(parts)) {
    return parts;
  }
  const { match, route, contract, params, accessSession, user } = parts;
  const effectiveRoute = resolveEffectiveRoute(route, params);
  const entry = host.getMapEntry(match.entry.moduleId);
  if (!entry) {
    return pageError(500, 'MODULE_PAGE_RUNTIME_ENTRY_MISSING', 'Module runtime entry is missing.');
  }
  const metadataLoader = effectiveRoute.metadata
    ? resolveModuleEntryLoader(entry, 'loaders', effectiveRoute.metadata)
    : null;
  const missingParamBranch = missingEffectiveRouteParamBranch(effectiveRoute);
  if (missingParamBranch) {
    return pageError(
      404,
      'MODULE_PAGE_PARAM_BRANCH_NOT_FOUND',
      `Module page ${missingParamBranch.kind} branch is not declared for route parameter "${missingParamBranch.param}".`,
      moduleRouteContext({ match, kind: input.kind, route, effectiveRoute, contract, params })
    );
  }
  if (effectiveRoute.metadata && !metadataLoader) {
    return pageError(
      500,
      'MODULE_PAGE_METADATA_MISSING',
      'Module page metadata is missing.',
      moduleRouteContext({ match, kind: input.kind, route, effectiveRoute, contract, params })
    );
  }

  const context = createContext(host, contract, route, input, match, params, user, accessSession);
  let metadata: unknown;
  try {
    metadata = await measurePageRouteTiming(input, parts, 'metadata', () =>
      resolveOptionalRouteExport(metadataLoader, context)
    );
  } catch (error) {
    logModulePageHandlerError(error);
    return pageError(
      500,
      'MODULE_PAGE_HANDLER_ERROR',
      'Module page route failed.',
      moduleRouteContext({ match, kind: input.kind, route, effectiveRoute, contract, params })
    );
  }

  return {
    ok: true,
    status: 200,
    page: {
      moduleId: match.entry.moduleId,
      kind: input.kind,
      route,
      effectiveRoute,
      matchedPath: match.entry.path,
      routeSource: match.entry.source,
      canonicalPath: match.entry.canonicalPath,
      params,
      contract,
      metadata,
    },
  };
}
