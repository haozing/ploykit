import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { eventOutbox, files, pluginInstallations, webhookLogs } from '@/lib/db/schema';
import { withAdminGuard, withErrorHandling, type AuthContext } from '@/lib/middleware';
import type { RuntimeReport } from '@/lib/runtime';
import { resolveApiRoutePolicy } from '@/lib/security/api-route-catalog';

interface SystemServiceStatus {
  name: string;
  status: 'operational' | 'degraded' | 'down';
  latency: string;
  statusCode: 'ok' | 'warning' | 'error';
  details?: Record<string, unknown>;
}

interface CachedRuntimeStatus {
  status: SystemServiceStatus;
  expiresAt: number;
}

const RUNTIME_RECONCILE_CACHE_TTL_MS = 60_000;

let cachedRuntimeStatus: CachedRuntimeStatus | null = null;
let runtimeRefreshPromise: Promise<SystemServiceStatus> | null = null;

/**
 * GET /api/admin/dashboard/system-status
 *
 * Get system health status for key services
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async (request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };
    const mode = new URL(request.url).searchParams.get('mode') === 'full' ? 'full' : 'quick';
    const services: SystemServiceStatus[] = [];

    // Check database connectivity
    const dbStartTime = Date.now();
    try {
      // Simple query to check database connection
      await db.execute(sql.raw('SELECT 1'));
      const dbLatency = Date.now() - dbStartTime;

      services.push({
        name: 'Database',
        status: 'operational',
        latency: `${dbLatency}ms`,
        statusCode: 'ok',
      });
    } catch (_dbError) {
      services.push({
        name: 'Database',
        status: 'degraded',
        latency: 'N/A',
        statusCode: 'error',
      });
    }

    if (mode === 'full') {
      services.push(await refreshRuntimeReconcileStatus());
    } else {
      services.push(getRuntimeReconcileSnapshot());
    }

    services.push(
      ...(await Promise.all([
        getAuthenticationStatus(auth),
        getApiGatewayStatus(),
        getOutboxStoreStatus(),
        getWebhookReceiptsStatus(),
        getFileStorageMetadataStatus(),
        getPluginRegistryStatus(),
      ]))
    );

    return NextResponse.json(
      {
        success: true,
        data: services,
      },
      { status: 200 }
    );
  })
);

async function measureServiceStatus(
  name: string,
  probe: () => Promise<Omit<SystemServiceStatus, 'name' | 'latency'>>
): Promise<SystemServiceStatus> {
  const startedAt = Date.now();

  try {
    const status = await probe();
    return {
      name,
      latency: `${Date.now() - startedAt}ms`,
      ...status,
    };
  } catch (error) {
    return {
      name,
      status: 'degraded',
      latency: `${Date.now() - startedAt}ms`,
      statusCode: 'error',
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

async function getAuthenticationStatus(auth: AuthContext): Promise<SystemServiceStatus> {
  return measureServiceStatus('Authentication', async () => ({
    status: auth.userId && auth.userEmail ? 'operational' : 'down',
    statusCode: auth.userId && auth.userEmail ? 'ok' : 'error',
    details: {
      authenticated: Boolean(auth.userId && auth.userEmail),
      contextFields: {
        userId: Boolean(auth.userId),
        userEmail: Boolean(auth.userEmail),
        sessionId: Boolean(auth.session.id),
      },
    },
  }));
}

async function getApiGatewayStatus(): Promise<SystemServiceStatus> {
  return measureServiceStatus('API Gateway', async () => {
    const requiredPolicies = [
      { path: '/api/admin/dashboard/system-status', method: 'GET', access: 'admin' },
      { path: '/api/files', method: 'POST', access: 'authenticated' },
      { path: '/api/plugins/sample-tool/api/echo', method: 'POST', access: 'plugin-gateway' },
      { path: '/api/admin/webhooks/retry/[id]', method: 'POST', access: 'admin' },
      { path: '/api/webhooks/stripe', method: 'POST', access: 'webhook' },
    ];
    const checks = requiredPolicies.map((policy) => {
      const resolved = resolveApiRoutePolicy(policy.path, policy.method);
      return {
        path: policy.path,
        method: policy.method,
        expectedAccess: policy.access,
        actualAccess: resolved?.access,
        ok: resolved?.access === policy.access,
      };
    });
    const missingOrMismatched = checks.filter((check) => !check.ok);

    return {
      status: missingOrMismatched.length === 0 ? 'operational' : 'degraded',
      statusCode: missingOrMismatched.length === 0 ? 'ok' : 'warning',
      details: {
        catalogPoliciesChecked: checks.length,
        missingOrMismatched,
      },
    };
  });
}

async function getOutboxStoreStatus(): Promise<SystemServiceStatus> {
  return measureServiceStatus('Outbox Store', async () => {
    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${eventOutbox.status} = 'pending')::int`,
        failed: sql<number>`count(*) filter (where ${eventOutbox.status} = 'failed')::int`,
      })
      .from(eventOutbox);

    return {
      status: 'operational',
      statusCode: counts.failed > 0 ? 'warning' : 'ok',
      details: counts,
    };
  });
}

async function getWebhookReceiptsStatus(): Promise<SystemServiceStatus> {
  return measureServiceStatus('Webhook Receipts', async () => {
    const [counts] = await db
      .select({
        total: sql<number>`count(*)::int`,
        received: sql<number>`count(*) filter (where ${webhookLogs.status} = 'received')::int`,
        failed: sql<number>`count(*) filter (where ${webhookLogs.status} = 'failed')::int`,
        processing: sql<number>`count(*) filter (where ${webhookLogs.status} = 'processing')::int`,
      })
      .from(webhookLogs);

    return {
      status: 'operational',
      statusCode: counts.failed > 0 ? 'warning' : 'ok',
      details: counts,
    };
  });
}

async function getFileStorageMetadataStatus(): Promise<SystemServiceStatus> {
  return measureServiceStatus('File Storage Metadata', async () => {
    const [counts] = await db
      .select({
        totalFiles: sql<number>`count(*)::int`,
        pendingDeletes: sql<number>`count(*) filter (where ${files.deleteStatus} = 'pending_delete')::int`,
        totalBytes: sql<number>`coalesce(sum(${files.size}), 0)::int`,
      })
      .from(files);

    return {
      status: 'operational',
      statusCode: counts.pendingDeletes > 0 ? 'warning' : 'ok',
      details: counts,
    };
  });
}

async function getPluginRegistryStatus(): Promise<SystemServiceStatus> {
  return measureServiceStatus('Plugin Registry', async () => {
    const [counts] = await db
      .select({
        installed: sql<number>`count(*)::int`,
        enabled: sql<number>`count(*) filter (where ${pluginInstallations.enabled} = true)::int`,
      })
      .from(pluginInstallations);

    return {
      status: 'operational',
      statusCode: 'ok',
      details: counts,
    };
  });
}

function getRuntimeReconcileSnapshot(): SystemServiceStatus {
  const now = Date.now();
  if (cachedRuntimeStatus && cachedRuntimeStatus.expiresAt > now) {
    return withRuntimeDetails(cachedRuntimeStatus.status, {
      mode: 'cached',
      cachedUntil: new Date(cachedRuntimeStatus.expiresAt).toISOString(),
    });
  }

  return {
    name: 'Runtime Reconcile',
    status: 'operational',
    latency: 'background',
    statusCode: 'ok',
    details: {
      mode: 'quick',
      cache: 'empty',
    },
  };
}

async function refreshRuntimeReconcileStatus(): Promise<SystemServiceStatus> {
  if (!runtimeRefreshPromise) {
    runtimeRefreshPromise = getRuntimeReconcileStatus()
      .then((status) => {
        cachedRuntimeStatus = {
          status,
          expiresAt: Date.now() + RUNTIME_RECONCILE_CACHE_TTL_MS,
        };
        return status;
      })
      .finally(() => {
        runtimeRefreshPromise = null;
      });
  }

  return runtimeRefreshPromise;
}

async function getRuntimeReconcileStatus(): Promise<SystemServiceStatus> {
  const startedAt = Date.now();

  try {
    const { runReconcile } = await import('@/lib/runtime');
    const report = await runReconcile();
    const latency = Date.now() - startedAt;

    return {
      name: 'Runtime Reconcile',
      status: reportOverallToServiceStatus(report.overall),
      latency: `${latency}ms`,
      statusCode: reportOverallToStatusCode(report.overall),
      details: {
        mode: 'full',
        ...createRuntimeReconcileDetails(report),
      },
    };
  } catch (error) {
    return {
      name: 'Runtime Reconcile',
      status: 'degraded',
      latency: 'N/A',
      statusCode: 'warning',
      details: {
        mode: 'full',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function withRuntimeDetails(
  status: SystemServiceStatus,
  details: Record<string, unknown>
): SystemServiceStatus {
  return {
    ...status,
    details: {
      ...status.details,
      ...details,
    },
  };
}

function reportOverallToServiceStatus(
  overall: RuntimeReport['overall']
): SystemServiceStatus['status'] {
  if (overall === 'ok') {
    return 'operational';
  }

  return overall === 'degraded' ? 'degraded' : 'down';
}

function reportOverallToStatusCode(
  overall: RuntimeReport['overall']
): SystemServiceStatus['statusCode'] {
  if (overall === 'ok') {
    return 'ok';
  }

  return overall === 'degraded' ? 'warning' : 'error';
}

function createRuntimeReconcileDetails(report: RuntimeReport): Record<string, unknown> {
  const counts = report.checks.reduce(
    (acc, check) => {
      acc[check.status] += 1;
      return acc;
    },
    { ok: 0, warning: 0, failed: 0, skipped: 0 }
  );

  const attention = report.checks
    .filter((check) => check.status === 'warning' || check.status === 'failed')
    .slice(0, 5)
    .map((check) => ({
      key: check.key,
      status: check.status,
      message: check.message,
      fix: check.fix,
    }));

  return {
    timestamp: report.timestamp,
    environment: report.environment,
    checks: counts,
    attention,
  };
}
