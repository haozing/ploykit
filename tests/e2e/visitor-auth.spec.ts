import { expect, test } from '@playwright/test';
import { collectPageIssues } from './fixtures/page-issues';

test('visitor pages and protected routes behave correctly', async ({ page }, testInfo) => {
  const issues = collectPageIssues(page);

  const englishHome = await page.goto('/en');
  expect(englishHome?.ok()).toBe(true);
  await expect(page.getByText('Welcome to PloyKit')).toBeVisible();

  const chineseHome = await page.goto('/zh');
  expect(chineseHome?.ok()).toBe(true);
  await expect(page.getByRole('link', { name: 'PloyKit' })).toBeVisible();

  await page.goto('/en/admin');
  await expect(page).toHaveURL(/\/login/);

  await page.goto('/zh/plugins/sample-internal');
  await expect(page).toHaveURL(/\/zh\/login\?callbackUrl=/);

  await issues.assertNoUnexpected(testInfo);
});
