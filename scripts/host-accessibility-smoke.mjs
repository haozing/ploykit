import fs from 'node:fs';
import path from 'node:path';
import {
  collectModuleQualityRoutes,
  routeAppliesToViewport,
} from './module-quality-manifest.mjs';

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
  'accessibility-smoke',
  new Date().toISOString().replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'accessibility-smoke.json');
const latestPath = path.resolve(process.cwd(), '.runtime', 'accessibility-smoke', 'latest.json');
const visualQaCss = `
  nextjs-portal {
    display: none !important;
    pointer-events: none !important;
  }
`;

function writeReport(report) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.copyFileSync(reportPath, latestPath);
}

const moduleQualityRoutes = collectModuleQualityRoutes('accessibility');

const routes = [
  { path: '/zh/docs', contains: '文档' },
  { path: '/zh/login', contains: '登录' },
  { path: '/zh/register', contains: '创建账号' },
  { path: '/zh/demo', contains: 'JSON / CSV 工具' },
  { path: '/zh/dashboard', auth: true, contains: 'admin@example.com' },
  ...moduleQualityRoutes,
  { path: '/zh/admin', auth: true, contains: '后台概览' },
  { path: '/zh/admin/modules', auth: true, contains: '模块' },
  { path: '/zh/admin/settings', auth: true, contains: '设置' },
  { path: '/zh/admin/service-connections', auth: true, contains: '服务连接' },
  { path: '/zh/admin/module-dev-console', auth: true, contains: '模块开发控制台' },
];

const viewports = [
  { id: 'desktop', width: 1280, height: 900 },
  { id: 'mobile', width: 390, height: 844 },
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
      'x-forwarded-for': `10.203.${qaLoginIpCounter++}.10`,
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

function screenshotName(viewport, routePath) {
  const routeSlug = routePath.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
  return `${viewport}-${routeSlug}.png`;
}

function routeContainsText(route, bodyText) {
  if (Array.isArray(route.contains)) {
    return route.contains.some((token) => bodyText.includes(token));
  }
  return typeof route.contains === 'string'
    ? bodyText.includes(route.contains)
    : bodyText.trim().length > 0;
}

async function gotoRoute(page, url) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  return response;
}

const loaded = await loadPlaywright();
if ('error' in loaded) {
  const result = {
    ok: !required,
    required,
    skipped: true,
    reason: 'Playwright is not installed. Install playwright before running a required accessibility smoke.',
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
      if (route.auth && !loggedIn) {
        checks.push({ id: `${viewport.id}:auth-login`, ...(await ensureAdminLogin(context)) });
        loggedIn = true;
      }

      const consoleErrors = [];
      const onConsole = (message) => {
        if (message.type() === 'error') {
          consoleErrors.push(message.text());
        }
      };
      page.on('console', onConsole);

      const url = `${normalizedBaseUrl}${route.path}`;
      try {
        const response = await gotoRoute(page, url);
        const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
        const screenshot = path.join(outputDir, screenshotName(viewport.id, route.path));
        await prepareVisualQaPage(page);
        await page.screenshot({ path: screenshot, fullPage: true });

        const audit = await page.evaluate(() => {
          const visible = (element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.visibility !== 'hidden' &&
              style.display !== 'none' &&
              rect.width > 0 &&
              rect.height > 0
            );
          };
          const nameOf = (element) =>
            (
              element.getAttribute('aria-label') ??
              element.getAttribute('title') ??
              element.textContent ??
              ''
            ).trim();
          const missingButtonNames = [...document.querySelectorAll('button, [role="button"]')]
            .filter(visible)
            .filter((element) => nameOf(element).length === 0)
            .map((element) => element.outerHTML.slice(0, 160));
          const missingLinkNames = [...document.querySelectorAll('a[href]')]
            .filter(visible)
            .filter((element) => nameOf(element).length === 0)
            .map((element) => element.outerHTML.slice(0, 160));
          const missingFormLabels = [
            ...document.querySelectorAll('input:not([type="hidden"]), textarea, select'),
          ]
            .filter(visible)
            .filter((element) => {
              const id = element.getAttribute('id');
              return !(
                element.getAttribute('aria-label') ||
                element.getAttribute('placeholder') ||
                (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) ||
                element.closest('label')
              );
            })
            .map((element) => element.outerHTML.slice(0, 160));
          const imagesWithoutAlt = [...document.querySelectorAll('img')]
            .filter(visible)
            .filter((element) => !element.hasAttribute('alt'))
            .map((element) => element.getAttribute('src') ?? 'img');
          const duplicateIds = [...document.querySelectorAll('[id]')]
            .map((element) => element.id)
            .filter((id, index, ids) => ids.indexOf(id) !== index);
          const focusableCount = [
            ...document.querySelectorAll(
              'a[href], button, input:not([type="hidden"]), textarea, select, [tabindex]:not([tabindex="-1"])'
            ),
          ].filter(visible).length;
          const documentWidth = document.documentElement.scrollWidth;
          const viewportWidth = document.documentElement.clientWidth;
          const main = document.querySelector('main');
          const firstHeading = document.querySelector('h1');
          return {
            missingButtonNames,
            missingLinkNames,
            missingFormLabels,
            imagesWithoutAlt,
            duplicateIds: [...new Set(duplicateIds)],
            focusableCount,
            hasMain: Boolean(main),
            hasHeading: Boolean(firstHeading && firstHeading.textContent?.trim()),
            horizontalOverflow: documentWidth > viewportWidth + 2,
            documentWidth,
            viewportWidth,
          };
        });

        const tabStops = [];
        for (let index = 0; index < 5; index += 1) {
          await page.keyboard.press('Tab');
          tabStops.push(
            await page.evaluate(() => ({
              tag: document.activeElement?.tagName ?? '',
              name:
                document.activeElement?.getAttribute('aria-label') ??
                document.activeElement?.getAttribute('title') ??
                document.activeElement?.textContent?.trim().slice(0, 80) ??
                '',
            }))
          );
        }

        const status = response?.status() ?? 0;
        checks.push({
          id: `${viewport.id}:${route.path}`,
          ok:
            status >= 200 &&
            status < 400 &&
            routeContainsText(route, bodyText) &&
            audit.missingButtonNames.length === 0 &&
            audit.missingLinkNames.length === 0 &&
            audit.missingFormLabels.length === 0 &&
            audit.imagesWithoutAlt.length === 0 &&
            audit.duplicateIds.length === 0 &&
            audit.hasMain &&
            audit.hasHeading &&
            !audit.horizontalOverflow &&
            (audit.focusableCount === 0 ||
              tabStops.some((item) => item.tag && item.tag !== 'BODY')) &&
            consoleErrors.length === 0,
          status,
          screenshot,
          audit,
          tabStops,
          consoleErrors,
        });
      } catch (error) {
        checks.push({
          id: `${viewport.id}:${route.path}`,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          consoleErrors,
        });
      } finally {
        page.off('console', onConsole);
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
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

writeReport(result);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
