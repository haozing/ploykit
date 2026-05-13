import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

import { getDockerDatabaseUrl } from '../../scripts/docker-db-env';
import { ADMIN_EMAIL, loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

interface NotificationSeed {
  id: string;
  subject: string;
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

async function createInAppNotification(
  userId: string,
  purpose: 'mark-read' | 'delete'
): Promise<NotificationSeed> {
  const id = `playwright_notification_${purpose}_${Date.now()}`;
  const subject = `Playwright notification ${purpose} ${Date.now()}`;
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });

  try {
    await sql`
      insert into notifications (
        id,
        user_id,
        type,
        channel,
        recipient,
        subject,
        body,
        status,
        metadata,
        sent_at,
        created_at,
        updated_at
      )
      values (
        ${id},
        ${userId},
        'playwright.notification.center',
        'in_app',
        ${ADMIN_EMAIL},
        ${subject},
        ${`Notification center browser smoke for ${purpose}.`},
        'sent',
        ${sql.json({ source: 'playwright', purpose })},
        now(),
        now(),
        now()
      )
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }

  return { id, subject };
}

async function readNotificationState(notificationId: string) {
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });

  try {
    const rows = await sql<{ read_at: Date | null }[]>`
      select read_at
      from notifications
      where id = ${notificationId}
      limit 1
    `;

    return rows[0] ?? null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function notificationCard(page: Page, subject: string) {
  return page
    .getByText(subject, { exact: true })
    .locator('xpath=ancestor::*[.//button[normalize-space()="Delete"]][1]');
}

test('user can manage notification center actions from the visible page', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Notification center browser smoke mutates temporary in-app notifications.'
  );

  const issues = collectPageIssues(page);
  const userId = await readAdminUserId();
  const markReadNotification = await createInAppNotification(userId, 'mark-read');
  const deleteNotification = await createInAppNotification(userId, 'delete');

  await loginAsAdmin(page, 'en');
  await page.goto('/en/notifications');

  await expect(page.getByRole('heading', { name: 'Notification Center' })).toBeVisible();
  const markReadCard = notificationCard(page, markReadNotification.subject);
  await expect(markReadCard).toBeVisible();
  await expect(markReadCard.getByText(markReadNotification.subject)).toBeVisible();

  const markReadResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/notifications/${markReadNotification.id}`) &&
      response.request().method() === 'PATCH'
  );
  await markReadCard.getByRole('button', { name: 'Mark Read' }).click();
  expect((await markReadResponse).ok()).toBe(true);
  await expect(page.getByText('Notification marked read.')).toBeVisible();
  expect((await readNotificationState(markReadNotification.id))?.read_at).not.toBeNull();

  const readAllResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/notifications/read-all') &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Mark All Read' }).click();
  expect((await readAllResponse).ok()).toBe(true);
  await expect(page.getByText(/Marked \d+ notifications read\./)).toBeVisible();
  expect((await readNotificationState(deleteNotification.id))?.read_at).not.toBeNull();

  const deleteCard = notificationCard(page, deleteNotification.subject);
  await expect(deleteCard).toBeVisible();
  const deleteResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/notifications/${deleteNotification.id}`) &&
      response.request().method() === 'DELETE'
  );
  await deleteCard.getByRole('button', { name: 'Delete' }).click();
  expect((await deleteResponse).ok()).toBe(true);
  await expect(page.getByText('Notification deleted.')).toBeVisible();
  await expect(page.getByText(deleteNotification.subject, { exact: true })).toHaveCount(0);
  expect(await readNotificationState(deleteNotification.id)).toBeNull();

  await issues.assertNoUnexpected(testInfo);
});
