import fs from 'node:fs';
import path from 'node:path';

const required = process.argv.includes('--required');
const baseUrl =
  (process.argv.includes('--base-url')
    ? process.argv[process.argv.indexOf('--base-url') + 1]
    : process.env.HOST_SMOKE_BASE_URL) ?? 'http://localhost:3000';
const routeArg = process.argv.includes('--routes')
  ? process.argv[process.argv.indexOf('--routes') + 1]
  : process.env.HOST_DASHBOARD_TRANSITION_ROUTES;
const moduleIdArg = process.argv.includes('--module-id')
  ? process.argv[process.argv.indexOf('--module-id') + 1]
  : process.env.HOST_DASHBOARD_TRANSITION_MODULE_ID;
const explicitMaxDocumentNavigations = process.argv.includes('--max-document-navigations');
const explicitMaxHydrationErrors = process.argv.includes('--max-hydration-errors');
const explicitMaxP95Ms = process.argv.includes('--max-p95-ms');
const explicitMaxRscTransferBytes = process.argv.includes('--max-rsc-transfer-bytes');
const configuredMaxDocumentNavigations = Number(
  explicitMaxDocumentNavigations
    ? process.argv[process.argv.indexOf('--max-document-navigations') + 1]
    : (process.env.HOST_DASHBOARD_TRANSITION_MAX_DOCUMENT_NAVIGATIONS ?? '0')
);
const configuredMaxHydrationErrors = Number(
  explicitMaxHydrationErrors
    ? process.argv[process.argv.indexOf('--max-hydration-errors') + 1]
    : (process.env.HOST_DASHBOARD_TRANSITION_MAX_HYDRATION_ERRORS ?? '0')
);
const configuredMaxP95Ms = Number(
  explicitMaxP95Ms
    ? process.argv[process.argv.indexOf('--max-p95-ms') + 1]
    : (process.env.HOST_DASHBOARD_TRANSITION_MAX_P95_MS ?? '1000')
);
const configuredMaxRscTransferBytes = Number(
  explicitMaxRscTransferBytes
    ? process.argv[process.argv.indexOf('--max-rsc-transfer-bytes') + 1]
    : (process.env.HOST_DASHBOARD_TRANSITION_MAX_RSC_TRANSFER_BYTES ??
      (required || moduleIdArg ? '100000' : '0'))
);
const repeat = Math.max(
  1,
  Number(
    process.argv.includes('--repeat')
      ? process.argv[process.argv.indexOf('--repeat') + 1]
      : (process.env.HOST_DASHBOARD_TRANSITION_REPEAT ?? '1')
  ) || 1
);
const failFast = process.argv.includes('--fail-fast');
const injectAnchor = process.argv.includes('--inject-anchor');
const writeLatest = !process.argv.includes('--no-latest');
const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
const DEFAULT_ROUTES = '/zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files';
const DYNAMIC_ROUTE_PATTERN = /\[[^\]]+\]|\*|:[A-Za-z][A-Za-z0-9_]*/;

function asArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function readModuleManifest() {
  const manifestPath = path.resolve(process.cwd(), 'src', 'lib', 'module-map.manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { path: manifestPath, modules: [], error: 'Module map manifest is missing.' };
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return { path: manifestPath, modules: Array.isArray(manifest.modules) ? manifest.modules : [] };
  } catch (error) {
    return {
      path: manifestPath,
      modules: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function dashboardRoutePath(route) {
  if (typeof route !== 'string' || route.trim().length === 0) {
    return undefined;
  }
  const normalized = route.trim().startsWith('/') ? route.trim() : `/${route.trim()}`;
  if (normalized.startsWith('/zh/dashboard/')) {
    return normalized;
  }
  if (normalized === '/zh/dashboard') {
    return normalized;
  }
  if (normalized.startsWith('/dashboard/')) {
    return `/zh${normalized}`;
  }
  if (normalized === '/dashboard') {
    return '/zh/dashboard';
  }
  return normalized === '/' ? '/zh/dashboard' : `/zh/dashboard${normalized}`;
}

function isConcreteDashboardRoute(route) {
  return typeof route === 'string' && route.startsWith('/') && !DYNAMIC_ROUTE_PATTERN.test(route);
}

function explicitRoutesFromArg(value) {
  return (value ?? DEFAULT_ROUTES)
    .split(',')
    .map((route) => route.trim())
    .filter(Boolean)
    .map((route) => (route.startsWith('/') ? route : `/${route}`));
}

function routesFromModuleManifest(moduleId) {
  const manifest = readModuleManifest();
  const moduleInfo = manifest.modules.find((candidate) => candidate?.id === moduleId);
  if (!moduleInfo) {
    return {
      routes: [],
      source: {
        kind: 'module-id',
        moduleId,
        manifestPath: manifest.path,
        error: manifest.error ?? `Module "${moduleId}" was not found in module-map manifest.`,
      },
    };
  }

  const qualityRoutes = asArray(moduleInfo.quality?.performance?.dashboardTransitions?.routes);
  const transitionBudgets = moduleInfo.quality?.performance?.dashboardTransitions ?? {};
  const navigationRoutes = asArray(moduleInfo.navigation)
    .filter((item) => item?.location === 'dashboard.sidebar')
    .map((item) => item.path);
  const productRoutes = asArray(moduleInfo.product?.pages)
    .filter((page) => page?.shell === 'dashboard')
    .map((page) => page.samplePath ?? page.path);
  const normalizedRoutes = [...qualityRoutes, ...navigationRoutes, ...productRoutes]
    .map((route) => ({ route, normalized: dashboardRoutePath(route) }))
    .filter((entry) => entry.normalized);
  const invalidRoutes = normalizedRoutes
    .filter((entry) => !isConcreteDashboardRoute(entry.normalized))
    .map((entry) => entry.route);
  const routes = normalizedRoutes
    .map((entry) => entry.normalized)
    .filter(isConcreteDashboardRoute);
  const uniqueRoutes = [...new Set(routes)];
  return {
    routes: uniqueRoutes,
    invalidRoutes,
    source: {
      kind: 'module-id',
      moduleId,
      manifestPath: manifest.path,
      qualityRoutes: qualityRoutes.length,
      navigationRoutes: navigationRoutes.length,
      productRoutes: productRoutes.length,
      budgets: {
        maxDocumentNavigations: transitionBudgets.maxDocumentNavigations,
        maxHydrationErrors: transitionBudgets.maxHydrationErrors,
        maxP95Ms: transitionBudgets.maxP95Ms,
        maxRscTransferBytes: transitionBudgets.maxRscTransferBytes,
      },
    },
  };
}

function resolveRoutes() {
  if (routeArg) {
    return { routes: explicitRoutesFromArg(routeArg), source: { kind: 'routes-arg' } };
  }
  if (moduleIdArg) {
    return routesFromModuleManifest(moduleIdArg);
  }
  return { routes: explicitRoutesFromArg(DEFAULT_ROUTES), source: { kind: 'default' } };
}

const routeResolution = resolveRoutes();
const invalidRoutes = [
  ...(routeResolution.invalidRoutes ?? []),
  ...routeResolution.routes.filter((route) => !isConcreteDashboardRoute(route)),
];
const routes = routeResolution.routes.filter(isConcreteDashboardRoute);
function numericBudget(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

const moduleBudgets = routeResolution.source?.budgets ?? {};
const maxDocumentNavigations = explicitMaxDocumentNavigations
  ? configuredMaxDocumentNavigations
  : (numericBudget(moduleBudgets.maxDocumentNavigations) ?? configuredMaxDocumentNavigations);
const maxHydrationErrors = explicitMaxHydrationErrors
  ? configuredMaxHydrationErrors
  : (numericBudget(moduleBudgets.maxHydrationErrors) ?? configuredMaxHydrationErrors);
const maxP95Ms = explicitMaxP95Ms
  ? configuredMaxP95Ms
  : (numericBudget(moduleBudgets.maxP95Ms) ?? configuredMaxP95Ms);
const maxRscTransferBytes = explicitMaxRscTransferBytes
  ? configuredMaxRscTransferBytes
  : (numericBudget(moduleBudgets.maxRscTransferBytes) ?? configuredMaxRscTransferBytes);
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'dashboard-transition-smoke',
  new Date().toISOString().replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'dashboard-transition-smoke.json');
const latestPath = path.resolve(
  process.cwd(),
  '.runtime',
  'dashboard-transition-smoke',
  'latest.json'
);
const visualQaCss = `
  nextjs-portal {
    display: none !important;
    pointer-events: none !important;
  }
`;
let qaLoginIpCounter = 0;

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

async function ensureAdminLogin(context) {
  const loginUrl = `${normalizedBaseUrl}/api/auth/login`;
  const loginPageUrl = `${normalizedBaseUrl}/zh/login`;
  const response = await context.request.post(loginUrl, {
    headers: {
      origin: normalizedBaseUrl,
      referer: loginPageUrl,
      'x-forwarded-for': `10.207.${qaLoginIpCounter++}.10`,
    },
    form: {
      email: 'admin@example.com',
      password: 'Admin@123456',
      next: routes[0] ?? '/zh/dashboard',
    },
    maxRedirects: 0,
  });
  const sessionCookie = parseSetCookieHeader(response.headers()['set-cookie'], loginUrl);
  if (sessionCookie) {
    await context.addCookies([sessionCookie]);
  }
  const responseText = await response.text().catch(() => '');
  return {
    ok: (response.status() === 302 || response.status() === 303) && Boolean(sessionCookie),
    status: response.status(),
    cookieStored: Boolean(sessionCookie),
    responseText: responseText.slice(0, 500),
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

async function injectPlainDashboardAnchor(page, href) {
  await page.evaluate((targetHref) => {
    document.querySelector('[data-host-smoke-plain-anchor]')?.remove();
    const hostFrame = document.querySelector('[data-host-app-frame]');
    const link = document.createElement('a');
    link.href = targetHref;
    link.textContent = `Smoke transition to ${targetHref}`;
    link.setAttribute('data-host-smoke-plain-anchor', 'true');
    link.style.position = 'fixed';
    link.style.left = '8px';
    link.style.bottom = '8px';
    link.style.zIndex = '2147483647';
    link.style.padding = '8px 10px';
    link.style.background = '#111827';
    link.style.color = '#ffffff';
    link.style.borderRadius = '6px';
    link.style.fontSize = '12px';
    (hostFrame ?? document.body).appendChild(link);
  }, href);
}

async function collectPageDiagnostics(page) {
  return page.evaluate(() => {
    const appFrames = Array.from(document.querySelectorAll('[data-host-app-frame]')).map(
      (element) => ({
        area: element.getAttribute('data-host-app-frame') ?? '',
        childElementCount: element.childElementCount,
      })
    );
    const clientTransitionMarkers = Array.from(
      document.querySelectorAll('[data-host-client-transition-links]')
    ).map((element) => element.getAttribute('data-host-client-transition-links') ?? '');
    const injectedAnchor = document.querySelector('[data-host-smoke-plain-anchor="true"]');
    const injectedAnchorFrame = injectedAnchor?.closest('[data-host-app-frame]');
    return {
      url: window.location.href,
      appFrameCount: appFrames.length,
      appFrames,
      clientTransitionMarkers,
      injectedAnchorPresent: Boolean(injectedAnchor),
      injectedAnchorHref: injectedAnchor?.getAttribute('href') ?? null,
      injectedAnchorFrame: injectedAnchorFrame?.getAttribute('data-host-app-frame') ?? null,
    };
  });
}

function percentile(values, p) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[index]);
}

function maxNumber(values) {
  const numeric = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return numeric.length > 0 ? Math.max(...numeric) : 0;
}

function routePerformanceMetrics(routeList, transitionList, rscRequestList) {
  return routeList.map((route) => {
    const routeTransitions = transitionList.filter(
      (transition) => transition.expectedFinalPath === route || transition.to === route
    );
    const routeRscRequests = rscRequestList.filter((request) => request.path === route);
    const routeRscTransferBytes = routeRscRequests
      .map((request) => request.transferBytes)
      .filter((value) => typeof value === 'number');
    return {
      route,
      transitions: routeTransitions.length,
      p95Ms: percentile(
        routeTransitions.map((transition) => transition.durationMs),
        95
      ),
      maxDocumentNavigations: maxNumber(
        routeTransitions.map((transition) => transition.documentNavigationCount)
      ),
      maxHydrationErrors: maxNumber(
        routeTransitions.map((transition) => transition.hydrationErrorCount)
      ),
      rscRequests: routeRscRequests.length,
      rscTransferP95Bytes: percentile(routeRscTransferBytes, 95),
      dashboardTimingReports: routeRscRequests.filter((request) => request.dashboardTiming).length,
    };
  });
}

function transitionPairs(routeList) {
  const pairs = [];
  for (let cycle = 0; cycle < repeat; cycle += 1) {
    for (let index = 0; index < routeList.length - 1; index += 1) {
      pairs.push({
        repeatIndex: cycle + 1,
        from: routeList[index],
        to: routeList[index + 1],
        reset: false,
      });
    }
    if (cycle < repeat - 1) {
      pairs.push({
        repeatIndex: cycle + 1,
        from: routeList[routeList.length - 1],
        to: routeList[0],
        reset: true,
      });
    }
  }
  return pairs;
}

function isHydrationError(message) {
  return (
    message.includes('Minified React error #418') ||
    message.includes('Hydration failed') ||
    message.includes('A tree hydrated but some attributes of the server rendered HTML') ||
    message.includes("Text content doesn't match server-rendered HTML")
  );
}

function routeSlug(routePath) {
  return routePath.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'dashboard';
}

function localizedInjectedDashboardTarget(currentPath, targetPath) {
  const languageMatch = /^\/([a-z]{2}(?:-[A-Z]{2})?)\/dashboard(?:\/|$)/.exec(currentPath);
  if (!languageMatch) {
    return targetPath;
  }
  return targetPath === '/dashboard' || targetPath.startsWith('/dashboard/')
    ? `/${languageMatch[1]}${targetPath}`
    : targetPath;
}

function hasDashboardAppFrame(diagnostic) {
  return Array.isArray(diagnostic.appFrames)
    ? diagnostic.appFrames.some((frame) => frame.area === 'dashboard')
    : diagnostic.appFrameCount > 0;
}

function hasDashboardClientTransitionMarker(diagnostic) {
  return Array.isArray(diagnostic.clientTransitionMarkers)
    ? diagnostic.clientTransitionMarkers.includes('dashboard')
    : false;
}

function isRscRequestUrl(url) {
  try {
    return new URL(url).searchParams.has('_rsc');
  } catch {
    return false;
  }
}

function parseContentLength(headers) {
  const value = headers['content-length'];
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function fetchDashboardTiming(context, requestId) {
  const url = `${normalizedBaseUrl}/api/host/diagnostics/dashboard-timing?requestId=${encodeURIComponent(
    requestId
  )}`;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await context.request.get(url).catch((error) => ({ error }));
    if ('error' in response) {
      if (attempt === 4) {
        return {
          ok: false,
          requestId,
          error: response.error instanceof Error ? response.error.message : String(response.error),
        };
      }
    } else if (response.status() === 200) {
      return {
        ok: true,
        requestId,
        status: response.status(),
        report: (await response.json().catch(() => null))?.report ?? null,
      };
    } else if (attempt === 4 || response.status() !== 404) {
      return {
        ok: false,
        requestId,
        status: response.status(),
        body: await response.text().catch(() => ''),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
  }
  return { ok: false, requestId, error: 'Dashboard timing report was not available.' };
}

const loaded = await loadPlaywright();
if (invalidRoutes.length > 0) {
  const result = {
    ok: false,
    required,
    skipped: false,
    reason: 'Dashboard transition smoke routes must be concrete paths.',
    routes,
    invalidRoutes,
    routeSource: routeResolution.source,
    outputDir,
    checkedAt: new Date().toISOString(),
    artifacts: {
      report: reportPath,
      latest: latestPath,
    },
  };
  writeReport(result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
  process.exit();
}
const minimumRoutes = moduleIdArg ? 3 : 2;
if (routes.length < minimumRoutes) {
  const result = {
    ok: false,
    required,
    skipped: false,
    reason: moduleIdArg
      ? `Dashboard transition smoke requires at least three concrete module routes for --module-id ${moduleIdArg}.`
      : 'Dashboard transition smoke requires at least two routes.',
    routes,
    routeSource: routeResolution.source,
    outputDir,
    checkedAt: new Date().toISOString(),
    artifacts: {
      report: reportPath,
      latest: latestPath,
    },
  };
  writeReport(result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = 1;
  process.exit();
}

if ('error' in loaded) {
  const result = {
    ok: !required,
    required,
    skipped: true,
    reason:
      'Playwright is not installed. Install playwright before running a required dashboard transition smoke.',
    error: loaded.error,
    routes,
    routeSource: routeResolution.source,
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
const documentRequests = [];
const hydrationErrors = [];
const transitions = [];
const pageDiagnostics = [];
const rscRequestStarts = new Map();
const rscRequests = [];
const rscFailures = [];
const dashboardTimingReports = [];
const rscResponseTasks = [];
let successfulDashboardTimingReports = [];
let transitionDocumentNavigations = 0;
let routeMetrics = [];

async function drainResponseTasks() {
  let drained = 0;
  while (drained < rscResponseTasks.length) {
    const pending = rscResponseTasks.slice(drained);
    drained = rscResponseTasks.length;
    await Promise.allSettled(pending);
  }
}

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    extraHTTPHeaders: {
      'x-ploykit-smoke': 'dashboard-transition',
    },
  });
  const page = await context.newPage();
  checks.push({ id: 'auth-login', ...(await ensureAdminLogin(context)) });

  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    const text = message.text();
    if (isHydrationError(text)) {
      hydrationErrors.push(text);
    }
  });
  page.on('pageerror', (error) => {
    const text = error instanceof Error ? error.message : String(error);
    if (isHydrationError(text)) {
      hydrationErrors.push(text);
    }
  });
  page.on('request', (request) => {
    if (isRscRequestUrl(request.url())) {
      rscRequestStarts.set(request, Date.now());
    }
    if (!request.isNavigationRequest() || request.resourceType() !== 'document') {
      return;
    }
    documentRequests.push({
      url: request.url(),
      path: new URL(request.url()).pathname,
      method: request.method(),
      startedAt: Date.now(),
    });
  });
  page.on('response', (response) => {
    const request = response.request();
    if (!isRscRequestUrl(request.url())) {
      return;
    }
    const task = (async () => {
      const startedAt = rscRequestStarts.get(request) ?? Date.now();
      rscRequestStarts.delete(request);
      const headers = response.headers();
      const body = await response.body().catch(() => null);
      const contentLength = parseContentLength(headers);
      const requestId = headers['x-request-id'] ?? headers['x-ploykit-request-id'] ?? null;
      const rscRecord = {
        url: response.url(),
        path: new URL(response.url()).pathname,
        status: response.status(),
        durationMs: Date.now() - startedAt,
        transferBytes: contentLength ?? body?.byteLength ?? null,
        decodedBytes: body?.byteLength ?? null,
        serverTiming: headers['server-timing'] ?? null,
        requestId,
        dashboardTiming: null,
      };
      rscRequests.push(rscRecord);
      if (requestId) {
        const timing = await fetchDashboardTiming(context, requestId);
        rscRecord.dashboardTiming = timing.ok ? timing.report : null;
        dashboardTimingReports.push(timing);
      }
    })();
    rscResponseTasks.push(task);
  });
  page.on('requestfailed', (request) => {
    if (!isRscRequestUrl(request.url())) {
      return;
    }
    rscRequestStarts.delete(request);
    const failure = request.failure();
    rscFailures.push({
      url: request.url(),
      path: new URL(request.url()).pathname,
      errorText: failure?.errorText ?? 'unknown',
    });
  });

  const firstRoute = routes[0] ?? '/zh/dashboard';
  const firstResponse = await page.goto(`${normalizedBaseUrl}${firstRoute}`, {
    waitUntil: 'domcontentloaded',
    timeout: 20_000,
  });
  await page.waitForLoadState('networkidle', { timeout: 1_500 }).catch(() => undefined);
  checks.push({
    id: `initial:${firstRoute}`,
    ok: Boolean(firstResponse && firstResponse.status() >= 200 && firstResponse.status() < 400),
    status: firstResponse?.status() ?? 0,
    path: new URL(page.url()).pathname,
  });
  pageDiagnostics.push({ stage: `initial:${firstRoute}`, ...(await collectPageDiagnostics(page)) });
  const initialDocumentCount = documentRequests.length;

  for (const transitionPair of transitionPairs(routes)) {
    const { repeatIndex, from, to, reset } = transitionPair;
    const beforeDocuments = documentRequests.length;
    const beforeHydrationErrors = hydrationErrors.length;
    const currentPath = new URL(page.url()).pathname;
    const expectedFinalPath = injectAnchor ? localizedInjectedDashboardTarget(currentPath, to) : to;
    const start = Date.now();
    if (injectAnchor) {
      await injectPlainDashboardAnchor(page, to);
      pageDiagnostics.push({
        stage: `before-click:${from}->${to}`,
        repeatIndex,
        reset,
        expectedFinalPath,
        ...(await collectPageDiagnostics(page)),
      });
    }
    const targetLink = injectAnchor
      ? page.locator('[data-host-smoke-plain-anchor="true"]').first()
      : page.locator(`a[href="${to}"]`).first();
    const targetLinkCount = await targetLink.count();
    if (targetLinkCount === 0) {
      pageDiagnostics.push({
        stage: `missing-link:${from}->${to}`,
        repeatIndex,
        reset,
        ...(await collectPageDiagnostics(page)),
      });
      transitions.push({
        repeatIndex,
        from,
        to,
        reset,
        ok: false,
        durationMs: 0,
        finalPath: new URL(page.url()).pathname,
        expectedFinalPath,
        documentNavigationCount: 0,
        hydrationErrorCount: 0,
        error: injectAnchor
          ? `Injected dashboard anchor was not found for ${to}.`
          : `Dashboard navigation link was not found for ${to}.`,
      });
      if (failFast) {
        break;
      }
      continue;
    }
    await targetLink.click();
    await page.waitForURL(`**${expectedFinalPath}`, { timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState('networkidle', { timeout: 1_500 }).catch(() => undefined);
    await page.waitForTimeout(100);
    const diagnostics = await collectPageDiagnostics(page);
    const durationMs = Date.now() - start;
    const finalPath = new URL(page.url()).pathname;
    const documentNavigationCount = documentRequests.length - beforeDocuments;
    const hydrationErrorCount = hydrationErrors.length - beforeHydrationErrors;
    const screenshot = path.join(
      outputDir,
      repeat > 1
        ? `r${repeatIndex}-${reset ? 'reset-' : ''}${routeSlug(expectedFinalPath)}.png`
        : `${routeSlug(expectedFinalPath)}.png`
    );
    await prepareVisualQaPage(page);
    await page.screenshot({ path: screenshot, fullPage: true });
    pageDiagnostics.push({
      stage: `transition:${from}->${to}`,
      repeatIndex,
      reset,
      durationMs,
      documentNavigationCount,
      finalPath,
      expectedFinalPath,
      ...diagnostics,
    });
    const transition = {
      repeatIndex,
      from,
      to,
      reset,
      expectedFinalPath,
      ok:
        finalPath === expectedFinalPath &&
        documentNavigationCount <= maxDocumentNavigations &&
        hydrationErrorCount <= maxHydrationErrors,
      durationMs,
      finalPath,
      documentNavigationCount,
      hydrationErrorCount,
      screenshot,
      clicked: true,
      injectedAnchor: injectAnchor,
    };
    transitions.push(transition);
    if (!transition.ok && failFast) {
      break;
    }
  }

  await drainResponseTasks();
  const transitionDurations = transitions.map((transition) => transition.durationMs);
  routeMetrics = routePerformanceMetrics(routes, transitions, rscRequests);
  transitionDocumentNavigations = documentRequests.length - initialDocumentCount;
  checks.push({
    id: 'transition:document-navigation',
    ok: transitionDocumentNavigations <= maxDocumentNavigations,
    documentNavigations: transitionDocumentNavigations,
    maxDocumentNavigations,
  });
  checks.push({
    id: 'transition:hydration',
    ok: hydrationErrors.length <= maxHydrationErrors,
    hydrationErrors: hydrationErrors.length,
    maxHydrationErrors,
  });
  checks.push({
    id: 'transition:rsc-abort',
    ok: rscFailures.length === 0,
    rscFailures: rscFailures.length,
  });
  if (maxRscTransferBytes > 0) {
    checks.push({
      id: 'transition:rsc-transfer',
      ok:
        rscRequests.length === 0 ||
        percentile(
          rscRequests
            .map((request) => request.transferBytes)
            .filter((value) => typeof value === 'number'),
          95
        ) <= maxRscTransferBytes,
      p95Bytes: percentile(
        rscRequests
          .map((request) => request.transferBytes)
          .filter((value) => typeof value === 'number'),
        95
      ),
      maxRscTransferBytes,
    });
  }
  successfulDashboardTimingReports = dashboardTimingReports.filter(
    (item) => item?.ok === true && item.report
  );
  if (required || moduleIdArg) {
    checks.push({
      id: 'dashboard:timing-evidence',
      ok:
        rscRequests.length === 0 ||
        successfulDashboardTimingReports.length >= Math.min(rscRequests.length, transitions.length),
      reports: successfulDashboardTimingReports.length,
      rscRequests: rscRequests.length,
    });
  }
  checks.push({
    id: 'transition:p95',
    ok: percentile(transitionDurations, 95) <= maxP95Ms,
    p50Ms: percentile(transitionDurations, 50),
    p95Ms: percentile(transitionDurations, 95),
    maxP95Ms,
  });
  if (moduleIdArg) {
    checks.push(
      ...routeMetrics.map((metric) => {
        const documentOk = metric.maxDocumentNavigations <= maxDocumentNavigations;
        const hydrationOk = metric.maxHydrationErrors <= maxHydrationErrors;
        const p95Ok = metric.p95Ms <= maxP95Ms;
        const rscOk =
          maxRscTransferBytes <= 0 || metric.rscTransferP95Bytes <= maxRscTransferBytes;
        return {
          id: `transition:route-budget:${metric.route}`,
          ok: documentOk && hydrationOk && p95Ok && rscOk,
          route: metric.route,
          maxDocumentNavigations,
          maxHydrationErrors,
          maxP95Ms,
          maxRscTransferBytes,
          metric,
          failures: [
            documentOk
              ? undefined
              : `maxDocumentNavigations ${metric.maxDocumentNavigations} exceeded ${maxDocumentNavigations}`,
            hydrationOk
              ? undefined
              : `maxHydrationErrors ${metric.maxHydrationErrors} exceeded ${maxHydrationErrors}`,
            p95Ok ? undefined : `p95Ms ${metric.p95Ms} exceeded ${maxP95Ms}`,
            rscOk
              ? undefined
              : `rscTransferP95Bytes ${metric.rscTransferP95Bytes} exceeded ${maxRscTransferBytes}`,
          ].filter(Boolean),
        };
      })
    );
  }
  checks.push(
    ...transitions.map((transition, index) => ({
      id: `transition:${index + 1}:${transition.from}->${transition.to}`,
      ok: transition.ok,
      repeatIndex: transition.repeatIndex,
      reset: transition.reset,
      durationMs: transition.durationMs,
      finalPath: transition.finalPath,
      documentNavigationCount: transition.documentNavigationCount,
      hydrationErrorCount: transition.hydrationErrorCount,
      screenshot: transition.screenshot,
    }))
  );

  await context.close();
} finally {
  await browser.close();
}

const beforeClickDiagnostics = pageDiagnostics.filter((diagnostic) =>
  String(diagnostic.stage ?? '').startsWith('before-click:')
);
const appFramePresent = pageDiagnostics.some(hasDashboardAppFrame);
const clientTransitionMarkerPresent = pageDiagnostics.some(hasDashboardClientTransitionMarker);
const injectedAnchorInAppFrame =
  !injectAnchor ||
  (beforeClickDiagnostics.length > 0 &&
    beforeClickDiagnostics.every(
      (diagnostic) =>
        diagnostic.injectedAnchorPresent === true && diagnostic.injectedAnchorFrame === 'dashboard'
    ));

checks.push({
  id: 'shell:app-frame',
  ok: appFramePresent,
  area: 'dashboard',
});
checks.push({
  id: 'shell:client-transition-marker',
  ok: clientTransitionMarkerPresent,
  area: 'dashboard',
});
if (injectAnchor) {
  checks.push({
    id: 'shell:injected-anchor-frame',
    ok: injectedAnchorInAppFrame,
    area: 'dashboard',
    checkedAnchors: beforeClickDiagnostics.length,
  });
}

const result = {
  ok: checks.every((check) => check.ok),
  required,
  skipped: false,
  baseUrl: normalizedBaseUrl,
  outputDir,
  checkedAt: new Date().toISOString(),
  summary: {
    routes,
    routeMetrics,
    routeSource: routeResolution.source,
    moduleId: moduleIdArg ?? null,
    maxDocumentNavigations,
    maxHydrationErrors,
    maxP95Ms,
    maxRscTransferBytes,
    repeat,
    injectAnchor,
    writeLatest,
    transitions: transitions.length,
    resetTransitions: transitions.filter((transition) => transition.reset).length,
    p50Ms: percentile(
      transitions.map((transition) => transition.durationMs),
      50
    ),
    p95Ms: percentile(
      transitions.map((transition) => transition.durationMs),
      95
    ),
    documentNavigations: documentRequests.length,
    initialDocumentNavigations: documentRequests.length - transitionDocumentNavigations,
    transitionDocumentNavigations,
    rscRequests: rscRequests.length,
    rscFailures: rscFailures.length,
    rscP50Ms: percentile(
      rscRequests.map((request) => request.durationMs),
      50
    ),
    rscP95Ms: percentile(
      rscRequests.map((request) => request.durationMs),
      95
    ),
    rscTransferP95Bytes: percentile(
      rscRequests
        .map((request) => request.transferBytes)
        .filter((value) => typeof value === 'number'),
      95
    ),
    rscServerTimingHeaders: rscRequests.filter((request) => request.serverTiming).length,
    dashboardTimingReports: successfulDashboardTimingReports.length,
    hydrationErrors: hydrationErrors.length,
    appFramePresent,
    clientTransitionMarkerPresent,
    injectedAnchorInAppFrame,
  },
  checks,
  transitions,
  documentRequests,
  rscRequests,
  dashboardTimingReports,
  rscFailures,
  pageDiagnostics,
  hydrationErrors,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

writeReport(result);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
