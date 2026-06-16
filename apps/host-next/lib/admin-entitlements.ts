import { assertAdminSession } from './admin-session';
import { getHostCommercialRuntime } from './commercial-provider';
import { getHostRuntime } from './create-host';
import { DEFAULT_HOST_PRODUCT_ID } from './default-scope';
import {
  normalizeRuntimeStoreEntitlementGrant,
} from '@/lib/module-capabilities/commercial/commercial-ledger';
import type {
  ModuleHostSession,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreEntitlementStatus,
} from '@/lib/module-runtime';

export interface AdminApiQuery {
  q?: string;
  status?: string;
  type?: string;
  range?: string;
  from?: string;
  to?: string;
  owner?: string;
  mime?: string;
  provider?: string;
  path?: string;
  minSize?: number;
  maxSize?: number;
  limit?: number;
  offset?: number;
}

export interface AdminPagedResult<T> {
  items: T[];
  page: {
    total: number;
    offset: number;
    limit: number;
  };
}

export type AdminCommercialSubjectView = {
  type: 'user' | 'workspace' | 'organization' | 'apiKey';
  id: string;
  label: string;
};

export type AdminCommercialEntitlementGrant = RuntimeStoreEntitlementGrant & {
  subject: AdminCommercialSubjectView;
};

function matchesTextSearch(query: string | undefined, values: readonly unknown[]): boolean {
  const needle = query?.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return values.some((value) => String(value ?? '').toLowerCase().includes(needle));
}

function matchesStatus(status: string | undefined, value: unknown): boolean {
  return !status || String(value ?? '') === status;
}

function page<T>(items: readonly T[], query: AdminApiQuery): AdminPagedResult<T> {
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  return {
    items: items.slice(offset, offset + limit),
    page: {
      total: items.length,
      offset,
      limit,
    },
  };
}

export function readAdminApiQuery(request: Request): AdminApiQuery {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? '');
  const offset = Number(url.searchParams.get('offset') ?? '');
  const minSize = Number(url.searchParams.get('minSize') ?? '');
  const maxSize = Number(url.searchParams.get('maxSize') ?? '');
  return {
    q: url.searchParams.get('q') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    range: url.searchParams.get('range') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    owner: url.searchParams.get('owner') ?? undefined,
    mime: url.searchParams.get('mime') ?? undefined,
    provider: url.searchParams.get('provider') ?? undefined,
    path: url.searchParams.get('path') ?? undefined,
    minSize: Number.isFinite(minSize) ? minSize : undefined,
    maxSize: Number.isFinite(maxSize) ? maxSize : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
  };
}

function adminSubjectFromStoredUserId(userId: string): AdminCommercialSubjectView {
  const [type, ...idParts] = userId.split(':');
  if (
    (type === 'workspace' || type === 'organization' || type === 'apiKey') &&
    idParts.length > 0
  ) {
    const id = idParts.join(':');
    return { type, id, label: `${type}:${id}` };
  }
  return { type: 'user', id: userId, label: userId };
}

function normalizeAdminEntitlementGrant(
  grant: RuntimeStoreEntitlementGrant
): AdminCommercialEntitlementGrant {
  const normalized = normalizeRuntimeStoreEntitlementGrant(grant);
  return { ...normalized, subject: adminSubjectFromStoredUserId(normalized.userId) };
}

export async function listAdminEntitlements(query: AdminApiQuery) {
  const hostRuntime = await getHostRuntime();
  const entitlements = (
    await hostRuntime.runtimeStore.store.listEntitlements({
      productId: DEFAULT_HOST_PRODUCT_ID,
    })
  ).map(normalizeAdminEntitlementGrant);
  const filtered = entitlements.filter(
    (grant) =>
      matchesTextSearch(query.q, [
        grant.id,
        grant.entitlement,
        grant.userId,
        grant.subject.label,
        grant.status,
        grant.planId ?? '',
      ]) && matchesStatus(query.status, grant.status)
  );
  const statusCounts: Record<RuntimeStoreEntitlementStatus, number> = {
    active: 0,
    revoked: 0,
    expired: 0,
  };
  for (const grant of filtered) {
    statusCounts[grant.status] += 1;
  }
  return {
    ...page(filtered, query),
    statusCounts,
  };
}

export async function grantAdminEntitlement(
  session: ModuleHostSession,
  input: {
    userId: string;
    entitlement: string;
    planId?: string;
    expiresAt?: string;
  }
) {
  assertAdminSession(session);
  const commercial = await getHostCommercialRuntime(session);
  return commercial.admin.grantEntitlement({
    session,
    userId: input.userId,
    entitlement: input.entitlement,
    planId: input.planId,
    expiresAt: input.expiresAt,
    idempotencyKey: `admin:${input.userId}:${input.entitlement}:${Date.now()}`,
    metadata: { source: 'admin-ui' },
  });
}

export async function revokeAdminEntitlement(
  session: ModuleHostSession,
  entitlementId: string
) {
  assertAdminSession(session);
  const commercial = await getHostCommercialRuntime(session);
  return commercial.admin.revokeEntitlement({
    session,
    entitlementId,
    metadata: { source: 'admin-ui' },
  });
}

export async function overrideAdminEntitlement(
  session: ModuleHostSession,
  input: {
    entitlementId: string;
    status: RuntimeStoreEntitlementStatus;
    expiresAt?: string | null;
    reason?: string;
  }
) {
  assertAdminSession(session);
  const commercial = await getHostCommercialRuntime(session);
  return commercial.admin.overrideEntitlement({
    session,
    entitlementId: input.entitlementId,
    status: input.status,
    expiresAt: input.expiresAt,
    metadata: {
      source: 'admin-ui',
    },
    reason: input.reason,
  });
}
