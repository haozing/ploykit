import type { ModuleContext, ModulePageRoute, ModuleUser } from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import { createModuleRuntimeContext } from '../context';
import type { ModuleRuntimeHost } from '../host';
import { resolveModuleEntryLoader } from '../loader';
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

export interface ResolvedModulePageRoute {
  moduleId: string;
  kind: ModulePageRouteKind;
  route: ModulePageRoute;
  matchedPath: string;
  routeSource: 'route' | 'alias' | 'publicAlias';
  canonicalPath: string;
  params: Record<string, string>;
  contract: ModuleRuntimeContract;
  component: unknown;
  loaderData: unknown;
  metadata: unknown;
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
}): ModulePageRouteErrorContext {
  return {
    moduleId: input.match.entry.moduleId,
    kind: input.kind,
    route: input.route,
    matchedPath: input.match.entry.path,
    routeSource: input.match.entry.source,
    canonicalPath: input.match.entry.canonicalPath,
    params: input.params,
    contract: input.contract,
    metadata: input.metadata,
  };
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

function logModulePageHandlerError(error: unknown): void {
  if (process.env.NODE_ENV !== 'production') {
    console.error('[module-page-route] handler failed', error);
  }
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
  });

  const componentLoader = resolveModuleEntryLoader(entry, 'pages', route.component);
  const loader = route.loader ? resolveModuleEntryLoader(entry, 'loaders', route.loader) : null;
  const metadataLoader = route.metadata
    ? resolveModuleEntryLoader(entry, 'loaders', route.metadata)
    : null;
  const context = createContext(host, contract, route, input, match, params, user, accessSession);

  if (!componentLoader) {
    const metadata = await resolveErrorMetadata(metadataLoader, context);
    return pageError(
      500,
      'MODULE_PAGE_COMPONENT_MISSING',
      'Module page component is missing.',
      moduleRouteContext({ match, kind: input.kind, route, contract, params, metadata })
    );
  }

  if (route.loader && !loader) {
    const metadata = await resolveErrorMetadata(metadataLoader, context);
    return pageError(
      500,
      'MODULE_PAGE_LOADER_MISSING',
      'Module page loader is missing.',
      moduleRouteContext({ match, kind: input.kind, route, contract, params, metadata })
    );
  }

  if (route.metadata && !metadataLoader) {
    return pageError(
      500,
      'MODULE_PAGE_METADATA_MISSING',
      'Module page metadata is missing.',
      baseRouteContext
    );
  }

  let component: unknown;
  try {
    component = await loadDefaultExport(componentLoader);
  } catch (error) {
    logModulePageHandlerError(error);
    const metadata = await resolveErrorMetadata(metadataLoader, context);
    return pageError(
      500,
      'MODULE_PAGE_HANDLER_ERROR',
      'Module page route failed.',
      moduleRouteContext({ match, kind: input.kind, route, contract, params, metadata })
    );
  }

  let loaderData: unknown;
  try {
    loaderData = await resolveOptionalRouteExport(loader, context);
  } catch (error) {
    logModulePageHandlerError(error);
    const metadata = await resolveErrorMetadata(metadataLoader, context);
    return pageError(
      500,
      'MODULE_PAGE_HANDLER_ERROR',
      'Module page route failed.',
      moduleRouteContext({ match, kind: input.kind, route, contract, params, metadata })
    );
  }

  let metadata: unknown;
  try {
    metadata = await resolveOptionalRouteExport(metadataLoader, context);
  } catch (error) {
    logModulePageHandlerError(error);
    return pageError(
      500,
      'MODULE_PAGE_HANDLER_ERROR',
      'Module page route failed.',
      moduleRouteContext({ match, kind: input.kind, route, contract, params })
    );
  }

  return {
    ok: true,
    status: 200,
    page: {
      moduleId: match.entry.moduleId,
      kind: input.kind,
      route,
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
  const entry = host.getMapEntry(match.entry.moduleId);
  if (!entry) {
    return pageError(500, 'MODULE_PAGE_RUNTIME_ENTRY_MISSING', 'Module runtime entry is missing.');
  }
  const metadataLoader = route.metadata
    ? resolveModuleEntryLoader(entry, 'loaders', route.metadata)
    : null;
  if (route.metadata && !metadataLoader) {
    return pageError(
      500,
      'MODULE_PAGE_METADATA_MISSING',
      'Module page metadata is missing.',
      moduleRouteContext({ match, kind: input.kind, route, contract, params })
    );
  }

  const context = createContext(host, contract, route, input, match, params, user, accessSession);
  let metadata: unknown;
  try {
    metadata = await resolveOptionalRouteExport(metadataLoader, context);
  } catch (error) {
    logModulePageHandlerError(error);
    return pageError(
      500,
      'MODULE_PAGE_HANDLER_ERROR',
      'Module page route failed.',
      moduleRouteContext({ match, kind: input.kind, route, contract, params })
    );
  }

  return {
    ok: true,
    status: 200,
    page: {
      moduleId: match.entry.moduleId,
      kind: input.kind,
      route,
      matchedPath: match.entry.path,
      routeSource: match.entry.source,
      canonicalPath: match.entry.canonicalPath,
      params,
      contract,
      metadata,
    },
  };
}
