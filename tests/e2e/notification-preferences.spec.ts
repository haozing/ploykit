import { expect, test } from '@playwright/test';

import { loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

test('user can save notification preferences and send a test notification', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Notification preferences browser smoke mutates the signed-in user preferences.'
  );

  const issues = collectPageIssues(page);

  await loginAsAdmin(page, 'en');
  await page.goto('/en/settings/notifications');

  await expect(page.getByRole('heading', { name: 'Notification Preferences' })).toBeVisible();

  const inAppSwitch = page.getByRole('switch', { name: 'Enable in-app notifications' });
  if ((await inAppSwitch.getAttribute('aria-checked')) !== 'true') {
    await inAppSwitch.click();
  }

  const emailSwitch = page.getByRole('switch', { name: 'Enable email notifications' });
  if ((await emailSwitch.getAttribute('aria-checked')) !== 'false') {
    await emailSwitch.click();
  }

  const saveResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/notifications/preferences') &&
      response.request().method() === 'PUT'
  );
  await page.getByRole('button', { name: 'Save Settings' }).click();
  expect((await saveResponse).ok()).toBe(true);
  await expect(page.getByText('Notification settings saved.')).toBeVisible();

  const preferences = await page.evaluate(async () => {
    const response = await fetch('/api/notifications/preferences', { cache: 'no-store' });
    return response.json();
  });
  expect(preferences.preferences.inAppEnabled).toBe(true);
  expect(preferences.preferences.emailEnabled).toBe(false);

  const testResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/notifications/test') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Send Test Notification' }).click();
  expect((await testResponse).ok()).toBe(true);
  await expect(page.getByText('Test notification sent.')).toBeVisible();

  await issues.assertNoUnexpected(testInfo);
});
