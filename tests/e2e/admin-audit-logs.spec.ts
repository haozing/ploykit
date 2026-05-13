import { expect, test } from '@playwright/test';

import { loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

test('admin can export audit logs from the visible page', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Audit export browser smoke runs once because it opens download targets.'
  );

  const issues = collectPageIssues(page);

  await loginAsAdmin(page, 'en');

  await page.goto('/en/admin/audit-logs');
  await expect(page.getByRole('heading', { name: 'Audit Logs' })).toBeVisible();

  await page.evaluate(() => {
    const targetWindow = window as Window & { __auditExportUrls?: string[] };
    targetWindow.__auditExportUrls = [];
    window.open = (url) => {
      targetWindow.__auditExportUrls?.push(String(url));
      return null;
    };
  });

  await page.getByRole('button', { name: 'Export CSV' }).click();
  await page.getByRole('button', { name: 'Export JSON' }).click();

  const openedUrls = await page.evaluate(
    () => (window as Window & { __auditExportUrls?: string[] }).__auditExportUrls ?? []
  );
  expect(openedUrls).toEqual(
    expect.arrayContaining([
      expect.stringContaining('/api/admin/audit-logs/export?format=csv'),
      expect.stringContaining('/api/admin/audit-logs/export?format=json'),
    ])
  );

  const csvUrl = openedUrls.find((url) => url.includes('format=csv'));
  const jsonUrl = openedUrls.find((url) => url.includes('format=json'));
  expect(csvUrl).toBeTruthy();
  expect(jsonUrl).toBeTruthy();

  const csvResponse = await page.request.get(csvUrl!);
  expect(csvResponse.ok()).toBe(true);
  expect(csvResponse.headers()['content-type']).toContain('text/csv');
  await expect
    .poll(async () => await csvResponse.text())
    .toMatch(/^# Exported for .+\n(id,createdAt,userId|No data to export)/);

  const jsonResponse = await page.request.get(jsonUrl!);
  expect(jsonResponse.ok()).toBe(true);
  expect(jsonResponse.headers()['content-type']).toContain('application/json');
  const jsonBody = (await jsonResponse.json()) as {
    watermark?: string;
    exportedAt?: string;
    logs?: unknown[];
  };
  expect(jsonBody.watermark).toContain('Exported for');
  expect(jsonBody.exportedAt).toBeTruthy();
  expect(Array.isArray(jsonBody.logs)).toBe(true);

  await issues.assertNoUnexpected(testInfo);
});
