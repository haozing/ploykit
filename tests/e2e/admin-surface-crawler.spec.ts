import { expect, test, type Page } from '@playwright/test';

import {
  ADMIN_PAGES,
  type AdminPageCatalogEntry,
  type AdminPageResolver,
} from './admin/admin-page-catalog';
import {
  adminSurfaceArtifactPath,
  collectAdminInteractivesByRole,
  collectAdminInteractives,
  createAdminApiResponseCollector,
  ensureAdminSurfaceOutputDir,
  type AdminDisclosureProbe,
  writeAdminSurfaceReport,
} from './admin/admin-surface-report';
import { ensureSamplePluginEnabled, loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

test.describe.configure({ timeout: 90_000 });

interface BrowserFetchResult<TBody> {
  status: number;
  ok: boolean;
  body: TBody;
}

const SAMPLE_PLUGIN_ID = 'sample-internal';

async function browserFetchJson<TBody>(
  page: Page,
  path: string
): Promise<BrowserFetchResult<TBody>> {
  return page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath);
    const text = await response.text();

    return {
      status: response.status,
      ok: response.ok,
      body: text ? (JSON.parse(text) as TBody) : ({} as TBody),
    };
  }, path);
}

async function resolveFirstUser(page: Page): Promise<string> {
  const response = await browserFetchJson<{ users?: Array<{ id?: string }> }>(
    page,
    '/api/admin/users?limit=1'
  );

  expect(response.ok, `GET /api/admin/users returned ${response.status}`).toBe(true);

  const id = response.body.users?.[0]?.id;
  expect(id, 'Expected at least one user for admin surface detail page').toBeTruthy();
  return id!;
}

async function resolveFirstRole(page: Page): Promise<string> {
  const response = await browserFetchJson<{ roles?: Array<{ id?: string }> }>(
    page,
    '/api/admin/roles?limit=1'
  );

  expect(response.ok, `GET /api/admin/roles returned ${response.status}`).toBe(true);

  const id = response.body.roles?.[0]?.id;
  expect(id, 'Expected at least one role for admin surface detail page').toBeTruthy();
  return id!;
}

async function resolveFirstPlan(page: Page): Promise<string> {
  const response = await browserFetchJson<{ data?: Array<{ id?: string }> }>(
    page,
    '/api/admin/entitlements/plans'
  );

  expect(response.ok, `GET /api/admin/entitlements/plans returned ${response.status}`).toBe(true);

  const id = response.body.data?.[0]?.id;
  expect(id, 'Expected at least one plan for admin surface detail page').toBeTruthy();
  return id!;
}

async function resolveAdminPagePath(page: Page, entry: AdminPageCatalogEntry): Promise<string> {
  if (!entry.resolver) {
    return entry.path;
  }

  const replacements: Record<AdminPageResolver, () => Promise<string>> = {
    'first-user': () => resolveFirstUser(page),
    'first-role': () => resolveFirstRole(page),
    'first-plan': () => resolveFirstPlan(page),
    'sample-plugin': async () => {
      await ensureSamplePluginEnabled(page);
      return SAMPLE_PLUGIN_ID;
    },
  };

  const value = await replacements[entry.resolver]();

  return entry.path
    .replace('__USER_ID__', value)
    .replace('__ROLE_ID__', value)
    .replace('__PLAN_ID__', value)
    .replace('__PLUGIN_ID__', value);
}

function shouldRunInProject(entry: AdminPageCatalogEntry, projectName: string): boolean {
  if (projectName === 'chromium-mobile') {
    return entry.tier === 'P0';
  }

  return true;
}

async function getHeading(page: Page): Promise<string | undefined> {
  const heading = page.getByRole('heading').first();
  if ((await heading.count()) === 0) {
    return undefined;
  }
  return (await heading.textContent())?.trim().replace(/\s+/g, ' ') || undefined;
}

async function getBodyTextSample(page: Page): Promise<string> {
  return page.evaluate(() =>
    (document.body.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 2000)
  );
}

async function collectAriaSnapshot(page: Page): Promise<string> {
  return page
    .locator('body')
    .ariaSnapshot({ timeout: 5000 })
    .catch((error: unknown) => {
      return `ARIA snapshot unavailable: ${error instanceof Error ? error.message : String(error)}`;
    });
}

async function closeTransientLayer(page: Page): Promise<void> {
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.waitForTimeout(150);
}

async function probeTabs(page: Page): Promise<AdminDisclosureProbe[]> {
  const probes: AdminDisclosureProbe[] = [];
  const tabs = page.getByRole('tab');
  const count = await tabs.count();

  for (let index = 0; index < count; index += 1) {
    const tab = tabs.nth(index);
    const triggerName = ((await tab.textContent()) ?? '').trim().replace(/\s+/g, ' ');
    if (
      !(await tab.isVisible().catch(() => false)) ||
      (await tab.isDisabled().catch(() => false))
    ) {
      continue;
    }

    try {
      await tab.click();
      await page.waitForTimeout(150);
      probes.push({
        kind: 'tab',
        triggerName,
        opened: true,
        discovered: await collectAdminInteractivesByRole(page, [
          'button',
          'link',
          'combobox',
          'switch',
          'checkbox',
          'textbox',
        ]),
      });
    } catch (error) {
      probes.push({
        kind: 'tab',
        triggerName,
        opened: false,
        discovered: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return probes;
}

async function probeClickableLayer(
  page: Page,
  kind: AdminDisclosureProbe['kind'],
  role: 'button' | 'combobox',
  childRoles: readonly ('menuitem' | 'option' | 'dialog' | 'alertdialog' | 'button')[]
): Promise<AdminDisclosureProbe[]> {
  const probes: AdminDisclosureProbe[] = [];
  const triggers = page.getByRole(role);
  const count = await triggers.count();

  for (let index = 0; index < Math.min(count, 12); index += 1) {
    const trigger = triggers.nth(index);
    const triggerName = (
      (await trigger
        .evaluate((element) => element.getAttribute('aria-label') || element.textContent || '')
        .catch(() => '')) || `${role}-${index + 1}`
    )
      .trim()
      .replace(/\s+/g, ' ');

    if (
      !(await trigger.isVisible().catch(() => false)) ||
      (await trigger.isDisabled().catch(() => false))
    ) {
      continue;
    }

    const looksLikeDisclosure =
      role === 'combobox' ||
      (await trigger
        .evaluate((element) => {
          const hasPopup = element.getAttribute('aria-haspopup');
          const expanded = element.getAttribute('aria-expanded');
          const controls = element.getAttribute('aria-controls');
          const dataState = element.getAttribute('data-state');
          return Boolean(
            hasPopup ||
            expanded !== null ||
            controls ||
            dataState === 'closed' ||
            dataState === 'open'
          );
        })
        .catch(() => false));

    if (!looksLikeDisclosure) {
      continue;
    }

    try {
      await closeTransientLayer(page);
      await trigger.click({ timeout: 1000 });
      await page.waitForTimeout(200);
      const discovered = await collectAdminInteractivesByRole(page, childRoles);

      if (discovered.length > 0) {
        probes.push({
          kind,
          triggerName,
          opened: true,
          discovered,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Timeout')) {
        probes.push({
          kind,
          triggerName,
          opened: false,
          discovered: [],
          error: message,
        });
      }
    } finally {
      await closeTransientLayer(page);
    }
  }

  return probes;
}

async function collectDisclosureProbes(page: Page): Promise<AdminDisclosureProbe[]> {
  const tabs = await probeTabs(page);
  const menusAndDialogs = await probeClickableLayer(page, 'menu', 'button', [
    'menuitem',
    'dialog',
    'alertdialog',
    'button',
  ]);
  const comboboxes = await probeClickableLayer(page, 'combobox', 'combobox', ['option']);

  return [...tabs, ...menusAndDialogs, ...comboboxes];
}

for (const entry of ADMIN_PAGES) {
  test(`admin surface: ${entry.id}`, async ({ page }, testInfo) => {
    test.skip(
      !shouldRunInProject(entry, testInfo.project.name),
      'Only P0 admin pages run in the mobile surface crawl.'
    );

    const issues = collectPageIssues(page);
    const apiResponses = createAdminApiResponseCollector(page);

    await loginAsAdmin(page, 'en');

    const path = await resolveAdminPagePath(page, entry);
    await page.goto(path);
    await page.waitForLoadState('domcontentloaded');

    if (entry.smoke?.redirectedTo) {
      await expect(page).toHaveURL(new RegExp(entry.smoke.redirectedTo.replace('?', '\\?')));
    } else {
      await expect(page.getByRole('main')).toBeVisible();
    }

    for (const text of entry.smoke?.expectedText ?? []) {
      await expect(page.getByRole('main').getByText(text).first()).toBeVisible();
    }

    const interactives = await collectAdminInteractives(page);
    const disclosureProbes = await collectDisclosureProbes(page);
    const heading = await getHeading(page);
    const bodyTextSample = await getBodyTextSample(page);
    const ariaSnapshot = await collectAriaSnapshot(page);
    const screenshotPath = adminSurfaceArtifactPath(
      entry.id,
      testInfo.project.name,
      'surface',
      'png'
    );
    const ariaPath = adminSurfaceArtifactPath(entry.id, testInfo.project.name, 'aria', 'txt');

    await ensureAdminSurfaceOutputDir();
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });

    await testInfo.attach(`${entry.id}-surface.json`, {
      body: JSON.stringify(
        {
          entry,
          path,
          heading,
          bodyTextSample,
          interactives,
          disclosureProbes,
          apiResponses,
          screenshotPath,
          ariaPath,
        },
        null,
        2
      ),
      contentType: 'application/json',
    });
    await testInfo.attach(`${entry.id}-aria.txt`, {
      body: ariaSnapshot,
      contentType: 'text/plain',
    });

    await writeAdminSurfaceReport({
      pageId: entry.id,
      tier: entry.tier,
      path,
      finalUrl: page.url(),
      projectName: testInfo.project.name,
      viewport: testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop',
      heading,
      bodyTextSample,
      ariaSnapshot,
      screenshotPath,
      interactives,
      disclosureProbes,
      apiResponses,
      collectedAt: new Date().toISOString(),
    });

    await issues.assertNoUnexpected(testInfo);
  });
}
