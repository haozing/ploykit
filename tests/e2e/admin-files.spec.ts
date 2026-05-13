import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { getDockerDatabaseUrl } from '../../scripts/docker-db-env';
import { loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

async function readFileRow(fileName: string) {
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });

  try {
    const rows = await sql<{ id: string }[]>`
      select id
      from files
      where original_name = ${fileName}
        and delete_status = 'active'
      order by created_at desc
      limit 1
    `;
    return rows[0] ?? null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function countActiveFile(fileId: string) {
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });

  try {
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count
      from files
      where id = ${fileId}
        and delete_status = 'active'
    `;
    return Number(rows[0]?.count ?? 0);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test('admin can search download and delete a platform file', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'Admin file browser smoke mutates one temporary file.'
  );

  const issues = collectPageIssues(page);
  const fileName = `playwright-admin-file-${Date.now()}.txt`;

  await loginAsAdmin(page, 'en');

  const uploadResult = await page.evaluate(
    async ({ name }) => {
      const form = new FormData();
      form.set('file', new File(['admin file browser smoke'], name, { type: 'text/plain' }));
      const response = await fetch('/api/admin/files', {
        method: 'POST',
        body: form,
      });

      return {
        ok: response.ok,
        status: response.status,
        text: await response.text(),
      };
    },
    { name: fileName }
  );
  expect(uploadResult.ok, uploadResult.text).toBe(true);

  const fileRow = await readFileRow(fileName);
  expect(fileRow?.id).toBeTruthy();

  await page.goto('/en/admin/files');
  await expect(page.getByRole('heading', { name: 'File Management' })).toBeVisible();

  await page.getByPlaceholder('Search files').fill(fileName);
  await page.getByLabel('Owner or Email').fill('admin@example.com');
  await page.getByLabel('MIME Type').fill('text/plain');
  await page.getByLabel('Min Size MB').fill('0');
  await page.getByLabel('Max Size MB').fill('1');
  const row = page.getByRole('row').filter({ hasText: fileName });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: `File actions for ${fileName}` }).click();
  const downloadResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/admin/files/${fileRow.id}?download=true`) &&
      response.request().method() === 'GET'
  );
  await page.getByRole('menuitem', { name: 'Download' }).click();
  expect((await downloadResponse).ok()).toBe(true);

  await row.getByRole('button', { name: `File actions for ${fileName}` }).click();
  page.once('dialog', (dialog) => dialog.accept());
  const deleteResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/admin/files/${fileRow.id}`) &&
      response.request().method() === 'DELETE'
  );
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  expect((await deleteResponse).ok()).toBe(true);
  await expect(page.getByText(fileName)).toHaveCount(0);
  expect(await countActiveFile(fileRow.id)).toBe(0);

  await issues.assertNoUnexpected(testInfo);
});
