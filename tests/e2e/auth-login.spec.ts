import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

test('admin can sign in through the visible login form', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Password login smoke runs once to avoid local auth rate limits.'
  );

  const issues = collectPageIssues(page);
  await page.route('**/api/auth/sign-in/email', async (route) => {
    await route.continue({
      headers: {
        ...route.request().headers(),
        'x-forwarded-for': '127.0.0.240',
      },
    });
  });

  await page.goto('/zh/admin', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/zh\/login\?callbackUrl=%2Fzh%2Fadmin/);
  await expect(page.locator('button[data-auth-ready="true"]')).toBeVisible();

  await page.getByTestId('login-email').fill(ADMIN_EMAIL);
  await page.getByTestId('login-password').fill(ADMIN_PASSWORD);
  await page.locator('button[data-auth-ready="true"]').click();

  await expect(page).toHaveURL(/\/zh\/admin$/);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();

  const profile = await page.evaluate(async () => {
    const response = await fetch('/api/user/profile');
    const body = await response.json();

    return {
      ok: response.ok,
      status: response.status,
      email: body.profile?.email,
      body,
    };
  });

  expect(profile, JSON.stringify(profile.body)).toMatchObject({
    ok: true,
    status: 200,
    email: ADMIN_EMAIL,
  });

  await page.reload();
  await expect(page).toHaveURL(/\/zh\/admin$/);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();

  await issues.assertNoUnexpected(testInfo);
});
