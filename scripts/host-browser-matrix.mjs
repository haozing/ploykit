import fs from 'node:fs';
import path from 'node:path';
import { collectModuleQualityRoutes, routeAppliesToViewport } from './module-quality-manifest.mjs';

const required = process.argv.includes('--required');
const moduleQualityOnly = process.argv.includes('--module-quality-only');
const baseUrl = (
  process.argv.includes('--base-url')
    ? process.argv[process.argv.indexOf('--base-url') + 1]
    : process.env.HOST_SMOKE_BASE_URL
) ?? 'http://localhost:3000';
const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'browser-matrix',
  new Date().toISOString().replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'matrix.json');
const latestPath = path.resolve(process.cwd(), '.runtime', 'browser-matrix', 'latest.json');
const visualQaCss = `
  nextjs-portal {
    display: none !important;
    pointer-events: none !important;
  }
`;
const globalSearchDialogName = /^(Global search|全局搜索)$/;
const globalSearchQueryName = /^(Global search query|全局搜索查询)$/;
const globalSearchTypeName = /^(Search type|搜索类型)$/;
const globalSearchQueryLabels = new Set(['Global search query', '全局搜索查询']);
const mobileMenuButtonName = /^(Menu|\u83dc\u5355)$/u;
const mobileNavigationDialogName = /^(Navigation|\u5bfc\u822a)$/u;
const mobileCloseNavigationName = /^(Close navigation|\u5173\u95ed\u5bfc\u822a)$/u;

function writeReport(report) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.copyFileSync(reportPath, latestPath);
}

const baseRoutes = [
  { path: '/', contains: 'PloyKit' },
  { path: '/zh/pricing', contains: '价格' },
  { path: '/zh/docs', contains: '文档' },
  { path: '/zh/login', contains: '登录' },
  { path: '/zh/register', contains: '创建账号' },
  { path: '/zh/forgot-password', contains: '找回密码' },
  { path: '/zh/reset-password', contains: '重置密码' },
  { path: '/zh/demo', contains: 'Capability Demo' },
  { path: '/zh/dashboard', auth: true, contains: 'admin@example.com' },
  { path: '/zh/dashboard/workspaces', auth: true, contains: '工作区' },
  { path: '/zh/dashboard/files', auth: true, contains: '文件' },
  { path: '/zh/dashboard/billing', auth: true, contains: '账单' },
  { path: '/zh/dashboard/orders', auth: true, contains: '订单' },
  { path: '/zh/dashboard/credit-history', auth: true, contains: '点数记录' },
  { path: '/zh/dashboard/notifications', auth: true, contains: '通知' },
  { path: '/zh/dashboard/settings/notifications', auth: true, contains: '通知设置' },
  { path: '/zh/admin', auth: true, contains: '后台概览' },
  { path: '/zh/admin/modules', auth: true, contains: '模块' },
  { path: '/zh/admin/module-dev-console', auth: true, contains: '模块开发控制台' },
  { path: '/zh/admin/users', auth: true, contains: '用户' },
  { path: '/zh/admin/users/demo-admin', auth: true, contains: '用户详情' },
  { path: '/zh/admin/rbac', auth: true, contains: '角色与权限' },
  { path: '/zh/admin/analytics', auth: true, contains: '分析' },
  { path: '/zh/admin/revenue', auth: true, contains: '收入' },
  { path: '/zh/admin/usage', auth: true, contains: 'Usage' },
  { path: '/zh/admin/entitlements', auth: true, contains: '权益' },
  { path: '/zh/admin/runs', auth: true, contains: '运行' },
  { path: '/zh/admin/webhooks', auth: true, contains: 'Webhooks' },
  { path: '/zh/admin/files', auth: true, contains: 'Files' },
  { path: '/zh/admin/files/missing-file', auth: true, contains: '文件详情' },
  { path: '/zh/admin/billing', auth: true, contains: '计费' },
  { path: '/zh/admin/audit', auth: true, contains: '审计' },
  { path: '/zh/admin/service-connections', auth: true, contains: '服务连接' },
  { path: '/zh/admin/settings', auth: true, contains: '设置' },
  { path: '/zh/admin/search', auth: true, contains: '搜索' },
];
const moduleQualityRoutes = collectModuleQualityRoutes('browser').map((route) => ({
  ...route,
  delegatedToModuleQuality: true,
}));
const routes = [...baseRoutes, ...moduleQualityRoutes];

const viewports = [
  { id: 'desktop', width: 1440, height: 1000 },
  { id: 'mobile', width: 390, height: 844 },
];
let qaLoginIpCounter = 0;

function moduleQualityRouteChecks() {
  return viewports.flatMap((viewport) =>
    moduleQualityRoutes
      .filter((route) => routeAppliesToViewport(route, viewport.id))
      .map((route) => ({
        id: `${viewport.id}:${route.path}`,
        ok: true,
        delegatedToModuleQuality: true,
        moduleId: route.moduleId,
        source: route.source,
      }))
  );
}

if (moduleQualityOnly) {
  const result = {
    ok: true,
    required,
    skipped: false,
    baseUrl: normalizedBaseUrl,
    outputDir,
    checkedAt: new Date().toISOString(),
    summary: {
      mode: 'module-quality-only',
      baseRoutes: 0,
      moduleQualityRoutes: moduleQualityRoutes.length,
    },
    checks: moduleQualityRouteChecks(),
    artifacts: {
      report: reportPath,
      latest: latestPath,
    },
  };
  writeReport(result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
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

const loaded = await loadPlaywright();
if ('error' in loaded) {
  const result = {
    ok: !required,
    required,
    skipped: true,
    reason: 'Playwright is not installed. Install playwright before running a required browser matrix.',
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

async function ensureAdminLogin(context, viewportId) {
  const loginUrl = `${normalizedBaseUrl}/api/auth/login`;
  const loginPageUrl = `${normalizedBaseUrl}/zh/login`;
  const response = await context.request.post(loginUrl, {
    headers: {
      origin: normalizedBaseUrl,
      referer: loginPageUrl,
      'x-forwarded-for': `10.201.${qaLoginIpCounter++}.10`,
    },
    form: {
      email: 'admin@example.com',
      password: 'Admin@123456',
      next: '/zh/dashboard',
    },
    maxRedirects: 0,
  });
  const sessionCookie = parseSetCookieHeader(response.headers()['set-cookie'], loginUrl);
  if (sessionCookie) {
    await context.addCookies([sessionCookie]);
  }
  checks.push({
    id: `${viewportId}:auth-login`,
    ok: (response.status() === 302 || response.status() === 303) && Boolean(sessionCookie),
    status: response.status(),
    cookieStored: Boolean(sessionCookie),
  });
}

async function runMobileAdminInteractionChecks(page, outputDir) {
  const menuButton = page.getByRole('button', { name: mobileMenuButtonName });
  await menuButton.click();
  const dialog = page.getByRole('dialog', { name: mobileNavigationDialogName });
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  const overflowWhileOpen = await page.evaluate(() => document.body.style.overflow);
  const focusedAfterOpen = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? '');
  await page.keyboard.press('Tab');
  const focusInsideAfterTab = await page.evaluate(() => {
    const dialogElement = Array.from(document.querySelectorAll('[role="dialog"]')).find((element) =>
      /^(Navigation|\u5bfc\u822a)$/u.test(element.getAttribute('aria-label') ?? '')
    );
    return Boolean(dialogElement?.contains(document.activeElement));
  });
  const drawerScreenshot = path.join(outputDir, 'mobile-zh-admin-drawer-interaction.png');
  await prepareVisualQaPage(page);
  await page.screenshot({ path: drawerScreenshot, fullPage: true });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(50);
  const closedAfterEscape = await dialog.isHidden().catch(() => false);
  const overflowAfterClose = await page.evaluate(() => document.body.style.overflow);
  const triggerFocusedAfterClose = await menuButton.evaluate((element) => element === document.activeElement).catch(() => false);
  checks.push({
    id: 'mobile:/zh/admin:drawer-interaction',
    ok:
      overflowWhileOpen === 'hidden' &&
      mobileCloseNavigationName.test(focusedAfterOpen) &&
      focusInsideAfterTab &&
      closedAfterEscape &&
      overflowAfterClose !== 'hidden' &&
      triggerFocusedAfterClose,
    overflowWhileOpen,
    focusedAfterOpen,
    focusInsideAfterTab,
    closedAfterEscape,
    overflowAfterClose,
    triggerFocusedAfterClose,
    screenshot: drawerScreenshot,
  });
}

async function runAdminGlobalSearchChecks(page, outputDir, viewportId) {
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+K' : 'Control+K');
  const dialog = page.getByRole('dialog', { name: globalSearchDialogName });
  await dialog.waitFor({ state: 'visible', timeout: 5000 });
  const overflowWhileOpen = await page.evaluate(() => document.body.style.overflow);
  const input = page.getByLabel(globalSearchQueryName);
  await page
    .waitForFunction(
      (labels) => labels.includes(document.activeElement?.getAttribute('aria-label') ?? ''),
      [...globalSearchQueryLabels],
      { timeout: 1000 }
    )
    .catch(() => undefined);
  const inputFocused = await input.evaluate((element) => element === document.activeElement).catch(() => false);
  await input.fill('demo');
  await page.getByLabel(globalSearchTypeName).selectOption('module');
  await page.waitForTimeout(300);
  const screenshot = path.join(outputDir, `${viewportId}-zh-admin-global-search.png`);
  await prepareVisualQaPage(page);
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(50);
  const closedAfterEscape = await dialog.isHidden().catch(() => false);
  const overflowAfterClose = await page.evaluate(() => document.body.style.overflow);
  checks.push({
    id: `${viewportId}:/zh/admin:global-search`,
    ok: overflowWhileOpen === 'hidden' && inputFocused && closedAfterEscape && overflowAfterClose !== 'hidden',
    overflowWhileOpen,
    inputFocused,
    closedAfterEscape,
    overflowAfterClose,
    screenshot,
  });
}

async function gotoRoute(page, url, timeoutMs = 20_000) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForLoadState('networkidle', { timeout: 1_000 }).catch(() => undefined);
  await page.waitForTimeout(100);
  return response;
}

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    let loggedIn = false;
    for (const route of routes) {
      if (!routeAppliesToViewport(route, viewport.id)) {
        continue;
      }
      if (route.delegatedToModuleQuality) {
        checks.push({
          id: `${viewport.id}:${route.path}`,
          ok: true,
          delegatedToModuleQuality: true,
          moduleId: route.moduleId,
          source: route.source,
        });
        continue;
      }
      if (route.auth && !loggedIn) {
        await ensureAdminLogin(context, viewport.id);
        loggedIn = true;
      }
      const routePath = route.path;
      const id = `${viewport.id}:${routePath}`;
      const url = `${normalizedBaseUrl}${routePath}`;
      try {
        const response = await gotoRoute(page, url);
        const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
        const finalPath = new URL(page.url()).pathname;
        const screenshot = path.join(
          outputDir,
          `${viewport.id}-${routePath.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home'}.png`
        );
        await prepareVisualQaPage(page);
        await page.screenshot({ path: screenshot, fullPage: true });
        const status = response?.status() ?? 0;
        const contentOk = Array.isArray(route.contains)
          ? route.contains.some((token) => bodyText.includes(token))
          : route.contains
            ? bodyText.includes(route.contains)
            : bodyText.trim().length > 0;
        checks.push({
          id,
          ok: Boolean(
            response &&
              status >= 200 &&
              status < 400 &&
              contentOk &&
              (!route.auth || finalPath === route.path)
          ),
          status,
          finalPath,
          screenshot,
        });
        if (viewport.id === 'mobile' && routePath === '/zh/admin') {
          await runMobileAdminInteractionChecks(page, outputDir);
        }
        if (routePath === '/zh/admin') {
          await runAdminGlobalSearchChecks(page, outputDir, viewport.id);
        }
      } catch (error) {
        checks.push({
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

const result = {
  ok: checks.every((check) => check.ok),
  required,
  skipped: false,
  baseUrl: normalizedBaseUrl,
  outputDir,
  checkedAt: new Date().toISOString(),
  summary: {
    baseRoutes: baseRoutes.length,
    moduleQualityRoutes: moduleQualityRoutes.length,
  },
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

writeReport(result);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
