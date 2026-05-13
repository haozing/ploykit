import { expect, test } from '@playwright/test';

import { loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

test('admin can edit and save system settings from the page', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Settings browser smoke mutates persisted platform settings once.'
  );

  const issues = collectPageIssues(page);
  const siteName = `Ploykit Browser ${Date.now()}`;

  await loginAsAdmin(page, 'en');

  await page.goto('/en/admin/settings');
  await expect(page.getByRole('heading', { name: 'System Settings' })).toBeVisible();

  await page.getByLabel('Site Name').fill(siteName);
  await page.getByLabel('Support Email').fill('browser-support@example.com');
  await page.getByLabel('Session Max Age').fill('60');
  await page.getByLabel('Password Min Length').fill('12');

  const emailSwitch = page.getByRole('switch', { name: 'Email', exact: true });
  if ((await emailSwitch.getAttribute('aria-checked')) !== 'true') {
    await emailSwitch.click();
  }

  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/settings') && response.request().method() === 'PUT'
  );
  await page.getByRole('button', { name: 'Save' }).click();
  expect((await saveResponse).ok()).toBe(true);
  await expect(page.getByText('System settings saved.')).toBeVisible();

  const readBack = await page.evaluate(async () => {
    const response = await fetch('/api/admin/settings', { cache: 'no-store' });
    return {
      ok: response.ok,
      body: await response.json(),
    };
  });

  expect(readBack.ok).toBe(true);
  expect(readBack.body.data.general.siteName).toBe(siteName);
  expect(readBack.body.data.general.supportEmail).toBe('browser-support@example.com');
  expect(readBack.body.data.security.sessionMaxAgeDays).toBe(60);
  expect(readBack.body.data.security.passwordMinLength).toBe(12);
  expect(readBack.body.data.notifications.emailEnabled).toBe(true);

  await issues.assertNoUnexpected(testInfo);
});
