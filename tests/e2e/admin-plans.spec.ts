import { expect, test, type Page } from '@playwright/test';

import { loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

interface PlanRecord {
  id: string;
  name: string;
  slug: string;
  pricing?: {
    monthly?: number;
    yearly?: number;
  };
  limits?: {
    monthly?: Record<string, number>;
    yearly?: Record<string, number>;
  };
}

async function deletePlansBySlug(page: Page, slug: string): Promise<void> {
  const result = await page.evaluate(async (targetSlug) => {
    const response = await fetch('/api/admin/entitlements/plans', { cache: 'no-store' });
    if (!response.ok) {
      return { ok: false, status: response.status, error: 'list failed' };
    }

    const body = (await response.json()) as { data?: PlanRecord[] };
    const plans = (body.data ?? []).filter((plan) => plan.slug === targetSlug);

    for (const plan of plans) {
      const deleted = await fetch(`/api/admin/entitlements/plans/${plan.id}`, {
        method: 'DELETE',
      });
      if (!deleted.ok) {
        return { ok: false, status: deleted.status, error: `delete failed for ${plan.id}` };
      }
    }

    return { ok: true };
  }, slug);

  expect(result, JSON.stringify(result)).toMatchObject({ ok: true });
}

async function readPlanBySlug(page: Page, slug: string): Promise<PlanRecord | null> {
  return page.evaluate(async (targetSlug) => {
    const response = await fetch('/api/admin/entitlements/plans', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Plan list failed with ${response.status}`);
    }

    const body = (await response.json()) as { data?: PlanRecord[] };
    return (body.data ?? []).find((plan) => plan.slug === targetSlug) ?? null;
  }, slug);
}

test('admin can create edit and delete a plan from the visible page', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Plan management browser smoke mutates persisted plans once.'
  );

  const issues = collectPageIssues(page);
  const suffix = Date.now().toString(36);
  const slug = `browser-plan-${suffix}`;
  const initialName = `Browser Plan ${suffix}`;
  const updatedName = `${initialName} Updated`;

  await loginAsAdmin(page, 'en');
  await deletePlansBySlug(page, slug);

  await page.goto('/en/admin/entitlements');
  await expect(page.getByRole('heading', { name: 'Subscription Plans' })).toBeVisible();

  await page.getByRole('button', { name: 'Create Plan' }).click();
  const createDialog = page.getByRole('dialog', { name: 'Create Plan' });
  await expect(createDialog).toBeVisible();
  await createDialog.getByLabel('Name').fill(initialName);
  await createDialog.getByLabel('Slug').fill(slug);

  await createDialog.getByRole('tab', { name: 'Pricing' }).click();
  await createDialog.getByLabel('Monthly Price').fill('12');
  await createDialog.getByLabel('Yearly Price').fill('120');

  await createDialog.getByRole('tab', { name: 'Limits' }).click();
  await createDialog.getByRole('button', { name: 'Add' }).click();
  await createDialog.getByLabel('Key').fill('browser.plan.calls');
  await createDialog.getByLabel('Monthly').fill('100');
  await createDialog.getByLabel('Yearly').fill('1200');

  const createResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/entitlements/plans') &&
      response.request().method() === 'POST'
  );
  await createDialog.getByRole('button', { name: 'Create' }).click();
  expect((await createResponse).ok()).toBe(true);
  await expect(page.getByText(initialName)).toBeVisible();

  const createdPlan = await readPlanBySlug(page, slug);
  expect(createdPlan?.name).toBe(initialName);
  expect(createdPlan?.pricing?.monthly).toBe(12);
  expect(createdPlan?.limits?.monthly?.['browser.plan.calls']).toBe(100);

  let row = page.getByRole('row').filter({ hasText: initialName });
  await row.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'Edit Plan' }).click();

  const editDialog = page.getByRole('dialog', { name: 'Edit Plan' });
  await expect(editDialog).toBeVisible();
  await editDialog.getByLabel('Name').fill(updatedName);
  await editDialog.getByRole('tab', { name: 'Pricing' }).click();
  await editDialog.getByLabel('Monthly Price').fill('18');

  const updateResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/entitlements/plans/') &&
      response.request().method() === 'PUT'
  );
  await editDialog.getByRole('button', { name: 'Update' }).click();
  expect((await updateResponse).ok()).toBe(true);
  await expect(page.getByText(updatedName)).toBeVisible();

  const updatedPlan = await readPlanBySlug(page, slug);
  expect(updatedPlan?.name).toBe(updatedName);
  expect(updatedPlan?.pricing?.monthly).toBe(18);

  row = page.getByRole('row').filter({ hasText: updatedName });
  await row.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('menuitem', { name: 'Delete Plan' }).click();

  const deleteDialog = page.getByRole('alertdialog', { name: 'Delete Plan' });
  await expect(deleteDialog).toBeVisible();
  const deleteResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/entitlements/plans/') &&
      response.request().method() === 'DELETE'
  );
  await deleteDialog.getByRole('button', { name: 'Delete' }).click();
  expect((await deleteResponse).ok()).toBe(true);
  await expect(page.getByText(updatedName)).toBeHidden();
  expect(await readPlanBySlug(page, slug)).toBeNull();

  await issues.assertNoUnexpected(testInfo);
});
