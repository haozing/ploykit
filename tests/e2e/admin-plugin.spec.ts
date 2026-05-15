import { expect, test, type Page } from '@playwright/test';
import { ensureSamplePluginEnabled, loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

const SAMPLE_PLUGIN_NOTES_API = '/api/plugins/sample-internal/notes/playwright-project';

async function readSamplePluginState(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/admin/plugins');
    const body = await response.json();
    return body.plugins?.find((plugin: { id?: string }) => plugin.id === 'sample-internal');
  });
}

test('admin can reach plugin management and use the sample plugin runtime', async ({
  page,
}, testInfo) => {
  const issues = collectPageIssues(page);

  await loginAsAdmin(page);
  await ensureSamplePluginEnabled(page);

  const dashboardStatusResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/dashboard/system-status') &&
      response.request().method() === 'GET'
  );
  await page.goto('/zh/admin');
  await expect(page).toHaveURL(/\/zh\/admin$/);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  expect((await dashboardStatusResponse).ok()).toBe(true);

  await page.goto('/zh/admin/plugins');
  await expect(page.getByText('Sample Internal')).toBeVisible();

  await page.goto('/zh/plugins/sample-internal');
  await expect(page.getByRole('heading', { name: 'Sample Internal' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Notes' })).toBeVisible();

  const roundTrip = await page.evaluate(async (notesApi) => {
    const stamp = new Date().toISOString();
    const create = await fetch(notesApi, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: `Codex Playwright smoke ${stamp}`,
        status: 'open',
        body: 'created by Playwright E2E',
      }),
    });
    const created = await create.json();
    const list = await fetch(notesApi);
    const listed = await list.json();

    return {
      createStatus: create.status,
      listStatus: list.status,
      noteId: created.note?.id,
      returnedCreated: Array.isArray(listed.notes)
        ? listed.notes.some((note: { id?: string }) => note.id === created.note?.id)
        : false,
    };
  }, SAMPLE_PLUGIN_NOTES_API);

  expect(roundTrip.createStatus).toBe(201);
  expect(roundTrip.listStatus).toBe(200);
  expect(roundTrip.noteId).toBeTruthy();
  expect(roundTrip.returnedCreated).toBe(true);

  await issues.assertNoUnexpected(testInfo);
});

test('admin can manage the sample plugin lifecycle from the visible page', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Plugin lifecycle browser smoke mutates the sample plugin installation.'
  );

  const issues = collectPageIssues(page);

  await loginAsAdmin(page, 'en');
  await ensureSamplePluginEnabled(page);
  await page.goto('/en/admin/plugins');

  let sampleCard = page.getByRole('article', { name: 'Sample Internal plugin' });
  await expect(sampleCard.getByText('Enabled')).toBeVisible();

  await sampleCard.getByRole('button', { name: 'Disable' }).click();
  const disableResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/plugins/sample-internal/disable') &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Confirm' }).click();
  expect((await disableResponse).ok()).toBe(true);
  await expect(page.getByText('Disabled')).toBeVisible();

  sampleCard = page.getByRole('article', { name: 'Sample Internal plugin' });
  await sampleCard.getByRole('button', { name: 'Uninstall' }).click();
  const uninstallResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/plugins/sample-internal/uninstall') &&
      response.request().method() === 'DELETE'
  );
  await page.getByRole('button', { name: 'Confirm Uninstall' }).click();
  expect((await uninstallResponse).ok()).toBe(true);
  await expect(page.getByText('Not Installed')).toBeVisible();

  sampleCard = page.getByRole('article', { name: 'Sample Internal plugin' });
  await sampleCard.getByRole('button', { name: 'Install' }).click();
  const installResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/plugins/sample-internal/install') &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Confirm Install' }).click();
  expect((await installResponse).ok()).toBe(true);
  await expect(page.getByText('Disabled')).toBeVisible();

  sampleCard = page.getByRole('article', { name: 'Sample Internal plugin' });
  await sampleCard.getByRole('button', { name: 'Enable' }).click();
  const enableResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/admin/plugins/sample-internal/enable') &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Confirm' }).click();
  expect((await enableResponse).ok()).toBe(true);
  await expect(page.getByText('Enabled')).toBeVisible();

  const finalState = await readSamplePluginState(page);
  expect(finalState?.installed).toBe(true);
  expect(finalState?.enabled).toBe(true);

  await issues.assertNoUnexpected(testInfo);
});
