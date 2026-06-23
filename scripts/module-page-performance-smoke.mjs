import fs from 'node:fs';
import path from 'node:path';
import {
  collectModulePagePerformanceRoutes,
  pagePerformanceCheckId,
} from './module-quality-manifest.mjs';

const DEFAULT_MAX_LOADER_MS = 500;
const DEFAULT_MAX_LOADER_DATA_BYTES = 100000;

const required = process.argv.includes('--required');
const writeLatest = !process.argv.includes('--no-latest');
const baseUrl = (
  process.argv.includes('--base-url')
    ? process.argv[process.argv.indexOf('--base-url') + 1]
    : process.env.HOST_SMOKE_BASE_URL
) ?? 'http://localhost:3000';
const repeat = Math.max(
  1,
  Number(
    process.argv.includes('--repeat')
      ? process.argv[process.argv.indexOf('--repeat') + 1]
      : (process.env.MODULE_PAGE_PERFORMANCE_REPEAT ?? (required ? '3' : '1'))
  ) || 1
);
const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'module-page-performance',
  new Date().toISOString().replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'module-page-performance.json');
const latestPath = path.resolve(process.cwd(), '.runtime', 'module-page-performance', 'latest.json');

function optionValues(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) {
      values.push(process.argv[index + 1]);
      index += 1;
    }
  }
  return values;
}

const moduleFilters = new Set(optionValues('--module-id').filter(Boolean));

function writeReport(report) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (writeLatest) {
    fs.mkdirSync(path.dirname(latestPath), { recursive: true });
    fs.copyFileSync(reportPath, latestPath);
  }
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

function percentile(values, percentileValue) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)
  );
  return sorted[index];
}

function substituteParams(pathname, params = {}) {
  return pathname
    .replace(/\[\.{3}([A-Za-z][A-Za-z0-9_]*)\]/g, (_match, key) => params[key] ?? `[...${key}]`)
    .replace(/\[([A-Za-z][A-Za-z0-9_]*)\]/g, (_match, key) => params[key] ?? `[${key}]`)
    .replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_match, key) => params[key] ?? `:${key}`);
}

function samplePath(route) {
  const sample = route.samplePath ?? substituteParams(route.path, route.params);
  return typeof sample === 'string' ? sample : undefined;
}

function dashboardPageUrl(route) {
  if ((route.shell ?? 'dashboard') !== 'dashboard') {
    return {
      error: `Page performance route "${route.path}" uses unsupported shell "${route.shell}".`,
    };
  }
  const sample = samplePath(route);
  if (!sample || !sample.startsWith('/') || /[[\]:]/.test(sample)) {
    return { error: `Page performance route "${route.path}" needs params or samplePath.` };
  }
  if (sample === '/zh/dashboard' || sample.startsWith('/zh/dashboard/')) {
    return { path: sample, url: `${normalizedBaseUrl}${sample}` };
  }
  if (sample === '/dashboard' || sample.startsWith('/dashboard/')) {
    return { path: `/zh${sample}`, url: `${normalizedBaseUrl}/zh${sample}` };
  }
  const dashboardPath = sample === '/' ? '/zh/dashboard' : `/zh/dashboard${sample}`;
  return { path: dashboardPath, url: `${normalizedBaseUrl}${dashboardPath}` };
}

function sampleUrl(url, index) {
  const next = new URL(url);
  next.searchParams.set('__ploykit_page_perf', `${Date.now()}-${index}`);
  return next.toString();
}

async function ensureAdminLogin(context) {
  const loginUrl = `${normalizedBaseUrl}/api/auth/login`;
  const loginPageUrl = `${normalizedBaseUrl}/zh/login`;
  const response = await context.request.post(loginUrl, {
    headers: {
      origin: normalizedBaseUrl,
      referer: loginPageUrl,
      'x-forwarded-for': '10.211.0.10',
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
    id: 'auth-login',
    ok: (response.status() === 302 || response.status() === 303) && Boolean(sessionCookie),
    status: response.status(),
    cookieStored: Boolean(sessionCookie),
  };
}

async function fetchDashboardTiming(context, requestId) {
  const url = `${normalizedBaseUrl}/api/host/diagnostics/dashboard-timing?requestId=${encodeURIComponent(
    requestId
  )}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await context.request.get(url).catch((error) => ({ error }));
    if ('error' in response) {
      if (attempt === 4) {
        return { ok: false, error: response.error?.message ?? String(response.error) };
      }
    } else if (response.status() === 200) {
      return {
        ok: true,
        report: (await response.json().catch(() => null))?.report ?? null,
      };
    } else if (attempt === 4 || response.status() !== 404) {
      return { ok: false, status: response.status(), body: await response.text().catch(() => '') };
    }
    await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
  }
  return { ok: false, error: 'Dashboard timing report was not available.' };
}

function moduleLoaderMs(report) {
  const spans = Array.isArray(report?.spans) ? report.spans : [];
  const loaderSpans = spans
    .filter((span) => span?.name === 'module-loader' && typeof span.durationMs === 'number')
    .map((span) => span.durationMs);
  return loaderSpans.length > 0 ? Math.max(...loaderSpans) : 0;
}

async function sampleRoute(page, context, route) {
  const target = dashboardPageUrl(route);
  if (target.error) {
    return {
      id: pagePerformanceCheckId(route),
      ok: false,
      moduleId: route.moduleId,
      shell: route.shell ?? 'dashboard',
      path: route.path,
      samplePath: route.samplePath ?? null,
      samples: [],
      error: target.error,
      failures: [target.error],
    };
  }

  const samples = [];
  for (let index = 0; index < repeat; index += 1) {
    const url = sampleUrl(target.url, index);
    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 20_000,
    }).catch((error) => ({ error }));
    await page.waitForLoadState('networkidle', { timeout: 1_500 }).catch(() => undefined);
    if (!response || 'error' in response) {
      samples.push({
        ok: false,
        status: 0,
        loaderMs: 0,
        loaderDataBytes: null,
        error: response?.error instanceof Error ? response.error.message : String(response?.error),
      });
      continue;
    }
    const headers = response.headers();
    const requestId = headers['x-request-id'] ?? headers['x-ploykit-request-id'] ?? null;
    const timing = requestId ? await fetchDashboardTiming(context, requestId) : null;
    const report = timing?.ok ? timing.report : null;
    samples.push({
      ok: response.status() >= 200 && response.status() < 400 && Boolean(report),
      status: response.status(),
      requestId,
      timingAvailable: Boolean(report),
      loaderMs: moduleLoaderMs(report),
      loaderDataBytes:
        typeof report?.loaderDataBytes === 'number' ? report.loaderDataBytes : null,
      loaderDataSizeUnavailableReason: report?.loaderDataSizeUnavailableReason,
      timingError: timing?.ok === false ? timing : undefined,
      url,
    });
  }

  const loaderDurations = samples.map((sample) => sample.loaderMs);
  const loaderBytes = samples
    .map((sample) => sample.loaderDataBytes)
    .filter((value) => typeof value === 'number');
  const p95LoaderMs = percentile(loaderDurations, 95);
  const maxLoaderDataBytesObserved = loaderBytes.length > 0 ? Math.max(...loaderBytes) : null;
  const maxLoaderMs = route.maxLoaderMs ?? DEFAULT_MAX_LOADER_MS;
  const maxLoaderDataBytes = route.maxLoaderDataBytes ?? DEFAULT_MAX_LOADER_DATA_BYTES;
  const statusesOk = samples.every((sample) => sample.ok);
  const timingOk = p95LoaderMs <= maxLoaderMs;
  const bytesOk =
    maxLoaderDataBytesObserved !== null && maxLoaderDataBytesObserved <= maxLoaderDataBytes;

  return {
    id: pagePerformanceCheckId(route),
    ok: statusesOk && timingOk && bytesOk,
    moduleId: route.moduleId,
    shell: route.shell ?? 'dashboard',
    path: route.path,
    samplePath: route.samplePath ?? null,
    url: target.url,
    samples,
    p95LoaderMs,
    maxLoaderDataBytesObserved,
    budgets: {
      maxLoaderMs,
      maxLoaderDataBytes,
    },
    failures: [
      statusesOk ? undefined : 'one or more page samples failed or lacked timing evidence',
      timingOk ? undefined : `p95LoaderMs ${p95LoaderMs} exceeded ${maxLoaderMs}`,
      bytesOk
        ? undefined
        : `maxLoaderDataBytes ${maxLoaderDataBytesObserved ?? 'missing'} exceeded ${maxLoaderDataBytes}`,
    ].filter(Boolean),
  };
}

const routes = collectModulePagePerformanceRoutes().filter(
  (route) => moduleFilters.size === 0 || moduleFilters.has(route.moduleId)
);

if (routes.length === 0) {
  const report = {
    ok: true,
    required,
    skipped: true,
    reason: moduleFilters.size > 0
      ? `No module page performance routes matched ${[...moduleFilters].join(', ')}.`
      : 'No module page performance routes are declared.',
    checkedAt: new Date().toISOString(),
    baseUrl: normalizedBaseUrl,
    outputDir,
    summary: {
      routes: 0,
      repeat,
    },
    checks: [],
    artifacts: {
      report: reportPath,
      latest: latestPath,
    },
  };
  writeReport(report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(0);
}

const loaded = await loadPlaywright();
if ('error' in loaded) {
  const report = {
    ok: !required,
    required,
    skipped: true,
    reason: 'Playwright is not installed. Install playwright before running a required module page performance smoke.',
    error: loaded.error,
    checkedAt: new Date().toISOString(),
    baseUrl: normalizedBaseUrl,
    outputDir,
    summary: {
      routes: routes.length,
      repeat,
    },
    checks: [],
    artifacts: {
      report: reportPath,
      latest: latestPath,
    },
  };
  writeReport(report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
  process.exit();
}

const browser = await loaded.chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  extraHTTPHeaders: {
    'x-ploykit-smoke': 'module-page-performance',
  },
});
const page = await context.newPage();
const auth = await ensureAdminLogin(context);
const checks = [auth];
try {
  for (const route of routes) {
    checks.push(await sampleRoute(page, context, route));
  }
} finally {
  await context.close();
  await browser.close();
}

const report = {
  ok: checks.every((check) => check.ok),
  required,
  skipped: false,
  checkedAt: new Date().toISOString(),
  baseUrl: normalizedBaseUrl,
  outputDir,
  summary: {
    routes: routes.length,
    repeat,
  },
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

writeReport(report);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
