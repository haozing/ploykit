#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const required = process.argv.includes('--required');
const baseUrl = (
  process.argv.includes('--base-url')
    ? process.argv[process.argv.indexOf('--base-url') + 1]
    : process.env.HOST_SMOKE_BASE_URL
) ?? 'http://localhost:3000';
const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'admin-mobile-handfeel',
  new Date().toISOString().replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'mobile-handfeel.json');
const latestPath = path.resolve(process.cwd(), '.runtime', 'admin-mobile-handfeel', 'latest.json');
const visualQaCss = `
  nextjs-portal {
    display: none !important;
    pointer-events: none !important;
  }
`;
const globalSearchOpenName = /^(Open global search|打开全局搜索)$/;
const globalSearchDialogName = /^(Global search|全局搜索)$/;
const globalSearchQueryName = /^(Global search query|全局搜索查询)$/;
const globalSearchTypeName = /^(Search type|搜索类型)$/;
const globalSearchSubmitName = /^(Search|搜索)$/;
const globalSearchOpenLabels = new Set(['Open global search', '打开全局搜索']);

function writeReport(report) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.copyFileSync(reportPath, latestPath);
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function parseSetCookieHeader(setCookieHeader, cookieUrl) {
  if (!setCookieHeader) {
    return undefined;
  }
  const [cookiePair] = setCookieHeader.split(';');
  const separatorIndex = cookiePair.indexOf('=');
  if (separatorIndex <= 0) {
    return undefined;
  }
  const url = new URL(cookieUrl);
  return {
    name: cookiePair.slice(0, separatorIndex),
    value: cookiePair.slice(separatorIndex + 1),
    domain: url.hostname,
    path: '/',
    httpOnly: setCookieHeader.toLowerCase().includes('httponly'),
    secure: url.protocol === 'https:',
    sameSite: setCookieHeader.toLowerCase().includes('samesite=strict') ? 'Strict' : 'Lax',
  };
}

async function prepareVisualQaPage(page) {
  await page.addStyleTag({ content: visualQaCss }).catch(() => undefined);
  await page
    .evaluate(() => {
      document.querySelectorAll('nextjs-portal').forEach((element) => {
        element.setAttribute('aria-hidden', 'true');
      });
    })
    .catch(() => undefined);
}

async function ensureAdminLogin(context) {
  const loginUrl = `${normalizedBaseUrl}/api/auth/login`;
  const response = await context.request.post(loginUrl, {
    headers: {
      'x-forwarded-for': '10.204.18.10',
    },
    form: {
      email: 'admin@example.com',
      password: 'Admin@123456',
      next: '/zh/admin',
    },
    maxRedirects: 0,
  });
  const sessionCookie = parseSetCookieHeader(response.headers()['set-cookie'], loginUrl);
  if (sessionCookie) {
    await context.addCookies([sessionCookie]);
  }
  return {
    id: 'mobile:auth-login',
    ok: (response.status() === 302 || response.status() === 303) && Boolean(sessionCookie),
    status: response.status(),
    cookieStored: Boolean(sessionCookie),
  };
}

async function checkShellTopbar(page, checks) {
  await page.goto(`${normalizedBaseUrl}/zh/admin`, { waitUntil: 'networkidle' });
  await prepareVisualQaPage(page);
  const screenshot = path.join(outputDir, 'mobile-admin-shell.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  const metrics = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const heading = document.querySelector('main h1, h1');
    const menu = Array.from(document.querySelectorAll('button')).find((button) =>
      button.textContent?.trim().includes('Menu')
    );
    const notifications = document.querySelector('a[aria-label="Notifications"]');
    const headingRect = heading?.getBoundingClientRect();
    const menuRect = menu?.getBoundingClientRect();
    const openSearchLabels = new Set(['Open global search', '打开全局搜索']);
    const visibleSearchButtons = Array.from(document.querySelectorAll('button[aria-label]')).filter((button) => {
      const rect = button.getBoundingClientRect();
      return openSearchLabels.has(button.getAttribute('aria-label') ?? '') && rect.width > 0 && rect.height > 0;
    });
    return {
      horizontalOverflow: documentElement.scrollWidth > documentElement.clientWidth + 1,
      headingText: heading?.textContent?.trim() ?? '',
      headingTop: headingRect?.top ?? null,
      headingVisible: Boolean(headingRect && headingRect.top >= 0 && headingRect.top < window.innerHeight),
      menuVisible: Boolean(menuRect && menuRect.width > 0 && menuRect.height > 0),
      searchVisible: visibleSearchButtons.length > 0,
      notificationsVisible: Boolean(notifications),
    };
  });
  checks.push({
    id: 'mobile:/zh/admin:shell-topbar',
    ok:
      !metrics.horizontalOverflow &&
      metrics.headingVisible &&
      (metrics.headingText.includes('Admin Overview') || metrics.headingText.includes('后台概览')) &&
      metrics.menuVisible &&
      metrics.searchVisible &&
      metrics.notificationsVisible,
    ...metrics,
    screenshot,
  });
}

async function checkMobileDrawer(page, checks) {
  await page.goto(`${normalizedBaseUrl}/zh/admin`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Menu' }).click();
  const dialog = page.getByRole('dialog', { name: 'Navigation' });
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  const overflowWhileOpen = await page.evaluate(() => document.body.style.overflow);
  const focusedAfterOpen = await page.evaluate(
    () => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? ''
  );
  await page.keyboard.press('Tab');
  const focusInsideAfterTab = await page.evaluate(() => {
    const dialogElement = document.querySelector('[role="dialog"][aria-label="Navigation"]');
    return Boolean(dialogElement?.contains(document.activeElement));
  });
  await prepareVisualQaPage(page);
  const screenshot = path.join(outputDir, 'mobile-admin-drawer.png');
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  const menuFocusedAfterClose = await page
    .getByRole('button', { name: 'Menu' })
    .evaluate((element) => element === document.activeElement)
    .catch(() => false);
  const overflowAfterClose = await page.evaluate(() => document.body.style.overflow);
  checks.push({
    id: 'mobile:/zh/admin:drawer-handfeel',
    ok:
      overflowWhileOpen === 'hidden' &&
      focusedAfterOpen.toLowerCase().includes('close') &&
      focusInsideAfterTab &&
      overflowAfterClose !== 'hidden' &&
      menuFocusedAfterClose,
    overflowWhileOpen,
    focusedAfterOpen,
    focusInsideAfterTab,
    overflowAfterClose,
    menuFocusedAfterClose,
    screenshot,
  });
}

async function checkGlobalSearch(page, checks) {
  await page.goto(`${normalizedBaseUrl}/zh/admin`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: globalSearchOpenName }).click();
  const dialog = page.getByRole('dialog', { name: globalSearchDialogName });
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  const overflowWhileOpen = await page.evaluate(() => document.body.style.overflow);
  const input = page.getByLabel(globalSearchQueryName);
  await input.fill('hello');
  await page.getByLabel(globalSearchTypeName).selectOption('module');
  const inputFocused = await input.evaluate((element) => element === document.activeElement).catch(() => false);
  await page.waitForTimeout(350);
  await prepareVisualQaPage(page);
  const openScreenshot = path.join(outputDir, 'mobile-admin-global-search-open.png');
  await page.screenshot({ path: openScreenshot, fullPage: true });
  await page.getByRole('button', { name: globalSearchSubmitName, exact: true }).click();
  await page.waitForURL(/\/zh\/admin\/search\?/, { timeout: 5000 }).catch(() => undefined);
  const urlAfterSubmit = page.url();
  const overflowAfterSubmit = await page.evaluate(() => document.body.style.overflow);
  await page.goto(`${normalizedBaseUrl}/zh/admin`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: globalSearchOpenName }).click();
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  const recentVisible = await page.getByRole('button', { name: 'hello' }).isVisible().catch(() => false);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  const closedAfterEscape = await dialog.isHidden().catch(() => false);
  checks.push({
    id: 'mobile:/zh/admin:global-search-handfeel',
    ok:
      overflowWhileOpen === 'hidden' &&
      inputFocused &&
      urlAfterSubmit.includes('/zh/admin/search') &&
      urlAfterSubmit.includes('type=module') &&
      overflowAfterSubmit !== 'hidden' &&
      recentVisible &&
      closedAfterEscape,
    overflowWhileOpen,
    inputFocused,
    urlAfterSubmit,
    overflowAfterSubmit,
    recentVisible,
    closedAfterEscape,
    screenshot: openScreenshot,
  });
}

async function checkPageHandfeel(page, checks, route, label) {
  await page.goto(`${normalizedBaseUrl}${route}`, { waitUntil: 'networkidle' });
  await prepareVisualQaPage(page);
  const screenshot = path.join(outputDir, `mobile-${label}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  const metrics = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const heading = document.querySelector('main h1, h1');
    const details = Array.from(document.querySelectorAll('details'));
    const visibleDetails = details.filter((item) => {
      const rect = item.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    return {
      headingText: heading?.textContent?.trim() ?? '',
      horizontalOverflow: documentElement.scrollWidth > documentElement.clientWidth + 1,
      detailsCount: details.length,
      visibleDetailsCount: visibleDetails.length,
      openDetailsCount: details.filter((item) => item.open).length,
      firstScreenLinksAndButtons: Array.from(
        document.querySelectorAll('main a[href], main button:not([disabled]), main summary')
      ).filter((element) => element.getBoundingClientRect().top < window.innerHeight).length,
    };
  });
  let detailsToggleOk = true;
  if (metrics.visibleDetailsCount > 0) {
    detailsToggleOk = await page.evaluate(() => {
      const detail = Array.from(document.querySelectorAll('details')).find((item) => {
        const rect = item.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const summary = detail?.querySelector('summary');
      if (!detail || !summary) {
        return false;
      }
      const before = detail.open;
      summary.click();
      return detail.open !== before;
    });
  }
  checks.push({
    id: `mobile:${route}:page-handfeel`,
    ok:
      !metrics.horizontalOverflow &&
      metrics.headingText.length > 0 &&
      metrics.firstScreenLinksAndButtons > 0 &&
      detailsToggleOk,
    ...metrics,
    detailsToggleOk,
    screenshot,
  });
}

const loaded = await loadPlaywright();
if ('error' in loaded) {
  const result = {
    ok: !required,
    required,
    skipped: true,
    reason: 'Playwright is not installed. Install playwright before running a required mobile handfeel check.',
    error: loaded.error,
    outputDir,
    checkedAt: new Date().toISOString(),
    artifacts: {
      report: reportPath,
      latest: latestPath,
    },
  };
  writeReport(result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
  process.exit();
}

fs.mkdirSync(outputDir, { recursive: true });
const browser = await loaded.chromium.launch();
const checks = [];

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  checks.push(await ensureAdminLogin(context));
  const page = await context.newPage();
  await checkShellTopbar(page, checks);
  await checkMobileDrawer(page, checks);
  await checkGlobalSearch(page, checks);
  await checkPageHandfeel(page, checks, '/zh/admin/modules', 'zh-admin-modules');
  await checkPageHandfeel(page, checks, '/zh/admin/settings', 'zh-admin-settings');
  await checkPageHandfeel(page, checks, '/zh/admin/search', 'zh-admin-search');
  await context.close();
} catch (error) {
  checks.push({
    id: 'mobile:admin-handfeel:fatal',
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
} finally {
  await browser.close();
}

const failed = checks.filter((check) => check.ok !== true);
const result = {
  schemaVersion: 1,
  ok: failed.length === 0,
  required,
  skipped: false,
  baseUrl: normalizedBaseUrl,
  outputDir,
  checkedAt: new Date().toISOString(),
  summary: {
    checks: checks.length,
    failed: failed.length,
  },
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

writeReport(result);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok || !required ? 0 : 1;
