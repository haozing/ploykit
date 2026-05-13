import { expect, test } from '@playwright/test';

import { loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

test('admin dashboard renders real system status probes', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Dashboard system status smoke waits for admin-only health probes.'
  );

  const issues = collectPageIssues(page);

  await loginAsAdmin(page, 'en');

  const statusResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/dashboard/system-status') &&
      response.request().method() === 'GET'
  );
  await page.goto('/en/admin');
  expect((await statusResponse).ok()).toBe(true);

  await expect(page.getByText('System Status')).toBeVisible();
  await expect(page.getByText('Database')).toBeVisible();
  await expect(page.getByText('Runtime Reconcile')).toBeVisible();
  await expect(page.getByText('Authentication')).toBeVisible();
  await expect(page.getByText('API Gateway')).toBeVisible();
  await expect(page.getByText('Plugin Registry')).toBeVisible();

  await issues.assertNoUnexpected(testInfo);
});
