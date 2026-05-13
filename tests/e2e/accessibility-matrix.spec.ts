import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ADMIN_PAGES, type AdminPageResolver } from './admin/admin-page-catalog';
import { ensureSamplePluginEnabled, loginAsAdmin } from './fixtures/auth';
import { collectPageIssues } from './fixtures/page-issues';

test.describe.configure({ timeout: 90_000 });

interface BrowserFetchResult<TBody> {
  status: number;
  ok: boolean;
  body: TBody;
}

interface AccessibilityTarget {
  id: string;
  path: string;
  kind: 'public' | 'user' | 'admin' | 'plugin';
  requiresAdmin?: boolean;
  resolver?: AdminPageResolver;
  expectedText?: string | RegExp;
  setup?: (page: Page) => Promise<void>;
}

interface TabStop {
  tagName: string;
  role: string | null;
  name: string;
  href: string | null;
  visible: boolean;
  focusIndicator: {
    outlineStyle: string;
    outlineWidth: string;
    boxShadow: string;
  };
}

interface AccessibilityEvidence {
  target: AccessibilityTarget;
  projectName: string;
  finalUrl: string;
  violations: Array<{
    id: string;
    impact: string | null | undefined;
    help: string;
    nodes: Array<{
      target: string[];
      html: string;
      failureSummary?: string;
    }>;
  }>;
  tabStops: TabStop[];
  screenshotPath: string;
  collectedAt: string;
}

const ACCESSIBILITY_DIR = path.join(process.cwd(), 'test-results', 'accessibility-matrix');

const PUBLIC_TARGETS: AccessibilityTarget[] = [
  { id: 'public.home', path: '/en', kind: 'public', expectedText: /PloyKit/ },
  { id: 'public.about', path: '/en/about', kind: 'public', expectedText: /About/ },
  { id: 'public.pricing', path: '/en/pricing', kind: 'public', expectedText: /Pricing/ },
  { id: 'public.json-tool', path: '/en/json', kind: 'public', expectedText: 'JSON Formatter' },
  {
    id: 'public.pdf-ocr-tool',
    path: '/en/tools/pdf-ocr',
    kind: 'public',
    expectedText: 'PDF OCR Demo',
  },
];

const USER_TARGETS: AccessibilityTarget[] = [
  {
    id: 'user.profile',
    path: '/en/profile',
    kind: 'user',
    requiresAdmin: true,
    expectedText: /Profile/,
  },
  {
    id: 'user.billing',
    path: '/en/billing',
    kind: 'user',
    requiresAdmin: true,
    expectedText: /Billing/,
  },
  {
    id: 'user.notification-preferences',
    path: '/en/settings/notifications',
    kind: 'user',
    requiresAdmin: true,
    expectedText: /Notification/,
  },
];

const ADMIN_TARGETS: AccessibilityTarget[] = ADMIN_PAGES.filter((page) => page.tier === 'P0').map(
  (page) => ({
    id: page.id,
    path: page.path,
    kind: 'admin',
    requiresAdmin: true,
    resolver: page.resolver,
    expectedText: page.smoke?.expectedText?.[0],
  })
);

const PLUGIN_TARGETS: AccessibilityTarget[] = [
  {
    id: 'plugin.admin-runtime',
    path: '/en/admin/plugins/__PLUGIN_ID__',
    kind: 'plugin',
    requiresAdmin: true,
    resolver: 'sample-plugin',
    expectedText: 'Sample Internal',
    setup: ensureSamplePluginEnabled,
  },
];

const TARGETS = [...PUBLIC_TARGETS, ...USER_TARGETS, ...ADMIN_TARGETS, ...PLUGIN_TARGETS];

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '');
}

function artifactPath(target: AccessibilityTarget, projectName: string, extension: string): string {
  return path.join(
    ACCESSIBILITY_DIR,
    `${sanitizeFilePart(target.id)}.${sanitizeFilePart(projectName)}.${extension}`
  );
}

async function browserFetchJson<TBody>(
  page: Page,
  requestPath: string
): Promise<BrowserFetchResult<TBody>> {
  return page.evaluate(async (pathInBrowser) => {
    const response = await fetch(pathInBrowser);
    const text = await response.text();

    return {
      status: response.status,
      ok: response.ok,
      body: text ? (JSON.parse(text) as TBody) : ({} as TBody),
    };
  }, requestPath);
}

async function resolveFirstUser(page: Page): Promise<string> {
  const response = await browserFetchJson<{ users?: Array<{ id?: string }> }>(
    page,
    '/api/admin/users?limit=1'
  );

  expect(response.ok, `GET /api/admin/users returned ${response.status}`).toBe(true);
  const id = response.body.users?.[0]?.id;
  expect(id, 'Expected at least one user for accessibility detail page').toBeTruthy();
  return id!;
}

async function resolveFirstRole(page: Page): Promise<string> {
  const response = await browserFetchJson<{ roles?: Array<{ id?: string }> }>(
    page,
    '/api/admin/roles?limit=1'
  );

  expect(response.ok, `GET /api/admin/roles returned ${response.status}`).toBe(true);
  const id = response.body.roles?.[0]?.id;
  expect(id, 'Expected at least one role for accessibility detail page').toBeTruthy();
  return id!;
}

async function resolveFirstPlan(page: Page): Promise<string> {
  const response = await browserFetchJson<{ data?: Array<{ id?: string }> }>(
    page,
    '/api/admin/entitlements/plans'
  );

  expect(response.ok, `GET /api/admin/entitlements/plans returned ${response.status}`).toBe(true);
  const id = response.body.data?.[0]?.id;
  expect(id, 'Expected at least one plan for accessibility detail page').toBeTruthy();
  return id!;
}

async function resolveTargetPath(page: Page, target: AccessibilityTarget): Promise<string> {
  if (!target.resolver) {
    return target.path;
  }

  const replacements: Record<AdminPageResolver, () => Promise<string>> = {
    'first-user': () => resolveFirstUser(page),
    'first-role': () => resolveFirstRole(page),
    'first-plan': () => resolveFirstPlan(page),
    'sample-plugin': async () => {
      await ensureSamplePluginEnabled(page);
      return 'sample-internal';
    },
  };

  const value = await replacements[target.resolver]();

  return target.path
    .replace('__USER_ID__', value)
    .replace('__ROLE_ID__', value)
    .replace('__PLAN_ID__', value)
    .replace('__PLUGIN_ID__', value);
}

async function collectTabStops(page: Page): Promise<TabStop[]> {
  await page.keyboard.press('Escape').catch(() => undefined);
  await page
    .locator('body')
    .click({ position: { x: 1, y: 1 } })
    .catch(() => undefined);

  const stops: TabStop[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < 16; index += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(50);
    const stop = await page.evaluate<TabStop>(() => {
      const element = document.activeElement as HTMLElement | null;
      const rect = element?.getBoundingClientRect();
      const style = element ? window.getComputedStyle(element) : null;
      const rawName =
        element?.getAttribute('aria-label') ||
        element?.getAttribute('title') ||
        element?.textContent ||
        '';

      return {
        tagName: element?.tagName ?? '',
        role: element?.getAttribute('role') ?? null,
        name: rawName.trim().replace(/\s+/g, ' ').slice(0, 120),
        href: element instanceof HTMLAnchorElement ? element.href : null,
        visible: Boolean(rect && rect.width > 0 && rect.height > 0),
        focusIndicator: {
          outlineStyle: style?.outlineStyle ?? '',
          outlineWidth: style?.outlineWidth ?? '',
          boxShadow: style?.boxShadow ?? '',
        },
      };
    });
    const key = `${stop.tagName}:${stop.role ?? ''}:${stop.name}:${stop.href ?? ''}`;

    if (stop.visible && stop.tagName && stop.tagName !== 'BODY' && !seen.has(key)) {
      stops.push(stop);
      seen.add(key);
    }
  }

  return stops;
}

function formatViolations(violations: AccessibilityEvidence['violations']): string {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .slice(0, 3)
        .map((node) => `  - ${node.target.join(' ')}: ${node.failureSummary ?? node.html}`)
        .join('\n');
      return `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help}\n${nodes}`;
    })
    .join('\n\n');
}

function serializeAxeTarget(target: unknown): string[] {
  if (Array.isArray(target)) {
    return target.map((item) => (typeof item === 'string' ? item : JSON.stringify(item)));
  }

  return [typeof target === 'string' ? target : JSON.stringify(target)];
}

async function writeEvidence(evidence: AccessibilityEvidence): Promise<void> {
  await mkdir(ACCESSIBILITY_DIR, { recursive: true });
  await writeFile(
    artifactPath(evidence.target, evidence.projectName, 'json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8'
  );
}

for (const target of TARGETS) {
  test(`accessibility matrix: ${target.id}`, async ({ page }, testInfo) => {
    const issues = collectPageIssues(page);

    if (target.requiresAdmin) {
      await loginAsAdmin(page, 'en');
    }

    await target.setup?.(page);
    const routePath = await resolveTargetPath(page, target);
    await page.goto(routePath, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('main').first()).toBeVisible();

    if (target.expectedText) {
      await expect(page.getByText(target.expectedText).first()).toBeVisible();
    }

    const screenshotPath = artifactPath(target, testInfo.project.name, 'png');
    await mkdir(ACCESSIBILITY_DIR, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' });

    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const tabStops = await collectTabStops(page);
    const evidence: AccessibilityEvidence = {
      target,
      projectName: testInfo.project.name,
      finalUrl: page.url(),
      violations: axeResults.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map((node) => ({
          target: serializeAxeTarget(node.target),
          html: node.html,
          failureSummary: node.failureSummary,
        })),
      })),
      tabStops,
      screenshotPath,
      collectedAt: new Date().toISOString(),
    };
    await writeEvidence(evidence);

    expect(
      tabStops.length,
      'Expected keyboard Tab to reach at least one visible control'
    ).toBeGreaterThan(0);
    expect(axeResults.violations, formatViolations(evidence.violations)).toEqual([]);
    await issues.assertNoUnexpected(testInfo);
  });
}
