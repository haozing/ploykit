import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';

import { getDockerDatabaseUrl } from '../../scripts/docker-db-env';
import { loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

async function createRetryableWebhookReceipt() {
  const receiptId = randomUUID();
  const eventId = `evt_playwright_retry_${Date.now()}`;
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });

  try {
    await sql`
      insert into webhook_logs (
        id,
        provider,
        event_id,
        event_type,
        payload,
        headers,
        status,
        retry_count,
        error,
        created_at,
        updated_at
      )
      values (
        ${receiptId},
        'custom',
        ${eventId},
        'playwright.retry.detail',
        ${sql.json({ id: eventId, type: 'playwright.retry.detail' })},
        ${sql.json({})},
        'failed',
        0,
        'Playwright retry detail smoke',
        now(),
        now()
      )
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }

  return { receiptId, eventId };
}

async function createOutboxDeadLetter() {
  const entryId = `playwright_outbox_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });

  try {
    await sql`
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
        ${entryId},
        'playwright.outbox.dead_letter',
        ${sql.json({ smoke: true })},
        ${sql.json({
          emitterId: 'playwright-smoke',
          eventId: entryId,
          correlationId: entryId,
          timestamp: new Date().toISOString(),
        })},
        'failed',
        3,
        3,
        'Playwright forced outbox dead letter',
        now(),
        now(),
        now()
      )
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }

  return entryId;
}

test('admin can replay an outbox dead letter from operations', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Operations mutation smoke runs once because it writes outbox records.'
  );

  const issues = collectPageIssues(page);
  const entryId = await createOutboxDeadLetter();

  await loginAsAdmin(page);

  await page.goto('/zh/admin/operations');
  await expect(page.getByRole('heading', { name: 'Operations Center' })).toBeVisible();
  await page.getByRole('tab', { name: 'Outbox' }).click();
  await expect(page.getByText(entryId)).toBeVisible();
  await expect(page.getByText('Playwright forced outbox dead letter')).toBeVisible();

  const replayResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/admin/outbox/dead-letters/${entryId}`) &&
      response.request().method() === 'POST'
  );
  const row = page.getByRole('row').filter({ hasText: entryId });
  await row.getByRole('button', { name: 'Replay' }).click();
  expect((await replayResponse).ok()).toBe(true);
  await expect(page.getByText(`Outbox entry ${entryId} queued for replay.`)).toBeVisible();

  await issues.assertNoUnexpected(testInfo);
});

test('admin can inspect and retry a webhook receipt from operations', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Operations mutation smoke runs once because it writes retry records.'
  );

  const issues = collectPageIssues(page);
  const { receiptId, eventId } = await createRetryableWebhookReceipt();

  await loginAsAdmin(page);

  await page.goto('/zh/admin/operations');
  await expect(page.getByRole('heading', { name: 'Operations Center' })).toBeVisible();
  await page.getByRole('tab', { name: 'Webhooks' }).click();
  await expect(page.getByText(eventId)).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: eventId });
  await row.getByRole('button', { name: 'Detail' }).click();
  const dialog = page.getByRole('dialog', { name: 'Webhook Receipt Detail' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(receiptId)).toBeVisible();
  await expect(dialog.getByText('Playwright retry detail smoke')).toBeVisible();

  const retryResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/admin/webhooks/retry/${receiptId}`) &&
      response.request().method() === 'POST'
  );
  await dialog.getByRole('button', { name: 'Retry Receipt' }).click();
  expect((await retryResponse).ok()).toBe(true);
  await expect(page.getByText(new RegExp(`Webhook receipt ${receiptId}`))).toBeVisible();
  await expect(dialog.getByText('Retry History')).toBeVisible();

  await issues.assertNoUnexpected(testInfo);
});
