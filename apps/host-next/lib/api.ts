import { createHash } from 'node:crypto';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import { redactSensitive } from '@/lib/module-runtime/observability/redaction';
import { findAdminApiRegistryEntry } from './admin-route-registry';
import { resolveHostSessionFromRequest } from './auth';
import { defaultProductId } from './default-scope';
import { getHostRuntimeStore } from './runtime-store';
import { requireCapability } from './rbac';
import { checkHostRouteSecurity } from './security';

export interface ApiFailure {
  ok: false;
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiSuccess<T extends Record<string, unknown> = Record<string, unknown>> {
  ok: true;
  data: T;
}

export type ApiResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ApiSuccess<T>
  | ApiFailure;

export function apiOk<T extends Record<string, unknown>>(data: T, init?: ResponseInit): Response {
  return Response.json({ ok: true, data: redactSensitive(data) } satisfies ApiResult<T>, init);
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: unknown
): Response {
  return Response.json(
    {
      ok: false,
      code,
      message,
      ...(details === undefined ? {} : { details: redactSensitive(details) }),
    } satisfies ApiFailure,
    { status }
  );
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {};
  }
  const body = await request.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
}

export function stringBody(
  body: Record<string, unknown>,
  key: string,
  options: { required?: boolean; maxLength?: number } = {}
): string | undefined {
  const value = body[key];
  if (typeof value !== 'string') {
    if (options.required) {
      throw new Error(`FIELD_REQUIRED:${key}`);
    }
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    if (options.required) {
      throw new Error(`FIELD_REQUIRED:${key}`);
    }
    return undefined;
  }
  return options.maxLength ? trimmed.slice(0, options.maxLength) : trimmed;
}

function ipHash(request: Request): string | undefined {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim();
  return ip ? createHash('sha256').update(ip).digest('hex').slice(0, 16) : undefined;
}

function recordHostEdgeAccess(input: {
  request: Request;
  routeId: string;
  session: ModuleHostSession;
  status: number;
  outcome: string;
  startedAt: number;
}) {
  void getHostRuntimeStore()
    .then((runtimeStore) =>
      runtimeStore.store.recordAudit({
        productId: defaultProductId(input.session.productId),
        workspaceId: input.session.workspaceId ?? null,
        actorId: input.session.actorId ?? input.session.userId ?? input.session.user?.id,
        type: 'host.edge.access',
        metadata: {
          routeId: input.routeId,
          method: input.request.method,
          path: new URL(input.request.url).pathname,
          status: input.status,
          outcome: input.outcome,
          latencyMs: Date.now() - input.startedAt,
          ipHash: ipHash(input.request),
          userAgent: input.request.headers.get('user-agent') ?? undefined,
          requestId: input.request.headers.get('x-request-id') ?? undefined,
          correlationId: input.request.headers.get('x-correlation-id') ?? undefined,
        },
      })
    )
    .catch(() => undefined);
}

export async function requireApiSession(
  request: Request,
  routeId: string,
  options: { admin?: boolean; cost?: number } = {}
): Promise<{ session: ModuleHostSession } | Response> {
  const startedAt = Date.now();
  const session = await resolveHostSessionFromRequest(request);
  const securityResponse = await checkHostRouteSecurity(request, routeId, {
    session,
    cost: options.cost,
  });
  if (securityResponse) {
    recordHostEdgeAccess({
      request,
      routeId,
      session,
      status: securityResponse.status,
      outcome: 'security-blocked',
      startedAt,
    });
    return securityResponse;
  }
  if (!session.user) {
    recordHostEdgeAccess({
      request,
      routeId,
      session,
      status: 401,
      outcome: 'auth-required',
      startedAt,
    });
    return apiError(401, 'AUTH_REQUIRED', 'Authentication is required.');
  }
  if (options.admin) {
    const registryEntry = findAdminApiRegistryEntry(routeId, request.method);
    if (!registryEntry) {
      recordHostEdgeAccess({
        request,
        routeId,
        session,
        status: 500,
        outcome: 'admin-registry-missing',
        startedAt,
      });
      return apiError(
        500,
        'ADMIN_API_REGISTRY_MISSING',
        'Admin API route is missing from the admin route registry.'
      );
    }
    try {
      requireCapability(session, 'admin.access');
      requireCapability(session, registryEntry.capability);
    } catch {
      recordHostEdgeAccess({
        request,
        routeId,
        session,
        status: 403,
        outcome: 'admin-required',
        startedAt,
      });
      return apiError(403, 'ADMIN_REQUIRED', 'Admin permission is required.');
    }
  }
  recordHostEdgeAccess({
    request,
    routeId,
    session,
    status: 200,
    outcome: 'accepted',
    startedAt,
  });
  return { session };
}
