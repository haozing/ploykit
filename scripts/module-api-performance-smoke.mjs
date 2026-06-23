import fs from 'node:fs';
import path from 'node:path';
import {
  apiPerformanceCheckId,
  collectModuleApiPerformanceRoutes,
} from './module-quality-manifest.mjs';

const DEFAULT_MAX_P95_MS = 800;
const DEFAULT_MAX_RESPONSE_BYTES = 150000;

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
      : (process.env.MODULE_API_PERFORMANCE_REPEAT ?? (required ? '3' : '1'))
  ) || 1
);
const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'module-api-performance',
  new Date().toISOString().replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'module-api-performance.json');
const latestPath = path.resolve(process.cwd(), '.runtime', 'module-api-performance', 'latest.json');

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

function apiUrl(routePath) {
  return `${normalizedBaseUrl}/api/modules${routePath}`;
}

function apiMethod(route) {
  return (route.method ?? 'GET').toUpperCase();
}

async function ensureAdminLogin(context) {
  const loginUrl = `${normalizedBaseUrl}/api/auth/login`;
  const loginPageUrl = `${normalizedBaseUrl}/zh/login`;
  const response = await context.request.post(loginUrl, {
    headers: {
      origin: normalizedBaseUrl,
      referer: loginPageUrl,
      'x-forwarded-for': '10.203.0.10',
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

async function sampleRoute(context, route) {
  const method = apiMethod(route);
  if (method !== 'GET' && method !== 'HEAD') {
    return {
      id: apiPerformanceCheckId(route),
      ok: false,
      moduleId: route.moduleId,
      path: route.path,
      url: apiUrl(route.path),
      method,
      auth: route.auth ?? 'admin',
      samples: [],
      failures: [`API performance method "${method}" is not supported; use GET or HEAD.`],
    };
  }
  const samples = [];
  const url = apiUrl(route.path);
  for (let index = 0; index < repeat; index += 1) {
    const startedAt = performance.now();
    let response;
    try {
      response = await context.request.fetch(url, {
        method,
        headers: {
          accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
          'x-ploykit-smoke': 'module-api-performance',
        },
        maxRedirects: 0,
      });
      const durationMs = performance.now() - startedAt;
      const body = await response.body();
      const headers = response.headers();
      samples.push({
        ok: response.status() >= 200 && response.status() < 400,
        status: response.status(),
        durationMs: Math.round(durationMs * 10) / 10,
        responseBytes: body.byteLength,
        serverTiming: headers['server-timing'] ?? null,
        requestId: headers['x-request-id'] ?? headers['x-ploykit-request-id'] ?? null,
        routePath: headers['x-ploykit-route-path'] ?? null,
        matchedPath: headers['x-ploykit-matched-path'] ?? null,
      });
    } catch (error) {
      samples.push({
        ok: false,
        status: 0,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        responseBytes: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const durations = samples.map((sample) => sample.durationMs);
  const responseBytes = samples.map((sample) => sample.responseBytes);
  const p95Ms = percentile(durations, 95);
  const maxResponseBytesObserved = Math.max(0, ...responseBytes);
  const maxP95Ms = route.maxP95Ms ?? DEFAULT_MAX_P95_MS;
  const maxResponseBytes = route.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const statusesOk = samples.every((sample) => sample.ok);
  const timingOk = p95Ms <= maxP95Ms;
  const bytesOk = maxResponseBytesObserved <= maxResponseBytes;

  return {
    id: apiPerformanceCheckId(route),
    ok: statusesOk && timingOk && bytesOk,
    moduleId: route.moduleId,
    path: route.path,
    url,
    method,
    auth: route.auth ?? 'admin',
    samples,
    p95Ms,
    maxResponseBytesObserved,
    serverTimingHeaders: samples.filter((sample) => sample.serverTiming).length,
    budgets: {
      maxP95Ms,
      maxResponseBytes,
    },
    failures: [
      statusesOk ? undefined : 'one or more requests returned status >= 400',
      timingOk ? undefined : `p95Ms ${p95Ms} exceeded ${maxP95Ms}`,
      bytesOk
        ? undefined
        : `maxResponseBytes ${maxResponseBytesObserved} exceeded ${maxResponseBytes}`,
    ].filter(Boolean),
  };
}

const routes = collectModuleApiPerformanceRoutes().filter(
  (route) => moduleFilters.size === 0 || moduleFilters.has(route.moduleId)
);

if (routes.length === 0) {
  const report = {
    ok: true,
    required,
    skipped: true,
    reason: moduleFilters.size > 0
      ? `No module API performance routes matched ${[...moduleFilters].join(', ')}.`
      : 'No module API performance routes are declared.',
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
    reason: 'Playwright is not installed. Install playwright before running a required module API performance smoke.',
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
const checks = [];
const adminContext = await browser.newContext();
const anonymousContext = await browser.newContext();
try {
  if (routes.some((route) => (route.auth ?? 'admin') !== 'anonymous')) {
    checks.push(await ensureAdminLogin(adminContext));
  }
  for (const route of routes) {
    const context = (route.auth ?? 'admin') === 'anonymous' ? anonymousContext : adminContext;
    checks.push(await sampleRoute(context, route));
  }
} finally {
  await adminContext.close();
  await anonymousContext.close();
  await browser.close();
}

const routeChecks = checks.filter((check) => check.id !== 'auth-login');
const routeP95Ms = routeChecks
  .map((check) => check.p95Ms)
  .filter((value) => typeof value === 'number');
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
    p95Ms: percentile(routeP95Ms, 95),
    maxResponseBytesObserved: Math.max(
      0,
      ...routeChecks.map((check) => check.maxResponseBytesObserved ?? 0)
    ),
    serverTimingHeaders: routeChecks.reduce(
      (sum, check) => sum + (check.serverTimingHeaders ?? 0),
      0
    ),
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
