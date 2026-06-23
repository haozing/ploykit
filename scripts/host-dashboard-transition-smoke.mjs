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
const maxDocumentNavigations = Number(
  process.argv.includes('--max-document-navigations')
    ? process.argv[process.argv.indexOf('--max-document-navigations') + 1]
    : (process.env.HOST_DASHBOARD_TRANSITION_MAX_DOCUMENT_NAVIGATIONS ?? '0')
);
const maxP95Ms = Number(
  process.argv.includes('--max-p95-ms')
    ? process.argv[process.argv.indexOf('--max-p95-ms') + 1]
    : (process.env.HOST_DASHBOARD_TRANSITION_MAX_P95_MS ?? '1000')
);
const maxRscTransferBytes = Number(
  process.argv.includes('--max-rsc-transfer-bytes')
    ? process.argv[process.argv.indexOf('--max-rsc-transfer-bytes') + 1]
    : (process.env.HOST_DASHBOARD_TRANSITION_MAX_RSC_TRANSFER_BYTES ?? '0')
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
const routes = (routeArg ?? '/zh/dashboard,/zh/dashboard/workspaces,/zh/dashboard/files')
  .split(',')
  .map((route) => route.trim())
  .filter(Boolean)
  .map((route) => (route.startsWith('/') ? route : `/${route}`));
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

const loaded = await loadPlaywright();
if (routes.length < 2) {
  const result = {
    ok: false,
    required,
    skipped: false,
    reason: 'Dashboard transition smoke requires at least two routes.',
    routes,
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
let transitionDocumentNavigations = 0;

try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
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
  page.on('response', async (response) => {
    const request = response.request();
    if (!isRscRequestUrl(request.url())) {
      return;
    }
    const startedAt = rscRequestStarts.get(request) ?? Date.now();
    rscRequestStarts.delete(request);
    const headers = response.headers();
    const body = await response.body().catch(() => null);
    const contentLength = parseContentLength(headers);
    rscRequests.push({
      url: response.url(),
      path: new URL(response.url()).pathname,
      status: response.status(),
      durationMs: Date.now() - startedAt,
      transferBytes: contentLength ?? body?.byteLength ?? null,
      decodedBytes: body?.byteLength ?? null,
      serverTiming: headers['server-timing'] ?? null,
    });
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
        hydrationErrorCount === 0,
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

  const transitionDurations = transitions.map((transition) => transition.durationMs);
  transitionDocumentNavigations = documentRequests.length - initialDocumentCount;
  checks.push({
    id: 'transition:document-navigation',
    ok: transitionDocumentNavigations <= maxDocumentNavigations,
    documentNavigations: transitionDocumentNavigations,
    maxDocumentNavigations,
  });
  checks.push({
    id: 'transition:hydration',
    ok: hydrationErrors.length === 0,
    hydrationErrors: hydrationErrors.length,
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
  checks.push({
    id: 'transition:p95',
    ok: percentile(transitionDurations, 95) <= maxP95Ms,
    p50Ms: percentile(transitionDurations, 50),
    p95Ms: percentile(transitionDurations, 95),
    maxP95Ms,
  });
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
    hydrationErrors: hydrationErrors.length,
    appFramePresent,
    clientTransitionMarkerPresent,
    injectedAnchorInAppFrame,
  },
  checks,
  transitions,
  documentRequests,
  rscRequests,
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
