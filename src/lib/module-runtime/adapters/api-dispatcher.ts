import type {
  ModuleApiDefinition,
  ModuleApiRoute,
  ModuleContext,
  ModuleUser,
} from '@ploykit/module-sdk';
import { createHash } from 'node:crypto';
import { createModuleRuntimeContext } from '../context';
import { resolveModuleEntryLoader } from '../loader';
import { findModuleRouteMatch } from '../routes';
import type { ModuleRuntimeHost } from '../host';
import type { RuntimeStore } from '../stores/runtime-store-types';
import {
  checkModuleRuntimeAccess,
  mergeModuleRuntimeAccessSession,
  type ModuleRuntimeAccessSession,
} from '../security';
import { checkModuleAnonymousPolicy } from '../security/anonymous-policy';
import { createRuntimeLogger } from '../observability/logger';
import { asModuleApiDefinition } from './module-export';

export interface DispatchModuleApiRouteInput {
  request: Request;
  pathname: string;
  user?: ModuleUser | null;
  session?: ModuleRuntimeAccessSession;
  params?: Record<string, string>;
  verifyApiKey?: VerifyModuleApiKeyHandler;
  runtimeStore?: RuntimeStore;
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
  const body = JSON.stringify({ ok: false, code, message });
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json',
      'content-length': String(new TextEncoder().encode(body).byteLength),
    },
  });
}

const moduleApiRouteLogger = createRuntimeLogger({
  sink(record) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[module-api-route]', record);
    }
  },
});

function errorMetadata(error: unknown): Record<string, unknown> {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { error };
}

function logModuleApiHandlerError(error: unknown): void {
  moduleApiRouteLogger.error('Module API handler failed.', errorMetadata(error));
}

interface ModuleApiTimingSpan {
  name: string;
  durationMs: number;
}

function createRequestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now().toString(36)}`;
}

function requestIdFor(request: Request): string {
  return request.headers.get('x-request-id') ?? createRequestId();
}

function timingName(name: string): string {
  return name.replace(/[^A-Za-z0-9!#$%&'*+.^_`|~-]+/g, '-') || 'span';
}

function timingDuration(durationMs: number): string {
  const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  return Number.isInteger(duration) ? String(duration) : duration.toFixed(1);
}

async function measureApiTiming<T>(
  spans: ModuleApiTimingSpan[],
  name: string,
  fn: () => Promise<T> | T
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await fn();
  } finally {
    spans.push({ name, durationMs: Date.now() - startedAt });
  }
}

function responseBodyBytes(response: Response): number | null {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const value = Number(contentLength);
    if (Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return response.body === null ? 0 : null;
}

function withModuleApiDiagnostics(
  response: Response,
  input: {
    request: Request;
    requestId: string;
    startedAt: number;
    spans: readonly ModuleApiTimingSpan[];
    moduleId?: string;
    routePath?: string;
    matchedPath?: string;
  }
): Response {
  const totalMs = Date.now() - input.startedAt;
  const headers = new Headers(response.headers);
  const serverTiming = [
    ...input.spans.map(
      (span) => `${timingName(span.name)};dur=${timingDuration(span.durationMs)}`
    ),
    `module-api-total;dur=${timingDuration(totalMs)}`,
  ].join(', ');
  const existingServerTiming = headers.get('server-timing');
  headers.set(
    'server-timing',
    existingServerTiming ? `${existingServerTiming}, ${serverTiming}` : serverTiming
  );

  const responseBytes = responseBodyBytes(response);
  headers.set('x-request-id', input.requestId);
  headers.set('x-ploykit-request-id', input.requestId);
  if (input.moduleId) {
    headers.set('x-ploykit-module-id', input.moduleId);
  }
  if (input.routePath) {
    headers.set('x-ploykit-route-path', input.routePath);
  }
  if (input.matchedPath) {
    headers.set('x-ploykit-matched-path', input.matchedPath);
  }
  headers.set('x-ploykit-response-bytes', responseBytes === null ? 'unknown' : String(responseBytes));

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function readIdempotencyKey(request: Request): string | undefined {
  return (
    request.headers.get('idempotency-key')?.trim() ||
    request.headers.get('x-idempotency-key')?.trim() ||
    request.headers.get('x-ploykit-idempotency-key')?.trim() ||
    undefined
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return item;
    }
    return Object.keys(item as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (item as Record<string, unknown>)[key];
        return acc;
      }, {});
  });
}

async function apiRequestHash(input: {
  request: Request;
  moduleId: string;
  route: ModuleApiRoute;
  params: Record<string, string>;
}): Promise<string> {
  const body = Buffer.from(await input.request.clone().arrayBuffer()).toString('base64');
  const url = new URL(input.request.url);
  return `sha256:${createHash('sha256')
    .update(
      stableStringify({
        moduleId: input.moduleId,
        route: input.route.path,
        method: input.request.method.toUpperCase(),
        search: url.search,
        params: input.params,
        body,
      })
    )
    .digest('hex')}`;
}

function responseHeadersRecord(response: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

async function responseBodyBase64(response: Response): Promise<string> {
  const body = await response.clone().arrayBuffer();
  return Buffer.from(body).toString('base64');
}

function responseFromIdempotencyRecord(record: {
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBodyBase64?: string;
}): Response {
  const headers = new Headers(record.responseHeaders ?? {});
  headers.set('x-ploykit-idempotency-replay', 'true');
  const body = record.responseBodyBase64
    ? Buffer.from(record.responseBodyBase64, 'base64')
    : null;
  return new Response(body, {
    status: record.responseStatus ?? 200,
    headers,
  });
}

function moduleApiIdempotencyScope(
  session: ModuleRuntimeAccessSession
): { productId: string; environmentId?: string | null; workspaceId?: string | null } | null {
  const productId = session.productId;
  if (!productId) {
    return null;
  }
  return {
    productId,
    environmentId: session.environmentId ?? null,
    workspaceId:
      session.workspaceId ??
      (session.subject?.type === 'workspace' ? session.subject.id : undefined) ??
      null,
  };
}

async function runWithApiIdempotency(input: {
  request: Request;
  moduleId: string;
  route: ModuleApiRoute;
  params: Record<string, string>;
  session: ModuleRuntimeAccessSession;
  store?: RuntimeStore;
  execute: () => Response | Promise<Response>;
}): Promise<Response> {
  if (!input.route.idempotency) {
    return input.execute();
  }

  const idempotencyKey = readIdempotencyKey(input.request);
  if (input.route.idempotency?.required && !idempotencyKey) {
    return jsonError(
      400,
      'MODULE_API_IDEMPOTENCY_KEY_REQUIRED',
      'Idempotency key is required for this API route.'
    );
  }
  if (!idempotencyKey) {
    return input.execute();
  }
  if (!input.store) {
    if (input.route.idempotency?.required) {
      return jsonError(
        500,
        'MODULE_API_IDEMPOTENCY_STORE_MISSING',
        'API idempotency store is not configured.'
      );
    }
    return input.execute();
  }
  const scope = moduleApiIdempotencyScope(input.session);
  if (!scope) {
    return jsonError(
      500,
      'MODULE_API_IDEMPOTENCY_SCOPE_MISSING',
      'API idempotency scope is not configured.'
    );
  }

  const begin = await input.store.beginIdempotencyKey({
    productId: scope.productId,
    environmentId: scope.environmentId,
    workspaceId: scope.workspaceId,
    namespace: `api:${input.moduleId}:${input.route.path}:${input.request.method.toUpperCase()}`,
    key: idempotencyKey,
    requestHash: await apiRequestHash(input),
    recoverLockedBefore: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    metadata: {
      route: 'module.api',
      moduleId: input.moduleId,
      routePath: input.route.path,
      method: input.request.method.toUpperCase(),
    },
  });

  if (begin.outcome === 'conflict') {
    return jsonError(
      400,
      'MODULE_API_IDEMPOTENCY_CONFLICT',
      'Idempotency key was already used with a different request payload.'
    );
  }
  if (begin.outcome === 'in_progress') {
    return jsonError(
      409,
      'MODULE_API_IDEMPOTENCY_IN_PROGRESS',
      'Original request is still in progress.'
    );
  }
  if (begin.outcome === 'replay') {
    return responseFromIdempotencyRecord(begin.record);
  }

  const response = await input.execute();
  try {
    await input.store.completeIdempotencyKey({
      id: begin.record.id,
      responseStatus: response.status,
      responseHeaders: responseHeadersRecord(response),
      responseBodyBase64: await responseBodyBase64(response),
    });
  } catch (error) {
    logModuleApiHandlerError(error);
  }
  return response;
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
  const startedAt = Date.now();
  const spans: ModuleApiTimingSpan[] = [];
  const requestId = requestIdFor(input.request);
  let moduleId: string | undefined;
  let routePath: string | undefined;
  let matchedPath: string | undefined;
  const finish = (response: Response) =>
    withModuleApiDiagnostics(response, {
      request: input.request,
      requestId,
      startedAt,
      spans,
      moduleId,
      routePath,
      matchedPath,
    });

  const match = await measureApiTiming(spans, 'module-api-match', () =>
    findModuleRouteMatch(host.routes, 'api', input.pathname)
  );
  if (!match) {
    return finish(jsonError(404, 'MODULE_API_ROUTE_NOT_FOUND', 'Module API route was not found.'));
  }

  const route = match.entry.route as ModuleApiRoute;
  moduleId = match.entry.moduleId;
  routePath = route.path;
  matchedPath = match.entry.path;
  const params = { ...match.params, ...input.params };
  const machineAuthResult = await measureApiTiming(spans, 'module-api-auth', () =>
    verifyMachineAuth(host, route, input, match.entry.moduleId, params)
  );
  if (machineAuthResult instanceof Response) {
    return finish(machineAuthResult);
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
    return finish(jsonError(405, 'MODULE_API_METHOD_NOT_ALLOWED', 'HTTP method is not allowed.'));
  }

  const anonymousPolicyDenied = await measureApiTiming(spans, 'module-api-access', () =>
    checkModuleAnonymousPolicy({
      moduleId: match.entry.moduleId,
      route,
      request: input.request,
      userId: accessSession.userId ?? accessSession.user?.id ?? null,
      anonymous: !accessSession.user && !accessSession.userId,
    })
  );
  if (anonymousPolicyDenied) {
    return finish(anonymousPolicyDenied);
  }

  const entry = host.getMapEntry(match.entry.moduleId);
  const contract = host.getContract(match.entry.moduleId);
  if (!entry || !contract) {
    return finish(
      jsonError(500, 'MODULE_API_RUNTIME_ENTRY_MISSING', 'Module runtime entry is missing.')
    );
  }

  const accessDenied = await measureApiTiming(spans, 'module-api-runtime-access', () =>
    checkModuleRuntimeAccess({
      kind: 'api',
      contract,
      session: accessSession,
      auth: match.entry.auth,
      permissions: match.entry.permissions,
      commercial: route.commercial,
    })
  );
  if (accessDenied) {
    return finish(jsonError(accessDenied.status, accessDenied.code, accessDenied.message));
  }

  const loader = resolveModuleEntryLoader(entry, 'apis', route.handler);
  if (!loader) {
    return finish(
      jsonError(
        500,
        'MODULE_API_HANDLER_MISSING',
        'Module API handler is missing from module map.'
      )
    );
  }

  const api = asModuleApiDefinition(
    await measureApiTiming(spans, 'module-api-handler-load', () => loader())
  );
  if (!api) {
    return finish(
      jsonError(500, 'MODULE_API_INVALID_EXPORT', 'Module API handler export is invalid.')
    );
  }

  const handler = api?.[methodName(input.request.method)];
  if (!handler) {
    return finish(
      jsonError(
        405,
        'MODULE_API_HANDLER_METHOD_MISSING',
        'Module API method handler is missing.'
      )
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
    const response = await measureApiTiming(spans, 'module-api-idempotency', () =>
      runWithApiIdempotency({
        request: input.request,
        moduleId: match.entry.moduleId,
        route,
        params,
        session: accessSession,
        store: input.runtimeStore,
        execute: () => measureApiTiming(spans, 'module-api-handler', () => handler(context)),
      })
    );
    return finish(response);
  } catch (error) {
    logModuleApiHandlerError(error);
    return finish(jsonError(500, 'MODULE_API_HANDLER_ERROR', 'Module API handler failed.'));
  }
}
