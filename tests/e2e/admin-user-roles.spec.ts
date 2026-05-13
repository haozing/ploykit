import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { getDockerDatabaseUrl } from '../../scripts/docker-db-env';
import { loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

async function findUserRoleFixture() {
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });

  try {
    const rows = await sql<
      { userId: string; roleId: string; roleName: string; roleSlug: string }[]
    >`
      select u.id as "userId"
           , r.id as "roleId"
           , r.name as "roleName"
           , r.slug as "roleSlug"
      from "user" u
      join user_roles ur on ur.user_id = u.id
      join roles r on r.id = ur.role_id
      where r.slug = 'user'
      order by u."createdAt" desc
      limit 1
    `;
    return rows[0] ?? null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function roleAssignmentExists(userId: string, roleId: string) {
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });

  try {
    const rows = await sql<{ count: number }[]>`
      select count(*)::int as count
      from user_roles
      where user_id = ${userId}
        and role_id = ${roleId}
    `;
    return Number(rows[0]?.count ?? 0) > 0;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

test('admin can revoke and reassign a user role from the user detail page', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    'User detail role management mutates one seeded user role once.'
  );

  const fixture = await findUserRoleFixture();
  test.skip(!fixture, 'No seeded user role fixture is available.');

  const issues = collectPageIssues(page);

  await loginAsAdmin(page, 'en');
  await page.goto(`/en/admin/users/${fixture.userId}`);
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();

  await page.getByRole('tab', { name: 'Roles & Permissions' }).click();
  await expect(page.getByText('Manage Role', { exact: true })).toBeVisible();
  await expect(page.getByText('Current role', { exact: true })).toBeVisible();

  const revokeResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/admin/roles/${fixture.roleId}/revoke`) &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Revoke Role' }).click();
  expect((await revokeResponse).ok()).toBe(true);
  await expect(page.getByText('No role assigned')).toBeVisible();
  expect(await roleAssignmentExists(fixture.userId, fixture.roleId)).toBe(false);

  await page.getByRole('combobox').click();
  await page.getByRole('option', { name: `${fixture.roleName} (${fixture.roleSlug})` }).click();
  const assignResponse = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/admin/roles/${fixture.roleId}/assign`) &&
      response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'Assign Role' }).click();
  expect((await assignResponse).ok()).toBe(true);
  await expect(page.getByText(`Assigned ${fixture.roleName}.`)).toBeVisible();
  expect(await roleAssignmentExists(fixture.userId, fixture.roleId)).toBe(true);

  await issues.assertNoUnexpected(testInfo);
});
