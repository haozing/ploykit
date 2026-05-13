import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

export type AdminInteractiveRole =
  | 'button'
  | 'link'
  | 'menuitem'
  | 'tab'
  | 'combobox'
  | 'switch'
  | 'checkbox'
  | 'textbox'
  | 'spinbutton'
  | 'slider'
  | 'option'
  | 'dialog'
  | 'alertdialog';

export interface AdminInteractiveSnapshot {
  role: AdminInteractiveRole;
  name: string;
  visible: boolean;
  disabled: boolean;
}

export interface AdminApiResponseSnapshot {
  method: string;
  path: string;
  status: number;
  ok: boolean;
}

export interface AdminSurfaceReport {
  pageId: string;
  tier: string;
  path: string;
  finalUrl: string;
  projectName: string;
  viewport: string;
  heading?: string;
  bodyTextSample?: string;
  ariaSnapshot?: string;
  screenshotPath?: string;
  interactives: AdminInteractiveSnapshot[];
  disclosureProbes: AdminDisclosureProbe[];
  apiResponses: AdminApiResponseSnapshot[];
  collectedAt: string;
}

export interface AdminDisclosureProbe {
  kind: 'tab' | 'menu' | 'dialog' | 'combobox';
  triggerName: string;
  opened: boolean;
  discovered: AdminInteractiveSnapshot[];
  error?: string;
}

const INTERACTIVE_ROLES: readonly AdminInteractiveRole[] = [
  'button',
  'link',
  'menuitem',
  'tab',
  'combobox',
  'switch',
  'checkbox',
  'textbox',
  'spinbutton',
  'slider',
  'option',
  'dialog',
  'alertdialog',
] as const;

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-|-$/g, '');
}

export function adminSurfaceOutputDir(): string {
  return path.join(process.cwd(), 'test-results', 'admin-surface');
}

export async function ensureAdminSurfaceOutputDir(): Promise<void> {
  await mkdir(adminSurfaceOutputDir(), { recursive: true });
}

export function adminSurfaceArtifactPath(
  pageId: string,
  projectName: string,
  suffix: string,
  extension: string
): string {
  return path.join(
    adminSurfaceOutputDir(),
    `${sanitizeFilePart(pageId)}.${sanitizeFilePart(projectName)}.${sanitizeFilePart(
      suffix
    )}.${extension}`
  );
}

export function createAdminApiResponseCollector(page: Page): AdminApiResponseSnapshot[] {
  const responses: AdminApiResponseSnapshot[] = [];

  page.on('response', (response) => {
    const url = new URL(response.url());
    if (!url.pathname.startsWith('/api/admin')) {
      return;
    }

    responses.push({
      method: response.request().method(),
      path: `${url.pathname}${url.search}`,
      status: response.status(),
      ok: response.ok(),
    });
  });

  return responses;
}

export async function collectAdminInteractives(page: Page): Promise<AdminInteractiveSnapshot[]> {
  return collectAdminInteractivesByRole(page, INTERACTIVE_ROLES);
}

export async function collectAdminInteractivesByRole(
  page: Page,
  roles: readonly AdminInteractiveRole[]
): Promise<AdminInteractiveSnapshot[]> {
  const snapshots: AdminInteractiveSnapshot[] = [];

  for (const role of roles) {
    const locator = page.getByRole(role);
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      const [name, visible, disabled] = await Promise.all([
        item
          .evaluate((element) => element.getAttribute('aria-label') || element.textContent || '')
          .catch(() => ''),
        item.isVisible().catch(() => false),
        item.isDisabled().catch(() => false),
      ]);

      snapshots.push({
        role,
        name: name.trim().replace(/\s+/g, ' '),
        visible,
        disabled,
      });
    }
  }

  return snapshots
    .filter((item) => item.visible)
    .sort((a, b) => `${a.role}:${a.name}`.localeCompare(`${b.role}:${b.name}`));
}

export async function writeAdminSurfaceReport(report: AdminSurfaceReport): Promise<void> {
  const outputDir = adminSurfaceOutputDir();
  const fileName = `${sanitizeFilePart(report.pageId)}.${sanitizeFilePart(
    report.projectName
  )}.json`;

  await ensureAdminSurfaceOutputDir();
  await writeFile(path.join(outputDir, fileName), `${JSON.stringify(report, null, 2)}\n`);
}
