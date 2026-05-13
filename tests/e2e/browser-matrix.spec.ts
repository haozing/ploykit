import { expect, test } from '@playwright/test';
import { ensureSamplePluginEnabled, loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

test.describe('browser compatibility matrix', () => {
  test('opens core public, user, admin, and plugin pages without browser-specific failures', async ({
    page,
  }, testInfo) => {
    const issues = collectPageIssues(page);

    await page.goto('/en', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /PloyKit/ }).first()).toBeVisible();

    await page.goto('/en/json', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'JSON Formatter' })).toBeVisible();

    await page.goto('/en/tools/pdf-ocr', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'PDF OCR Demo' })).toBeVisible();

    await loginAsAdmin(page, 'en');
    await ensureSamplePluginEnabled(page);

    await page.goto('/en/profile', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('main')).toContainText('Profile');
    await expect(page.getByLabel('Name')).toBeVisible();

    await page.goto('/en/billing', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('main')).toContainText('Billing & Subscription');

    await page.goto('/en/admin', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.goto('/en/admin/plugins', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Plugin Management' })).toBeVisible();

    await page.goto('/en/admin/plugins/sample-internal', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sample Internal' })).toBeVisible();

    await issues.assertNoUnexpected(testInfo);
  });
});
