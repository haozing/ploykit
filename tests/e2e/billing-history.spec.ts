import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

import { getDockerDatabaseUrl } from '../../scripts/docker-db-env';
import { ADMIN_EMAIL, loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

interface BillingHistorySeed {
  orderId: string;
  providerOrderId: string;
  creditLogId: string;
  creditReason: string;
}

interface CsvFetchResult {
  ok: boolean;
  status: number;
  contentType: string | null;
  text: string;
}

interface AuditLogFetchResult {
  ok: boolean;
  status: number;
  body: {
    logs?: Array<{
      action?: string;
      resource?: string;
      userId?: string;
      metadata?: Record<string, unknown> | null;
    }>;
  };
}

interface SubscriptionFetchResult {
  ok: boolean;
  status: number;
  body: {
    plan?: {
      name?: string;
      slug?: string;
      langJsonb?: Record<string, { name?: string }> | null;
    };
    status?: string;
    isActive?: boolean;
  };
}

async function readAdminUserId(): Promise<string> {
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });

  try {
    const rows = await sql<{ id: string }[]>`
      select id
      from "user"
      where email = ${ADMIN_EMAIL}
      limit 1
    `;
    const userId = rows[0]?.id;
    expect(userId, `Could not find seeded admin user ${ADMIN_EMAIL}`).toBeTruthy();
    return userId;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function createBillingHistorySeed(userId: string): Promise<BillingHistorySeed> {
  const orderId = randomUUID();
  const creditLogId = randomUUID();
  const providerOrderId = `playwright_order_${Date.now()}`;
  const creditReason = `Playwright credit grant ${Date.now()}`;
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });

  try {
    const plans = await sql<{ id: string }[]>`
      select id
      from entitlement_plans
      where slug = 'free'
      limit 1
    `;

    await sql`
      insert into orders (
        id,
        user_id,
        order_type,
        provider,
        provider_order_id,
        amount,
        currency,
        status,
        plan_id,
        metadata,
        created_at,
        updated_at
      )
      values (
        ${orderId},
        ${userId},
        'one_time_purchase',
        'playwright',
        ${providerOrderId},
        '45.67',
        'USD',
        'succeeded',
        ${plans[0]?.id ?? null},
        ${sql.json({ source: 'playwright' })},
        now(),
        now()
      )
    `;
    await sql`
      insert into credit_logs (
        id,
        user_id,
        log_type,
        change_amount,
        balance_after,
        reason,
        related_order_id,
        metadata,
        created_at
      )
      values (
        ${creditLogId},
        ${userId},
        'grant',
        4567,
        ${sql.json({ apiCallsRemaining: 4567 })},
        ${creditReason},
        ${orderId},
        ${sql.json({ source: 'playwright' })},
        now()
      )
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }

  return {
    orderId,
    providerOrderId,
    creditLogId,
    creditReason,
  };
}

async function fetchCsv(page: Page, path: string): Promise<CsvFetchResult> {
  return await page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath, { cache: 'no-store' });

    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get('content-type'),
      text: await response.text(),
    };
  }, path);
}

async function fetchSubscription(page: Page): Promise<SubscriptionFetchResult> {
  return await page.evaluate(async () => {
    const response = await fetch('/api/user/subscription', { cache: 'no-store' });
    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      body: text ? JSON.parse(text) : {},
    };
  });
}

async function fetchDataExportAuditLogs(page: Page): Promise<AuditLogFetchResult> {
  return await page.evaluate(async () => {
    const response = await fetch('/api/admin/audit-logs?action=data.export&limit=20', {
      cache: 'no-store',
    });
    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      body: text ? JSON.parse(text) : {},
    };
  });
}

test('user can inspect billing overview order and credit history pages', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Billing history browser smoke inserts temporary order and credit rows.'
  );

  const issues = collectPageIssues(page);
  const userId = await readAdminUserId();
  const seed = await createBillingHistorySeed(userId);

  await loginAsAdmin(page, 'en');

  await page.goto('/en/billing');
  await expect(page.getByRole('heading', { name: 'Billing & Subscription' })).toBeVisible();
  const subscription = await fetchSubscription(page);
  expect(subscription.ok, `Subscription API returned ${subscription.status}`).toBe(true);
  expect(subscription.body.isActive).toBe(true);
  expect(subscription.body.status).toBeTruthy();
  const planName =
    subscription.body.plan?.langJsonb?.en?.name || subscription.body.plan?.name || '';
  expect(planName).toBeTruthy();
  await expect(page.getByText('Current Plan', { exact: true })).toBeVisible();
  await expect(page.locator('main')).toContainText(planName);
  await expect(page.getByText('Billing Records', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View all orders' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Credit history' })).toBeVisible();
  await expect(page.locator('main')).toContainText('$45.67');

  await page.getByRole('link', { name: 'View all orders' }).click();
  await expect(page).toHaveURL(/\/en\/billing\/orders$/);
  await expect(page.getByRole('heading', { name: 'Order History' })).toBeVisible();
  const orderRow = page.locator('div.grid').filter({ hasText: '$45.67' }).first();
  await expect(orderRow).toBeVisible();
  await expect(orderRow.getByText('One-time Purchase', { exact: true })).toBeVisible();
  await expect(orderRow.getByText('$45.67', { exact: true })).toBeVisible();
  await expect(orderRow.getByText('Succeeded', { exact: true })).toBeVisible();

  const ordersCsv = await fetchCsv(page, '/api/user/orders?limit=100&format=csv');
  expect(ordersCsv.ok, `Orders CSV returned ${ordersCsv.status}`).toBe(true);
  expect(ordersCsv.contentType).toContain('text/csv');
  expect(ordersCsv.text).toMatch(/^# Exported orders for admin@example\.com \(.+\) at /);
  expect(ordersCsv.text).toContain('id,createdAt,orderType,status,amount,currency,provider,plan');
  expect(ordersCsv.text).toContain(seed.orderId);
  expect(ordersCsv.text).not.toContain(seed.providerOrderId);

  await page.goto('/en/billing');
  await page.getByRole('link', { name: 'Credit history' }).click();
  await expect(page).toHaveURL(/\/en\/billing\/credit-history$/);
  await expect(page.getByRole('heading', { name: 'Credit History' })).toBeVisible();
  const creditCard = page
    .getByText(seed.creditReason, { exact: true })
    .locator('xpath=ancestor::*[.//*[normalize-space()="+4,567"]][1]');
  await expect(creditCard).toBeVisible();
  await expect(creditCard.getByText(seed.creditReason, { exact: true })).toBeVisible();
  await expect(creditCard.getByText('+4,567')).toBeVisible();
  await expect(creditCard.getByText('4,567 API calls')).toBeVisible();

  const creditCsv = await fetchCsv(page, '/api/user/credit-history?limit=100&format=csv');
  expect(creditCsv.ok, `Credit CSV returned ${creditCsv.status}`).toBe(true);
  expect(creditCsv.contentType).toContain('text/csv');
  expect(creditCsv.text).toMatch(/^# Exported credit-history for admin@example\.com \(.+\) at /);
  expect(creditCsv.text).toContain(
    'id,createdAt,logType,changeAmount,balanceAfter,reason,relatedOrderId'
  );
  expect(creditCsv.text).toContain(seed.creditLogId);

  const exportAudits = await fetchDataExportAuditLogs(page);
  expect(exportAudits.ok, `Audit log API returned ${exportAudits.status}`).toBe(true);
  const auditResources = [...new Set(exportAudits.body.logs?.map((log) => log.resource))];
  expect(auditResources).toEqual(expect.arrayContaining(['orders', 'credit_history']));
  for (const resource of ['orders', 'credit_history']) {
    const matching = exportAudits.body.logs?.find((log) => log.resource === resource);
    expect(matching).toBeTruthy();
    expect(matching?.action).toBe('data.export');
    expect(matching?.metadata?.watermark).toEqual(expect.stringContaining('Exported'));
  }

  await issues.assertNoUnexpected(testInfo);
});
