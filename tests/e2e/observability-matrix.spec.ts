import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

import { getDockerDatabaseUrl } from '../../scripts/docker-db-env';
import { ADMIN_EMAIL, loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

interface ObservabilitySeed {
  auditResource: string;
  auditResourceId: string;
  edgePath: string;
  failurePath: string;
  metricKey: string;
  userId: string;
  usageValue: number;
}

async function createObservabilitySeed(): Promise<ObservabilitySeed> {
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });
  const suffix = `${Date.now()}-${randomUUID()}`;
  const pluginId = 'observability';
  const metric = `matrix_${Date.now()}`;
  const usageValue = 17;
  const auditResourceId = `matrix-${suffix}`;
  const edgePath = `/api/observability/${suffix}/ok`;
  const failurePath = `/api/observability/${suffix}/fail`;
  const now = new Date();

  try {
    const users = await sql<{ id: string }[]>`
      select id
      from "user"
      where email = ${ADMIN_EMAIL}
      limit 1
    `;
    const userId = users[0]?.id;
    expect(userId, `Could not find seeded admin user ${ADMIN_EMAIL}`).toBeTruthy();

    const webhookId = randomUUID();

    await sql.begin(async (tx) => {
      await tx`
        insert into audit_logs (
          id,
          user_id,
          user_email,
          action,
          resource,
          resource_id,
          resource_name,
          ip_address,
          user_agent,
          status,
          metadata,
          created_at
        )
        values (
          ${randomUUID()},
          ${userId},
          ${ADMIN_EMAIL},
          'observability.matrix',
          'observability_matrix',
          ${auditResourceId},
          'Observability Matrix',
          '127.0.0.1',
          'playwright-observability-matrix',
          'failure',
          ${sql.json({ source: 'observability-matrix', suffix })},
          ${now}
        )
      `;

      await tx`
        insert into usage_history (
          id,
          idempotency_key,
          user_id,
          plugin_id,
          metric,
          value,
          unit,
          metadata,
          recorded_at
        )
        values (
          ${randomUUID()},
          ${`observability-usage-${suffix}`},
          ${userId},
          ${pluginId},
          ${metric},
          ${usageValue},
          'count',
          ${sql.json({ source: 'observability-matrix', suffix })},
          ${now}
        )
      `;

      await tx`
        insert into event_outbox (
          id,
          event,
          payload,
          metadata,
          status,
          attempts,
          max_attempts,
          error,
          next_attempt_at,
          created_at,
          updated_at
        )
        values (
          ${`outbox-${suffix}`},
          'observability.matrix.failed',
          ${sql.json({ suffix })},
          ${sql.json({ source: 'observability-matrix' })},
          'failed',
          3,
          3,
          'observability matrix synthetic failure',
          ${now},
          ${now},
          ${now}
        )
      `;

      await tx`
        insert into plugin_job_runs (
          id,
          plugin_id,
          job_name,
          status,
          priority,
          payload,
          attempts,
          max_attempts,
          idempotency_key,
          error,
          started_at,
          completed_at,
          dead_lettered_at,
          created_at,
          updated_at
        )
        values (
          ${`job-${suffix}`},
          'observability',
          'matrix.dead_letter',
          'dead_letter',
          'normal',
          ${sql.json({ suffix })},
          2,
          2,
          ${`observability-job-${suffix}`},
          'observability matrix job dead letter',
          ${now},
          ${now},
          ${now},
          ${now},
          ${now}
        )
      `;

      await tx`
        insert into webhook_logs (
          id,
          provider,
          event_id,
          event_type,
          payload,
          signature,
          headers,
          status,
          internal_events,
          error,
          processing_time,
          retry_count,
          created_at,
          updated_at,
          processed_at
        )
        values (
          ${webhookId},
          'observability-matrix',
          ${`evt-${suffix}`},
          'observability.matrix.failed',
          ${sql.json({ suffix })},
          'test-signature',
          ${sql.json({ 'x-observability-matrix': '1' })},
          'dead_letter',
          ${sql.json([])},
          'observability matrix webhook dead letter',
          240,
          1,
          ${now},
          ${now},
          ${now}
        )
      `;

      await tx`
        insert into webhook_retries (
          id,
          webhook_log_id,
          attempt,
          status,
          error,
          retried_at
        )
        values (
          ${randomUUID()},
          ${webhookId},
          1,
          'failed',
          'observability matrix retry failure',
          ${now}
        )
      `;
    });

    return {
      auditResource: 'observability_matrix',
      auditResourceId,
      edgePath,
      failurePath,
      metricKey: `${pluginId}.${metric}`,
      userId,
      usageValue,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function fetchJson<T>(
  page: Page,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; ok: boolean; body: T }> {
  return page.evaluate(
    async ({ requestPath, requestInit }) => {
      const response = await fetch(requestPath, {
        method: requestInit?.method,
        headers:
          requestInit?.body === undefined ? undefined : { 'content-type': 'application/json' },
        body: requestInit?.body === undefined ? undefined : JSON.stringify(requestInit.body),
      });
      const text = await response.text();
      return {
        status: response.status,
        ok: response.ok,
        body: text ? (JSON.parse(text) as T) : ({} as T),
      };
    },
    { requestPath: path, requestInit: init }
  );
}

test('admin observability matrix exposes production duty signals', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Observability matrix writes synthetic duty signals once per run.'
  );

  const issues = collectPageIssues(page);
  const seed = await createObservabilitySeed();

  await loginAsAdmin(page, 'en');

  const systemStatus = await fetchJson<{
    success?: boolean;
    data?: Array<{
      name: string;
      status: string;
      statusCode: string;
      latency: string;
      details?: Record<string, unknown>;
    }>;
  }>(page, '/api/admin/dashboard/system-status?mode=full');
  expect(systemStatus.ok, JSON.stringify(systemStatus.body)).toBe(true);
  expect(systemStatus.body.success).toBe(true);
  const serviceNames = new Set(systemStatus.body.data?.map((service) => service.name));
  for (const name of [
    'Database',
    'Runtime Reconcile',
    'Authentication',
    'API Gateway',
    'Outbox Store',
    'Webhook Receipts',
    'File Storage Metadata',
    'Plugin Registry',
  ]) {
    expect(serviceNames.has(name), `system-status should expose ${name}`).toBe(true);
  }
  for (const service of systemStatus.body.data ?? []) {
    expect(['operational', 'degraded', 'down']).toContain(service.status);
    expect(['ok', 'warning', 'error']).toContain(service.statusCode);
    expect(service.latency).toBeTruthy();
  }

  const auditLogs = await fetchJson<{
    success?: boolean;
    logs?: Array<{ action: string; resource: string; resourceId: string; status: string }>;
    pagination?: { total: number };
  }>(page, `/api/admin/audit-logs?resource=${seed.auditResource}&limit=20`);
  expect(auditLogs.ok, JSON.stringify(auditLogs.body)).toBe(true);
  expect(auditLogs.body.success).toBe(true);
  expect(auditLogs.body.pagination?.total).toBeGreaterThanOrEqual(1);
  expect(
    auditLogs.body.logs?.some(
      (log) =>
        log.action === 'observability.matrix' &&
        log.resource === seed.auditResource &&
        log.resourceId === seed.auditResourceId &&
        log.status === 'failure'
    )
  ).toBe(true);

  const auditStats = await fetchJson<{
    total?: number;
    success?: number;
    failure?: number;
    byResource?: Array<{ resource: string; count: number }>;
  }>(
    page,
    `/api/admin/audit-logs/stats?startDate=${encodeURIComponent(
      new Date(Date.now() - 5 * 60_000).toISOString()
    )}`
  );
  expect(auditStats.ok, JSON.stringify(auditStats.body)).toBe(true);
  expect(auditStats.body.total).toBeGreaterThanOrEqual(1);
  expect(auditStats.body.failure).toBeGreaterThanOrEqual(1);
  expect(auditStats.body.byResource?.some((row) => row.resource === seed.auditResource)).toBe(true);

  const edgeIngest = await fetchJson<{
    success?: boolean;
    received?: number;
    inserted?: number;
  }>(page, '/api/admin/edge-access-logs', {
    method: 'POST',
    body: {
      logs: [
        {
          source: 'observability-matrix',
          requestId: `ok-${randomUUID()}`,
          method: 'GET',
          path: seed.edgePath,
          statusCode: 200,
          durationMs: 12,
          userId: seed.userId,
          region: 'local',
          metadata: { source: 'playwright' },
        },
        {
          source: 'observability-matrix',
          requestId: `fail-${randomUUID()}`,
          method: 'POST',
          path: seed.failurePath,
          statusCode: 502,
          durationMs: 240,
          userId: seed.userId,
          region: 'local',
          metadata: { source: 'playwright' },
        },
      ],
    },
  });
  expect(edgeIngest.status, JSON.stringify(edgeIngest.body)).toBe(201);
  expect(edgeIngest.body.success).toBe(true);
  expect(edgeIngest.body.received).toBe(2);
  expect(edgeIngest.body.inserted).toBe(2);

  const edgeLogs = await fetchJson<{
    success?: boolean;
    logs?: Array<{ path: string; statusCode: number; failureType: string | null }>;
    stats?: {
      summary?: { total: number; failed: number; p95DurationMs: number };
      byFailureType?: Array<{ failureType: string; count: number }>;
      trend?: Array<{ day: string; total: number; failed: number }>;
    };
  }>(page, '/api/admin/edge-access-logs?days=1&failureType=upstream&limit=20');
  expect(edgeLogs.ok, JSON.stringify(edgeLogs.body)).toBe(true);
  expect(edgeLogs.body.success).toBe(true);
  expect(edgeLogs.body.stats?.summary?.failed).toBeGreaterThanOrEqual(1);
  expect(edgeLogs.body.stats?.summary?.p95DurationMs).toBeGreaterThanOrEqual(0);
  expect(edgeLogs.body.stats?.trend?.length).toBeGreaterThanOrEqual(1);
  expect(edgeLogs.body.stats?.byFailureType?.some((row) => row.failureType === 'upstream')).toBe(
    true
  );
  expect(
    edgeLogs.body.logs?.some(
      (log) =>
        log.path === seed.failurePath && log.statusCode === 502 && log.failureType === 'upstream'
    )
  ).toBe(true);

  const usage = await fetchJson<{
    success?: boolean;
    data?: {
      totalEvents: number;
      topMetrics: Array<{ key: string; total: number }>;
      topUsers: Array<{ userId: string; total: number }>;
      recentEvents: Array<{ key: string; value: number; userId: string }>;
    };
  }>(
    page,
    `/api/admin/entitlements/usage?days=1&metric=${encodeURIComponent(
      seed.metricKey
    )}&userId=${encodeURIComponent(seed.userId)}&limit=5`
  );
  expect(usage.ok, JSON.stringify(usage.body)).toBe(true);
  expect(usage.body.success).toBe(true);
  expect(usage.body.data?.totalEvents).toBeGreaterThanOrEqual(1);
  expect(
    usage.body.data?.topMetrics.some(
      (metric) => metric.key === seed.metricKey && metric.total >= seed.usageValue
    )
  ).toBe(true);
  expect(
    usage.body.data?.topUsers.some(
      (user) => user.userId === seed.userId && user.total >= seed.usageValue
    )
  ).toBe(true);
  expect(
    usage.body.data?.recentEvents.some(
      (event) =>
        event.key === seed.metricKey &&
        event.value === seed.usageValue &&
        event.userId === seed.userId
    )
  ).toBe(true);

  const reliability = await fetchJson<{
    success?: boolean;
    rangeDays?: number;
    reliability?: {
      outbox: { total: number; failed: number; failureRate: number; oldestFailedAt: string | null };
      webhooks: {
        total: number;
        deadLetter: number;
        retryAttempts: number;
        failedRetryAttempts: number;
        failureRate: number;
      };
      jobs: { total: number; deadLetter: number; failureRate: number };
      overall: { totalWorkItems: number; failedWorkItems: number; backlog: number };
      edgeAccess: {
        total: number;
        failed: number;
        failureRate: number;
        p95DurationMs: number;
        activeFailureTypeFilter: string | null;
        byFailureType: Array<{ failureType: string; count: number }>;
      };
      trend: Array<{ day: string; outboxFailed: number; webhookFailed: number; jobFailed: number }>;
    };
  }>(page, '/api/admin/analytics/reliability?days=1&failureType=upstream');
  expect(reliability.ok, JSON.stringify(reliability.body)).toBe(true);
  expect(reliability.body.success).toBe(true);
  expect(reliability.body.rangeDays).toBe(1);
  expect(reliability.body.reliability?.outbox.failed).toBeGreaterThanOrEqual(1);
  expect(reliability.body.reliability?.webhooks.deadLetter).toBeGreaterThanOrEqual(1);
  expect(reliability.body.reliability?.webhooks.retryAttempts).toBeGreaterThanOrEqual(1);
  expect(reliability.body.reliability?.webhooks.failedRetryAttempts).toBeGreaterThanOrEqual(1);
  expect(reliability.body.reliability?.jobs.deadLetter).toBeGreaterThanOrEqual(1);
  expect(reliability.body.reliability?.overall.failedWorkItems).toBeGreaterThanOrEqual(3);
  expect(reliability.body.reliability?.edgeAccess.activeFailureTypeFilter).toBe('upstream');
  expect(reliability.body.reliability?.edgeAccess.failed).toBeGreaterThanOrEqual(1);
  expect(reliability.body.reliability?.edgeAccess.p95DurationMs).toBeGreaterThanOrEqual(0);
  expect(
    reliability.body.reliability?.edgeAccess.byFailureType.some(
      (row) => row.failureType === 'upstream'
    )
  ).toBe(true);
  expect(reliability.body.reliability?.trend.length).toBeGreaterThanOrEqual(1);

  const edgeAuditLogs = await fetchJson<{
    success?: boolean;
    logs?: Array<{ action: string; resource: string; status: string }>;
  }>(page, '/api/admin/audit-logs?action=edge_access_log.ingest&limit=5');
  expect(edgeAuditLogs.ok, JSON.stringify(edgeAuditLogs.body)).toBe(true);
  expect(
    edgeAuditLogs.body.logs?.some(
      (log) =>
        log.action === 'edge_access_log.ingest' &&
        log.resource === 'edge_access_log' &&
        log.status === 'success'
    )
  ).toBe(true);

  await page.goto('/en/admin');
  await expect(page.getByText('System Status')).toBeVisible();
  await expect(page.getByText('Database')).toBeVisible();
  await expect(page.getByText('API Gateway')).toBeVisible();

  await page.goto('/en/admin/usage');
  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible();
  await page.getByLabel('Metric').fill(seed.metricKey);
  await page.getByLabel('User ID').fill(seed.userId);
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByTitle(seed.metricKey)).toBeVisible();

  await page.goto('/en/admin/analytics');
  await page.getByRole('tab', { name: 'Reliability' }).click();
  const reliabilityPanel = page.getByRole('tabpanel', { name: 'Reliability' });
  await expect(reliabilityPanel.getByText('Work Items', { exact: true })).toBeVisible();
  await expect(reliabilityPanel.getByText('Failure Trend', { exact: true })).toBeVisible();
  await expect(reliabilityPanel.getByText('Edge Access', { exact: true })).toBeVisible();
  await expect(reliabilityPanel.getByText('upstream', { exact: true })).toBeVisible();

  await issues.assertNoUnexpected(testInfo);
});
