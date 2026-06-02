import type {
  ModuleApiDefinition,
  ModuleApiRoute,
  ModuleContext,
  ModuleUser,
} from '@ploykit/module-sdk';
import { createModuleRuntimeContext } from '../context';
import { resolveModuleEntryLoader } from '../loader';
import { findModuleRouteMatch } from '../routes';
import type { ModuleRuntimeHost } from '../host';
import {
  checkModuleRuntimeAccess,
  mergeModuleRuntimeAccessSession,
  type ModuleRuntimeAccessSession,
} from '../security';
import { checkModuleAnonymousPolicy } from '../security/anonymous-policy';
import { asModuleApiDefinition } from './module-export';

export interface DispatchModuleApiRouteInput {
  request: Request;
  pathname: string;
  user?: ModuleUser | null;
  session?: ModuleRuntimeAccessSession;
  params?: Record<string, string>;
  verifyApiKey?: VerifyModuleApiKeyHandler;
  createContext?: (input: CreateModuleApiContextInput) => ModuleContext;
}

export interface VerifyModuleApiKeyInput {
  host: ModuleRuntimeHost;
  moduleId: string;
  route: ModuleApiRoute;
  request: Request;
  params: Record<string, string>;
  apiKey: string;
  session?: ModuleRuntimeAccessSession;
}

export type VerifyModuleApiKeyResult =
  | {
      ok: true;
      user?: ModuleUser | null;
      session?: Partial<ModuleRuntimeAccessSession>;
    }
  | {
      ok: false;
      status?: 401 | 403;
      code?: string;
      message?: string;
    };

export type VerifyModuleApiKeyHandler = (
  input: VerifyModuleApiKeyInput
) => VerifyModuleApiKeyResult | Promise<VerifyModuleApiKeyResult>;

export interface CreateModuleApiContextInput {
  host: ModuleRuntimeHost;
  moduleId: string;
  route: ModuleApiRoute;
  request: Request;
  user: ModuleUser | null;
  session: ModuleRuntimeAccessSession;
  params: Record<string, string>;
}

function methodName(method: string): keyof ModuleApiDefinition {
  return method.toLowerCase() as keyof ModuleApiDefinition;
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, code, message }, { status });
}

function routeAllowsMethod(route: ModuleApiRoute, method: string): boolean {
  const targetMethod = method.toUpperCase();
  return (route.methods ?? ['GET']).some((candidate) => candidate === targetMethod);
}

function readApiKey(request: Request): string | null {
  const explicit = request.headers.get('x-api-key')?.trim();
  if (explicit) {
    return explicit;
  }

  const authorization = request.headers.get('authorization')?.trim();
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  return bearer || null;
}

async function verifyMachineAuth(
  host: ModuleRuntimeHost,
  route: ModuleApiRoute,
  input: DispatchModuleApiRouteInput,
  moduleId: string,
  params: Record<string, string>
): Promise<Response | { user: ModuleUser | null; session?: Partial<ModuleRuntimeAccessSession> }> {
  if (!route.machineAuth) {
    return { user: input.session?.user ?? input.user ?? null };
  }

  if (
    route.machineAuth === 'user-or-apiKey' &&
    (input.session?.user || input.session?.userId || input.user)
  ) {
    return { user: input.session?.user ?? input.user ?? null, session: input.session };
  }

  const apiKey = readApiKey(input.request);
  if (!apiKey) {
    return jsonError(401, 'MODULE_API_KEY_REQUIRED', 'API key is required.');
  }

  if (!input.verifyApiKey) {
    return jsonError(401, 'MODULE_API_KEY_VERIFIER_MISSING', 'API key verifier is not configured.');
  }

  const result = await input.verifyApiKey({
    host,
    moduleId,
    route,
    request: input.request,
    params,
    apiKey,
    session: input.session,
  });

  if (!result.ok) {
    return jsonError(
      result.status ?? 401,
      result.code ?? 'MODULE_API_KEY_UNAUTHORIZED',
      result.message ?? 'API key is not authorized.'
    );
  }

  return {
    user: result.session?.user ?? result.user ?? input.session?.user ?? input.user ?? null,
    session: {
      authKind: 'apiKey',
      ...result.session,
    },
  };
}

export async function dispatchModuleApiRoute(
  host: ModuleRuntimeHost,
  input: DispatchModuleApiRouteInput
): Promise<Response> {
  const match = findModuleRouteMatch(host.routes, 'api', input.pathname);
  if (!match) {
    return jsonError(404, 'MODULE_API_ROUTE_NOT_FOUND', 'Module API route was not found.');
  }

  const route = match.entry.route as ModuleApiRoute;
  const params = { ...match.params, ...input.params };
  const machineAuthResult = await verifyMachineAuth(
    host,
    route,
    input,
    match.entry.moduleId,
    params
  );
  if (machineAuthResult instanceof Response) {
    return machineAuthResult;
  }

  const accessSession = mergeModuleRuntimeAccessSession(
    input.session ?? { user: input.user ?? null },
    {
      ...machineAuthResult.session,
      user: machineAuthResult.user,
    }
  );
  const user = accessSession.user;
  if (!routeAllowsMethod(route, input.request.method)) {
    return jsonError(405, 'MODULE_API_METHOD_NOT_ALLOWED', 'HTTP method is not allowed.');
  }

  const anonymousPolicyDenied = checkModuleAnonymousPolicy({
    moduleId: match.entry.moduleId,
    route,
    request: input.request,
    userId: accessSession.userId ?? accessSession.user?.id ?? null,
    anonymous: !accessSession.user && !accessSession.userId,
  });
  if (anonymousPolicyDenied) {
    return anonymousPolicyDenied;
  }

  const entry = host.getMapEntry(match.entry.moduleId);
  const contract = host.getContract(match.entry.moduleId);
  if (!entry || !contract) {
    return jsonError(500, 'MODULE_API_RUNTIME_ENTRY_MISSING', 'Module runtime entry is missing.');
  }

  const accessDenied = checkModuleRuntimeAccess({
    kind: 'api',
    contract,
    session: accessSession,
    auth: match.entry.auth,
    permissions: match.entry.permissions,
    commercial: route.commercial,
  });
  if (accessDenied) {
    return jsonError(accessDenied.status, accessDenied.code, accessDenied.message);
  }

  const loader = resolveModuleEntryLoader(entry, 'apis', route.handler);
  if (!loader) {
    return jsonError(
      500,
      'MODULE_API_HANDLER_MISSING',
      'Module API handler is missing from module map.'
    );
  }

  const api = asModuleApiDefinition(await loader());
  if (!api) {
    return jsonError(500, 'MODULE_API_INVALID_EXPORT', 'Module API handler export is invalid.');
  }

  const handler = api?.[methodName(input.request.method)];
  if (!handler) {
    return jsonError(
      405,
      'MODULE_API_HANDLER_METHOD_MISSING',
      'Module API method handler is missing.'
    );
  }

  const context =
    input.createContext?.({
      host,
      moduleId: match.entry.moduleId,
      route,
      request: input.request,
      user,
      session: accessSession,
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
        session: accessSession,
      }),
      session: accessSession,
    });

  try {
    return await handler(context);
  } catch {
    return jsonError(500, 'MODULE_API_HANDLER_ERROR', 'Module API handler failed.');
  }
}
