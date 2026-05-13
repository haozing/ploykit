import { expect, test } from '@playwright/test';

import { loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

test('admin can inspect the plugin dev console without mojibake', async ({ page }, testInfo) => {
  const issues = collectPageIssues(page);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

  await loginAsAdmin(page, 'en');

  await page.goto('/en/admin/plugins/dev');
  await expect(page.getByRole('heading', { name: 'Plugin Dev Console' })).toBeVisible();
  await expect(page.getByText('Runtime Reconcile')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sample Internal' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy diagnostics' })).toBeVisible();

  await page.getByRole('button', { name: 'Copy diagnostics' }).click();
  await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const copiedPayload = JSON.parse(copied) as {
    generatedAt?: string;
    summary?: { totalPlugins?: number };
    diagnostics?: unknown[];
  };
  expect(copiedPayload.generatedAt).toBeTruthy();
  expect(copiedPayload.summary?.totalPlugins).toBeGreaterThan(0);
  expect(Array.isArray(copiedPayload.diagnostics)).toBe(true);

  const visibleText = await page.locator('main').innerText();
  expect(visibleText).not.toMatch(/鈥|鈺|馃|鏄|鍗|鎿|莽|聝|聽|茅|卯|鉁|笍/);

  await issues.assertNoUnexpected(testInfo);
});
