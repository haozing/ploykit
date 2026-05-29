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
  routeSource: 'route' | 'publicAlias';
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

export interface ModulePageRouteErrorResult {
  ok: false;
  status: 401 | 403 | 404 | 500;
  code: string;
  message: string;
}

export type ResolveModulePageRouteResult =
  | ResolvedModulePageRouteResult
  | ModulePageRouteErrorResult;

function pageError(
  status: ModulePageRouteErrorResult['status'],
  code: string,
  message: string
): ModulePageRouteErrorResult {
  return { ok: false, status, code, message };
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

export async function resolveModulePageRoute(
  host: ModuleRuntimeHost,
  input: ResolveModulePageRouteInput
): Promise<ResolveModulePageRouteResult> {
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

  const componentLoader = resolveModuleEntryLoader(entry, 'pages', route.component);
  if (!componentLoader) {
    return pageError(500, 'MODULE_PAGE_COMPONENT_MISSING', 'Module page component is missing.');
  }

  const loader = route.loader ? resolveModuleEntryLoader(entry, 'loaders', route.loader) : null;
  if (route.loader && !loader) {
    return pageError(500, 'MODULE_PAGE_LOADER_MISSING', 'Module page loader is missing.');
  }

  const metadataLoader = route.metadata
    ? resolveModuleEntryLoader(entry, 'loaders', route.metadata)
    : null;
  if (route.metadata && !metadataLoader) {
    return pageError(500, 'MODULE_PAGE_METADATA_MISSING', 'Module page metadata is missing.');
  }

  try {
    const params = { ...match.params, ...input.params };
    const context = createContext(host, contract, route, input, match, params, user, accessSession);
    const component = await loadDefaultExport(componentLoader);
    const loaderData = await resolveOptionalRouteExport(loader, context);
    const metadata = await resolveOptionalRouteExport(metadataLoader, context);

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
  } catch {
    return pageError(500, 'MODULE_PAGE_HANDLER_ERROR', 'Module page route failed.');
  }
}
