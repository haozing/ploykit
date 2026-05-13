import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { getDockerDatabaseUrl } from '../../scripts/docker-db-env';
import { ADMIN_EMAIL, loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

interface UsageSeed {
  userId: string;
  metricKey: string;
  value: number;
}

async function createUsageSeed(): Promise<UsageSeed> {
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });
  const pluginId = 'playwright';
  const metric = `usage${Date.now()}`;
  const value = 789;

  try {
    const users = await sql<{ id: string }[]>`
      select id
      from "user"
      where email = ${ADMIN_EMAIL}
      limit 1
    `;
    const userId = users[0]?.id;
    expect(userId, `Could not find seeded admin user ${ADMIN_EMAIL}`).toBeTruthy();

    await sql`
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
        ${`playwright-usage-${Date.now()}-${randomUUID()}`},
        ${userId},
        ${pluginId},
        ${metric},
        ${value},
        'count',
        ${sql.json({ source: 'playwright' })},
        now()
      )
    `;

    return {
      userId,
      metricKey: `${pluginId}.${metric}`,
      value,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test('admin can inspect and filter platform usage from the visible page', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Admin usage browser smoke inserts one temporary usage event.'
  );

  const issues = collectPageIssues(page);
  const seed = await createUsageSeed();

  await loginAsAdmin(page, 'en');
  await page.goto('/en/admin/usage');

  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible();
  await expect(page.getByText('Top Metrics')).toBeVisible();
  await expect(page.getByText('Recent Events')).toBeVisible();
  await expect(page.getByTitle(seed.metricKey)).toBeVisible();
  const recentRow = page.getByRole('row').filter({ hasText: seed.metricKey }).first();
  await expect(recentRow).toBeVisible();
  await expect(recentRow.getByText(`${seed.value} count`, { exact: true })).toBeVisible();

  await page.getByLabel('Metric').fill(seed.metricKey);
  await page.getByLabel('User ID').fill(seed.userId);
  const filteredResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/entitlements/usage') &&
      response.url().includes(`metric=${encodeURIComponent(seed.metricKey)}`) &&
      response.url().includes(`userId=${encodeURIComponent(seed.userId)}`) &&
      response.request().method() === 'GET'
  );
  await page.getByRole('button', { name: 'Apply' }).click();
  expect((await filteredResponse).ok()).toBe(true);
  await expect(page.getByTitle(seed.metricKey)).toBeVisible();
  const filteredRow = page.getByRole('row').filter({ hasText: seed.metricKey }).first();
  await expect(filteredRow).toBeVisible();
  await expect(filteredRow.getByText(`${seed.value} count`, { exact: true })).toBeVisible();

  await issues.assertNoUnexpected(testInfo);
});
