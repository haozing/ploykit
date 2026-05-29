import { Permission } from '@ploykit/module-sdk';
import type {
  RuntimeStoreAuditRecord,
  RuntimeStoreEntitlementStatus,
  ModuleHostSession,
} from '@/lib/module-runtime';
import {
  getAdminCommercialView,
  getAdminFilesView,
  getAdminOperationsView,
  type AdminOperationsViewSnapshot,
} from './admin-operations';
import {
  getAdminSearchTypeCapability,
  getAdminSearchTypeRisk,
  type AdminSearchResult,
} from './admin-search-model';
import { getAdminServiceConnectionsView } from './admin-service-connections';
import { getHostRuntime } from './create-host';
import { DEFAULT_HOST_PRODUCT_ID } from './default-scope';
import { getHostIdentityOperationsView } from './identity-operations';
import {
  getHostCapabilitiesForSession,
  HOST_CAPABILITIES,
  HOST_ROLES,
  type HostCapability,
} from './rbac';

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

function page<T>(items: readonly T[], query: AdminApiQuery) {
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

function createAdminSearchResult(
  type: AdminSearchResult['type'],
  id: string,
  label: string,
  fields: Omit<AdminSearchResult, 'type' | 'id' | 'label'> = {}
): AdminSearchResult {
  return {
    type,
    id,
    label,
    capabilityRequired: getAdminSearchTypeCapability(type),
    risk: getAdminSearchTypeRisk(type),
    redacted: false,
    ...fields,
  };
}

function matchedSearchFields(
  query: string,
  fields: Record<string, unknown>
): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  return Object.entries(fields)
    .filter(([, value]) => String(value ?? '').toLowerCase().includes(needle))
    .map(([field]) => field);
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

export async function listAdminUsers(query: AdminApiQuery) {
  const view = await getHostIdentityOperationsView();
  return page(
    view.users.filter(
      (user) =>
        matchesTextSearch(query.q, [
          user.id,
          user.email,
          user.role,
          user.status,
          user.workspaceId,
        ]) &&
        (!query.status || user.status === query.status || user.role === query.status)
    ),
    query
  );
}

export function listAdminRoles() {
  return HOST_ROLES;
}

export function listAdminPermissions() {
  return {
    hostCapabilities: HOST_CAPABILITIES,
    modulePermissions: Object.values(Permission).map((value) => ({ value })),
  };
}

export async function listAdminEntitlements(query: AdminApiQuery) {
  const commercial = await getAdminCommercialView();
  const filtered = commercial.entitlements.filter(
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

function dateMs(value: string | undefined): number {
  const parsed = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveRange(query: AdminApiQuery = {}) {
  const now = Date.now();
  const rangeDays = query.range === '24h'
    ? 1
    : query.range === '90d'
      ? 90
      : query.range === 'custom'
        ? 30
        : query.range === '30d'
          ? 30
          : 7;
  const from = query.from ? new Date(query.from).getTime() : now - rangeDays * 24 * 60 * 60 * 1000;
  const to = query.to ? new Date(query.to).getTime() : now;
  return {
    label: query.range ?? `${rangeDays}d`,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    fromMs: from,
    toMs: to,
  };
}

function inRange(createdAt: string | undefined, range: ReturnType<typeof resolveRange>) {
  const timestamp = dateMs(createdAt);
  return timestamp >= range.fromMs && timestamp <= range.toMs;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * percentileValue))] ?? 0;
}

function dayKey(value: string): string {
  return value.slice(0, 10);
}

function enumerateDays(range: ReturnType<typeof resolveRange>) {
  const days: string[] = [];
  const cursor = new Date(range.fromMs);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(range.toMs);
  end.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= end.getTime() && days.length < 370) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export async function getAdminAnalytics(query: AdminApiQuery = {}) {
  const [operations, commercial, files, identity] = await Promise.all([
    getAdminOperationsView(),
    getAdminCommercialView(),
    getAdminFilesView(),
    getHostIdentityOperationsView(),
  ]);
  const range = resolveRange(query);
  const orders = commercial.orders.filter((order) => inRange(order.createdAt, range));
  const paidOrders = orders.filter((order) => order.status === 'paid');
  const refundedOrders = orders.filter((order) => order.status === 'refunded');
  const failedOrders = orders.filter((order) => order.status === 'failed');
  const users = identity.users.filter((user) => inRange(user.createdAt, range));
  const usage = operations.snapshot.recent.usageRecords.filter((record) => inRange(record.createdAt, range));
  const runs = operations.snapshot.recent.runs.filter((run) => inRange(run.createdAt, range));
  const receipts = operations.snapshot.recent.webhookReceipts.filter((receipt) =>
    inRange(receipt.createdAt, range)
  );
  const outbox = operations.snapshot.recent.outbox.filter((record) => inRange(record.createdAt, range));
  const auditLogs = operations.snapshot.recent.auditLogs.filter((record) => inRange(record.createdAt, range));
  const revenue = paidOrders.reduce((sum, order) => sum + order.amount, 0);
  const monthlyRevenue = paidOrders
    .filter((order) => {
      const sku = commercial.catalog.skus.find((candidate) => candidate.id === order.sku);
      return sku?.interval === 'month';
    })
    .reduce((sum, order) => sum + order.amount, 0);
  const activeSubscribers = new Set(
    commercial.entitlements
      .filter((grant) => grant.status === 'active')
      .map((grant) => grant.userId)
  );
  const churnedEntitlements = commercial.entitlements.filter(
    (grant) => grant.status === 'revoked' || grant.status === 'expired'
  );
  const latencyValues = auditLogs
    .map((record) => Number(record.metadata.latencyMs))
    .filter((value) => Number.isFinite(value));
  const usageByModule = usage.reduce<Record<string, number>>((acc, record) => {
    acc[record.moduleId] = (acc[record.moduleId] ?? 0) + record.quantity;
    return acc;
  }, {});
  const usageByMeter = usage.reduce<Record<string, number>>((acc, record) => {
    acc[record.meter] = (acc[record.meter] ?? 0) + record.quantity;
    return acc;
  }, {});
  const timeSeriesMap = new Map(
    enumerateDays(range).map((date) => [
      date,
      {
        date,
        usageQuantity: 0,
        revenueAmount: 0,
        signups: 0,
        failedRuns: 0,
        failedWebhooks: 0,
        deadLetters: 0,
        latencySamples: [] as number[],
      },
    ])
  );
  const ensureBucket = (createdAt: string) => {
    const date = dayKey(createdAt);
    const existing = timeSeriesMap.get(date);
    if (existing) {
      return existing;
    }
    const bucket = {
      date,
      usageQuantity: 0,
      revenueAmount: 0,
      signups: 0,
      failedRuns: 0,
      failedWebhooks: 0,
      deadLetters: 0,
      latencySamples: [] as number[],
    };
    timeSeriesMap.set(date, bucket);
    return bucket;
  };
  usage.forEach((record) => {
    ensureBucket(record.createdAt).usageQuantity += record.quantity;
  });
  paidOrders.forEach((order) => {
    ensureBucket(order.createdAt).revenueAmount += order.amount;
  });
  users.forEach((user) => {
    ensureBucket(user.createdAt).signups += 1;
  });
  runs.filter((run) => run.status === 'failed').forEach((run) => {
    ensureBucket(run.createdAt).failedRuns += 1;
  });
  receipts.filter((receipt) => receipt.status === 'failed').forEach((receipt) => {
    ensureBucket(receipt.createdAt).failedWebhooks += 1;
  });
  outbox.filter((record) => record.status === 'dead_letter').forEach((record) => {
    ensureBucket(record.createdAt).deadLetters += 1;
  });
  auditLogs.forEach((record) => {
    const latency = Number(record.metadata.latencyMs);
    if (Number.isFinite(latency)) {
      ensureBucket(record.createdAt).latencySamples.push(latency);
    }
  });
  const timeSeries = Array.from(timeSeriesMap.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((bucket) => ({
      date: bucket.date,
      usageQuantity: bucket.usageQuantity,
      revenueAmount: bucket.revenueAmount,
      signups: bucket.signups,
      failedRuns: bucket.failedRuns,
      failedWebhooks: bucket.failedWebhooks,
      deadLetters: bucket.deadLetters,
      p95LatencyMs: percentile(bucket.latencySamples, 0.95),
    }));
  const usageTrends = timeSeries.map((point) => ({ date: point.date, quantity: point.usageQuantity }));
  const cohorts = Object.entries(
    identity.users.reduce<Record<string, { size: number; retained: number; revenue: number }>>((acc, user) => {
      const key = user.createdAt.slice(0, 7);
      acc[key] ??= { size: 0, retained: 0, revenue: 0 };
      acc[key].size += 1;
      const hasActivity =
        operations.snapshot.recent.usageRecords.some((record) => record.metadata.userId === user.id) ||
        commercial.orders.some((order) => order.userId === user.id);
      if (hasActivity) {
        acc[key].retained += 1;
      }
      acc[key].revenue += commercial.orders
        .filter((order) => order.userId === user.id && order.status === 'paid')
        .reduce((sum, order) => sum + order.amount, 0);
      return acc;
    }, {})
  ).map(([cohort, value]) => ({
    cohort,
    size: value.size,
    retained: value.retained,
    retentionRate: value.size > 0 ? value.retained / value.size : 0,
    revenue: value.revenue,
  }));
  const edgeAccessLogs = auditLogs
    .filter((record) => record.type === 'host.edge.access')
    .map((record) => ({
      route: String(record.metadata.routeId ?? record.metadata.path ?? 'unknown'),
      status: Number(record.metadata.status ?? 0),
      ipHash: String(record.metadata.ipHash ?? ''),
      latencyMs: Number(record.metadata.latencyMs ?? 0),
      userAgent: String(record.metadata.userAgent ?? ''),
      createdAt: record.createdAt,
    }));
  return {
    range,
    counts: {
      ...operations.snapshot.counts,
      users: identity.users.length,
      files: files.files.length,
      orders: commercial.orders.length,
      entitlements: commercial.entitlements.length,
      credits: commercial.credits.length,
      creditReservations: commercial.creditReservations.length,
      redeemCodes: commercial.redeemCodes.length,
      redeemAttempts: commercial.redeemAttempts.length,
      apiKeys: commercial.apiKeys.length,
      riskEvents: commercial.riskEvents.length,
      riskBlocks: commercial.riskBlocks.length,
    },
    revenueMetrics: {
      revenue,
      mrr: monthlyRevenue,
      arr: monthlyRevenue * 12,
      arpu: activeSubscribers.size > 0 ? Math.round(monthlyRevenue / activeSubscribers.size) : 0,
      ltv: activeSubscribers.size > 0 ? Math.round(revenue / activeSubscribers.size) : 0,
      refunds: refundedOrders.length,
      failedPayments: failedOrders.length,
    },
    growthMetrics: {
      signups: users.length,
      activation: identity.users.filter((user) => user.status === 'active').length,
      trialConversion: identity.users.length > 0 ? activeSubscribers.size / identity.users.length : 0,
      upgrades: commercial.entitlements.filter((grant) => grant.source === 'order').length,
      downgrades: churnedEntitlements.length,
    },
    churnMetrics: {
      churnCount: churnedEntitlements.length,
      churnRate:
        commercial.entitlements.length > 0
          ? churnedEntitlements.length / commercial.entitlements.length
          : 0,
      lostMrr: churnedEntitlements.reduce((sum, grant) => {
        const sku = commercial.catalog.skus.find((candidate) => candidate.planId === grant.planId);
        return sum + (sku?.interval === 'month' ? sku.amount : 0);
      }, 0),
      reasons: churnedEntitlements.reduce<Record<string, number>>((acc, grant) => {
        const reason = String(grant.metadata.overrideReason ?? grant.status);
        acc[reason] = (acc[reason] ?? 0) + 1;
        return acc;
      }, {}),
    },
    usagePatterns: {
      byModule: usageByModule,
      byMeter: usageByMeter,
      peak: Math.max(0, ...usage.map((record) => record.quantity)),
      median: median(usage.map((record) => record.quantity)),
    },
    timeSeries,
    usageTrends,
    cohorts,
    reliability: {
      failedRuns: runs.filter((run) => run.status === 'failed').length,
      failedWebhooks: receipts.filter((receipt) => receipt.status === 'failed').length,
      deadLetters: outbox.filter((record) => record.status === 'dead_letter').length,
      p50LatencyMs: median(latencyValues),
      p95LatencyMs: percentile(latencyValues, 0.95),
      warnings: [
        runs.some((run) => run.status === 'failed') ? 'run failures' : null,
        receipts.some((receipt) => receipt.status === 'failed') ? 'webhook failures' : null,
        outbox.some((record) => record.status === 'dead_letter') ? 'dead letters' : null,
        percentile(latencyValues, 0.95) > 1000 ? 'latency p95 high' : null,
      ].filter((item): item is string => Boolean(item)),
    },
    edgeAccessLogs,
    store: operations.store,
  };
}

export async function getAdminRevenue(query: AdminApiQuery) {
  const [commercial, operations] = await Promise.all([
    getAdminCommercialView(),
    getAdminOperationsView(),
  ]);
  const orders = commercial.orders.filter(
    (order) =>
      matchesTextSearch(query.q, [order.id, order.sku, order.userId, order.status]) &&
      matchesStatus(query.status, order.status)
  );
  const totals = orders.reduce<Record<string, number>>((acc, order) => {
    if (order.status === 'paid') {
      acc[order.currency] = (acc[order.currency] ?? 0) + order.amount;
    }
    return acc;
  }, {});
  const dailyBucketMap = commercial.orders.reduce(
    (acc, order) => {
      const day = dayKey(order.createdAt);
      const bucket = acc.get(day) ?? {
        day,
        total: 0,
        paid: 0,
        refunded: 0,
        failed: 0,
        currencies: {} as Record<string, number>,
      };
      if (order.status === 'paid') {
        bucket.total += order.amount;
        bucket.paid += 1;
        bucket.currencies[order.currency] = (bucket.currencies[order.currency] ?? 0) + order.amount;
      }
      if (order.status === 'refunded') {
        bucket.refunded += 1;
      }
      if (order.status === 'failed') {
        bucket.failed += 1;
      }
      acc.set(day, bucket);
      return acc;
    },
    new Map<string, { day: string; total: number; paid: number; refunded: number; failed: number; currencies: Record<string, number> }>()
  );
  const dailyBuckets = Array.from(dailyBucketMap.values()).sort((left, right) => left.day.localeCompare(right.day));
  const providerEvents = operations.snapshot.recent.auditLogs
    .filter(
      (record) =>
        record.type.startsWith('commercial.provider.') ||
        record.type.startsWith('commercial.reconcile.')
    )
    .slice(0, 20);
  return { ...page(orders, query), totals, providerEvents, catalog: commercial.catalog, dailyBuckets };
}

export async function listAdminUsage(query: AdminApiQuery) {
  const view = await getAdminOperationsView();
  return page(
    view.snapshot.recent.usageRecords.filter((record) =>
      matchesTextSearch(query.q, [record.id, record.meter, record.moduleId, record.quantity])
    ),
    query
  );
}

export async function listAdminMetering(query: AdminApiQuery) {
  const hostRuntime = await getHostRuntime();
  const records = await hostRuntime.runtimeStore.store.listMetering({
    productId: DEFAULT_HOST_PRODUCT_ID,
  });
  return page(
    records.filter(
      (record) =>
        matchesTextSearch(query.q, [
          record.id,
          record.meter,
          record.moduleId,
          record.workspaceId,
          record.quantity,
          record.status,
          JSON.stringify(record.metadata),
        ]) && matchesStatus(query.status, record.status)
    ),
    query
  );
}

export async function listAdminAudit(query: AdminApiQuery) {
  const hostRuntime = await getHostRuntime();
  const records = await hostRuntime.runtimeStore.store.listAudit({
    productId: DEFAULT_HOST_PRODUCT_ID,
    from: query.from,
    to: query.to,
  });
  return page(
    records
      .filter(
      (record) =>
        matchesTextSearch(query.q, [
          record.id,
          record.type,
          record.actorId ?? 'system',
          record.moduleId ?? 'host',
          record.productId,
          record.workspaceId ?? '',
          record.integrity?.category ?? '',
          record.integrity?.risk ?? '',
          record.integrity?.resourceType ?? '',
          record.integrity?.resourceId ?? '',
          record.integrity?.correlationId ?? '',
          record.integrity?.recordHash ?? '',
          JSON.stringify(record.metadata),
        ]) &&
        (!query.type || query.type === 'audit' || record.type.includes(query.type)) &&
        matchesAuditStatus(query.status, record)
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    query
  );
}

function matchesAuditStatus(
  status: string | undefined,
  record: RuntimeStoreAuditRecord
): boolean {
  const needle = status?.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  const metadata = JSON.stringify(record.metadata).toLowerCase();
  const risk = record.integrity?.risk?.toLowerCase() ?? '';
  const category = record.integrity?.category?.toLowerCase() ?? '';
  const type = record.type.toLowerCase();
  if (['failed', 'failure', 'error', 'denied', 'blocked'].includes(needle)) {
    return risk === 'medium' || [type, metadata].some((value) => value.includes(needle));
  }
  if (['danger', 'dangerous', 'high', 'sensitive'].includes(needle)) {
    return risk === 'high' || metadata.includes(needle) || type.includes(needle);
  }
  return risk === needle || category === needle || metadata.includes(needle) || type.includes(needle);
}

export async function listAdminFiles(query: AdminApiQuery) {
  const view = await getAdminFilesView();
  const provider = view.storage.mode;
  return page(
    view.files.filter(
      (file) =>
        matchesTextSearch(query.q, [
          file.id,
          file.name,
          file.moduleId,
          file.ownerId ?? 'system',
          file.purpose,
          file.visibility,
          file.contentType ?? '',
          file.storageKey,
        ]) &&
        matchesStatus(query.status, file.status) &&
        (!query.owner || (file.ownerId ?? 'system').includes(query.owner)) &&
        (!query.mime || (file.contentType ?? '').includes(query.mime)) &&
        (!query.provider || provider === query.provider) &&
        (!query.path || file.storageKey.includes(query.path) || file.name.includes(query.path)) &&
        (!query.from || file.createdAt.slice(0, 10) >= query.from) &&
        (!query.to || file.createdAt.slice(0, 10) <= query.to) &&
        (!query.minSize || file.sizeBytes >= query.minSize) &&
        (!query.maxSize || file.sizeBytes <= query.maxSize)
    ),
    query
  );
}

export async function listAdminDeadLetters(query: AdminApiQuery) {
  await getAdminOperationsView();
  const hostRuntime = await getHostRuntime();
  const records = await hostRuntime.runtimeStore.store.listOutbox({
    productId: DEFAULT_HOST_PRODUCT_ID,
    status: 'dead_letter',
  });
  return page(
    records
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .filter((record) =>
        matchesTextSearch(query.q, [record.id, record.name, record.moduleId ?? 'host'])
      ),
    query
  );
}

export async function getAdminServiceConnections() {
  return getAdminServiceConnectionsView();
}

function searchSnapshot(
  snapshot: AdminOperationsViewSnapshot,
  query: string,
  capabilities?: readonly HostCapability[]
): AdminSearchResult[] {
  const canSearchType = (type: AdminSearchResult['type']) => {
    const capability = getAdminSearchTypeCapability(type);
    return !capabilities || capabilities.includes(capability);
  };
  return [
    ...(canSearchType('module')
      ? snapshot.modules
          .filter((module) => matchesTextSearch(query, [module.id, module.name]))
          .map((module) => createAdminSearchResult('module', module.id, module.name, {
            status: module.status,
            updatedAt: module.activity.lastActivityAt ?? undefined,
            description: `${module.runtimeState} · ${module.health.status}`,
            matchedFields: matchedSearchFields(query, {
              id: module.id,
              name: module.name,
              status: module.status,
              runtime: module.runtimeState,
              health: module.health.status,
            }),
          }))
      : []),
    ...(canSearchType('run')
      ? snapshot.recent.runs
          .filter((run) => matchesTextSearch(query, [run.id, run.name, run.moduleId, run.status]))
          .map((run) =>
            createAdminSearchResult('run', run.id, run.name, {
              status: run.status,
              description: run.moduleId,
              updatedAt: run.updatedAt,
              matchedFields: matchedSearchFields(query, {
                id: run.id,
                name: run.name,
                module: run.moduleId,
                status: run.status,
              }),
            })
          )
      : []),
    ...(canSearchType('outbox')
      ? snapshot.recent.outbox
          .filter((record) => matchesTextSearch(query, [record.id, record.name, record.status]))
          .map((record) =>
            createAdminSearchResult('outbox', record.id, record.name, {
              status: record.status,
              description: record.moduleId ?? 'host',
              updatedAt: record.updatedAt,
              matchedFields: matchedSearchFields(query, {
                id: record.id,
                name: record.name,
                module: record.moduleId ?? 'host',
                status: record.status,
              }),
            })
          )
      : []),
  ];
}

export async function searchAdmin(
  query: AdminApiQuery,
  options: { session?: ModuleHostSession } = {}
) {
  const capabilities = options.session ? getHostCapabilitiesForSession(options.session) : undefined;
  const [operations, users, files, commercial] = await Promise.all([
    getAdminOperationsView(),
    getHostIdentityOperationsView(),
    getAdminFilesView(),
    getAdminCommercialView(),
  ]);
  const q = query.q?.trim() ?? '';
  if (!q) {
    return page<AdminSearchResult>([], query);
  }
  const results = [
    ...searchSnapshot(operations.snapshot, q, capabilities),
    ...(capabilities?.includes(getAdminSearchTypeCapability('user')) ?? true
      ? users.users
          .filter((user) => matchesTextSearch(q, [user.id, user.email, user.role, user.status]))
          .map((user) =>
            createAdminSearchResult('user', user.id, user.email, {
              status: user.status,
              description: `${user.role ?? 'user'} · ${user.workspaceId ?? 'global'}`,
              updatedAt: user.updatedAt,
              matchedFields: matchedSearchFields(q, {
                id: user.id,
                email: user.email,
                role: user.role,
                status: user.status,
                workspace: user.workspaceId,
              }),
            })
          )
      : []),
    ...(capabilities?.includes(getAdminSearchTypeCapability('file')) ?? true
      ? files.files
          .filter((file) => matchesTextSearch(q, [file.id, file.name, file.moduleId]))
          .map((file) =>
            createAdminSearchResult('file', file.id, file.name, {
              status: file.status,
              description: file.moduleId ?? file.ownerId ?? 'system',
              updatedAt: file.updatedAt ?? file.createdAt,
              matchedFields: matchedSearchFields(q, {
                id: file.id,
                name: file.name,
                module: file.moduleId,
                owner: file.ownerId ?? 'system',
                status: file.status,
              }),
            })
          )
      : []),
    ...(capabilities?.includes(getAdminSearchTypeCapability('order')) ?? true
      ? commercial.orders
          .filter((order) => matchesTextSearch(q, [order.id, order.sku, order.userId, order.status]))
          .map((order) =>
            createAdminSearchResult('order', order.id, order.sku, {
              status: order.status,
              description: order.userId,
              updatedAt: order.updatedAt,
              matchedFields: matchedSearchFields(q, {
                id: order.id,
                sku: order.sku,
                user: order.userId,
                status: order.status,
              }),
            })
          )
      : []),
  ].filter((result) => !query.type || result.type === query.type);
  return page(results, query);
}
