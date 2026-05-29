import fs from 'node:fs';
import path from 'node:path';

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
  'theme-matrix',
  new Date().toISOString().replace(/[:.]/g, '-')
);
const visualQaCss = `
  nextjs-portal {
    display: none !important;
    pointer-events: none !important;
  }
`;

const routes = [
  { path: '/zh/admin', auth: true, contains: '后台概览' },
  { path: '/zh/admin/modules', auth: true, contains: '模块' },
  { path: '/zh/dashboard', auth: true, contains: '欢迎回来' },
  { path: '/zh/admin/module-dev-console', auth: true, contains: '模块开发控制台' },
];

const viewports = [
  { id: 'desktop', width: 1440, height: 1000 },
  { id: 'mobile', width: 390, height: 844 },
];

const themes = [
  { id: 'light', stored: 'light', colorScheme: 'light', expected: 'light' },
  { id: 'dark', stored: 'dark', colorScheme: 'dark', expected: 'dark' },
  { id: 'system', stored: 'system', colorScheme: 'dark', expected: 'dark' },
];
let qaLoginIpCounter = 0;

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
    secure: url.protocol === 'https:' || setCookieHeader.toLowerCase().includes('secure'),
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
      'x-forwarded-for': `10.202.${qaLoginIpCounter++}.10`,
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
  return {
    ok: (response.status() === 302 || response.status() === 303) && Boolean(sessionCookie),
    status: response.status(),
    cookieStored: Boolean(sessionCookie),
  };
}

function screenshotName(viewport, theme, routePath) {
  const routeSlug = routePath.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
  return `${viewport}-${theme}-${routeSlug}.png`;
}

const loaded = await loadPlaywright();
if ('error' in loaded) {
  const result = {
    ok: !required,
    skipped: true,
    reason: 'Playwright is not installed. Install playwright before running a required theme matrix.',
    error: loaded.error,
    checkedAt: new Date().toISOString(),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
  process.exit();
}

fs.mkdirSync(outputDir, { recursive: true });
const browser = await loaded.chromium.launch();
const checks = [];

try {
  for (const viewport of viewports) {
    for (const theme of themes) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: theme.colorScheme,
      });
      await context.addInitScript((storedTheme) => {
        window.localStorage.setItem('ploykit-theme', storedTheme);
      }, theme.stored);
      checks.push({ id: `${viewport.id}:${theme.id}:auth-login`, ...(await ensureAdminLogin(context)) });

      const page = await context.newPage();
      const consoleErrors = [];
      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text());
        }
      });

      for (const route of routes) {
        const url = `${normalizedBaseUrl}${route.path}`;
        const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 20_000 });
        await page.waitForFunction(
          (expectedTheme) => document.documentElement.getAttribute('data-theme') === expectedTheme,
          theme.expected,
          { timeout: 5_000 }
        );
        const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
        const themeState = await page.evaluate(() => ({
          dataTheme: document.documentElement.getAttribute('data-theme'),
          storedTheme: window.localStorage.getItem('ploykit-theme'),
          background: getComputedStyle(document.body).backgroundColor,
          color: getComputedStyle(document.body).color,
        }));
        const mainBox = await page.locator('main, body').first().boundingBox();
        const screenshot = path.join(outputDir, screenshotName(viewport.id, theme.id, route.path));
        await prepareVisualQaPage(page);
        await page.screenshot({ path: screenshot, fullPage: true });
        const status = response?.status() ?? 0;

        checks.push({
          id: `${viewport.id}:${theme.id}:${route.path}`,
          ok:
            status >= 200 &&
            status < 400 &&
            bodyText.includes(route.contains) &&
            themeState.dataTheme === theme.expected &&
            themeState.storedTheme === theme.stored &&
            Boolean(mainBox && mainBox.width > 0 && mainBox.height > 0) &&
            consoleErrors.length === 0,
          status,
          screenshot,
          theme: themeState,
          consoleErrors,
        });
      }

      await context.close();
    }
  }
} finally {
  await browser.close();
}

const result = {
  ok: checks.every((check) => check.ok),
  skipped: false,
  baseUrl: normalizedBaseUrl,
  outputDir,
  checkedAt: new Date().toISOString(),
  checks,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
