/* eslint-disable no-console */

import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { performance } from 'perf_hooks';
import { resolve } from 'path';
import { URL } from 'url';
import { loadDockerDbEnv, maskDatabaseUrl } from './docker-db-env';

interface RouteCheck {
  path: string;
  kind: 'html' | 'xml' | 'api' | 'text';
  requireSeo?: boolean;
  requireCanonical?: boolean;
}

interface HttpTiming {
  status: number;
  ttfbMs: number;
  totalMs: number;
  bytes: number;
  body: string;
  contentType: string;
}

interface RouteResult {
  path: string;
  kind: RouteCheck['kind'];
  cold: Omit<HttpTiming, 'body'>;
  warm: Omit<HttpTiming, 'body'>;
  seo?: {
    title: string;
    description: string;
    canonical: string;
    h1: string;
    openGraphTitle: string;
    openGraphDescription: string;
  };
  status: 'passed' | 'failed';
  issues: string[];
}

interface PerfSummary {
  status: 'passed' | 'failed';
  appUrl: string;
  generatedAt: string;
  databaseUrl: string;
  thresholds: {
    maxWarmTotalMs: number;
    maxHtmlBytes: number;
    maxConcurrentTotalMs: number;
  };
  routes: RouteResult[];
  concurrency: ConcurrentRouteResult[];
}

interface ConcurrentRouteResult {
  path: string;
  requests: number;
  maxTotalMs: number;
  p95TotalMs: number;
  statuses: number[];
  status: 'passed' | 'failed';
  issues: string[];
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'prod-perf');
const STDOUT_PATH = resolve(RESULT_DIR, 'server.out.log');
const STDERR_PATH = resolve(RESULT_DIR, 'server.err.log');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');

const DEFAULT_ROUTES: RouteCheck[] = [
  { path: '/zh', kind: 'html', requireSeo: true, requireCanonical: true },
  { path: '/zh/about', kind: 'html', requireSeo: true, requireCanonical: true },
  { path: '/zh/pricing', kind: 'html', requireSeo: true, requireCanonical: true },
  { path: '/zh/contact', kind: 'html', requireSeo: true, requireCanonical: true },
  { path: '/zh/privacy', kind: 'html', requireSeo: true, requireCanonical: true },
  { path: '/zh/terms', kind: 'html', requireSeo: true, requireCanonical: true },
  { path: '/zh/json', kind: 'html', requireSeo: true, requireCanonical: true },
  { path: '/en/json', kind: 'html', requireSeo: true, requireCanonical: true },
  { path: '/zh/tools/pdf-ocr', kind: 'html', requireSeo: true, requireCanonical: true },
  { path: '/zh/tools/image-cutout', kind: 'html', requireSeo: true, requireCanonical: true },
  { path: '/sitemap.xml', kind: 'xml' },
  { path: '/sitemap/0.xml', kind: 'xml' },
  { path: '/robots.txt', kind: 'text' },
  { path: '/api/plans', kind: 'api' },
];

const CONCURRENT_ROUTES: RouteCheck[] = [
  { path: '/zh', kind: 'html' },
  { path: '/zh/json', kind: 'html' },
  { path: '/sitemap.xml', kind: 'xml' },
  { path: '/api/plans', kind: 'api' },
];

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  const port = Number(process.env.PROD_PERF_PORT || process.env.PORT || 3201);
  const host = process.env.PROD_PERF_HOST || '127.0.0.1';

  return {
    build: args.has('--build'),
    host,
    port,
    maxWarmTotalMs: Number(process.env.PROD_PERF_MAX_WARM_MS || 1000),
    maxHtmlBytes: Number(process.env.PROD_PERF_MAX_HTML_BYTES || 160_000),
    maxConcurrentTotalMs: Number(process.env.PROD_PERF_MAX_CONCURRENT_MS || 2000),
    concurrentRequests: Number(process.env.PROD_PERF_CONCURRENT_REQUESTS || 8),
  };
}

function cleanSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => key.length > 0 && !key.includes('=') && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  ) as NodeJS.ProcessEnv;
}

function createProdEnv(appUrl: string): NodeJS.ProcessEnv {
  return cleanSpawnEnv({
    ...loadDockerDbEnv(),
    NODE_ENV: 'production',
    PORT: new URL(appUrl).port,
    HOSTNAME: new URL(appUrl).hostname,
    NEXT_PUBLIC_APP_URL: appUrl,
    BETTER_AUTH_URL: appUrl,
    BETTER_AUTH_SECRET: 'local-docker-dev-secret-change-me-32-chars',
    AUTH_PASSWORD_RESET_DELIVERY: 'log',
    PLUGIN_SECRET_ENCRYPTION_KEY: 'local-plugin-secret-change-me-32-chars',
    PLUGIN_FILE_SIGNING_SECRET: 'local-plugin-file-signing-secret-change-me-32-chars',
    BILLING_ENABLED: 'false',
    BILLING_DEMO_API_ENABLED: 'true',
    FILE_STORAGE_ENABLED: 'true',
    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_LOCAL_ROOT: resolve(RESULT_DIR, 'blobs'),
    STRIPE_SECRET_KEY: 'sk_test_prod_perf_fake_key',
    STRIPE_WEBHOOK_SECRET: 'stripe_webhook_secret_prod_perf_fake_secret',
  });
}

function commandFor(name: string, args: string[], env: NodeJS.ProcessEnv) {
  if (name === 'npm' && env.npm_execpath) {
    return {
      file: process.execPath,
      args: [env.npm_execpath, ...args],
      display: [name, ...args].join(' '),
    };
  }

  return {
    file: process.platform === 'win32' && name === 'npm' ? 'npm.cmd' : name,
    args,
    display: [name, ...args].join(' '),
  };
}

async function runCommand(name: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const command = commandFor(name, args, env);
  console.log(`Running ${command.display}`);

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command.file, command.args, {
      cwd: process.cwd(),
      env: cleanSpawnEnv(env),
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(`${command.display} exited with code ${code}`));
    });
  });
}

function startServer(env: NodeJS.ProcessEnv): ChildProcess {
  const serverPath = resolve(process.cwd(), '.next', 'standalone', 'server.js');
  if (!existsSync(serverPath)) {
    throw new Error('Standalone server was not found. Run npm run build first.');
  }

  mkdirSync(RESULT_DIR, { recursive: true });
  const stdout = createWriteStream(STDOUT_PATH);
  const stderr = createWriteStream(STDERR_PATH);

  const child = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    env: cleanSpawnEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.pipe(stdout);
  child.stderr?.pipe(stderr);

  return child;
}

async function stopServer(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) {
    return;
  }

  child.kill();
  await Promise.race([
    new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise())),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 5000)),
  ]);

  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

async function fetchWithTiming(url: string): Promise<HttpTiming> {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const start = performance.now();

  return await new Promise<HttpTiming>((resolvePromise, reject) => {
    const req = client(
      target,
      {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'PloyKitProdPerf/1.0',
        },
      },
      (res) => {
        const firstByte = performance.now();
        const chunks: Buffer[] = [];

        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolvePromise({
            status: res.statusCode ?? 0,
            ttfbMs: Math.round(firstByte - start),
            totalMs: Math.round(performance.now() - start),
            bytes: Buffer.byteLength(body),
            body,
            contentType: String(res.headers['content-type'] ?? ''),
          });
        });
      }
    );

    req.setTimeout(30_000, () => {
      req.destroy(new Error(`Timed out while fetching ${url}`));
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitForServer(appUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetchWithTiming(`${appUrl}/api/plans`);
      if (response.status === 200) {
        return;
      }
      lastError = new Error(`Ready probe returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Production server did not become ready');
}

function matchHtml(body: string, pattern: RegExp): string {
  return body.match(pattern)?.[1]?.trim() ?? '';
}

function stripTags(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSeo(body: string): NonNullable<RouteResult['seo']> {
  return {
    title: matchHtml(body, /<title[^>]*>([\s\S]*?)<\/title>/i),
    description: matchHtml(body, /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i),
    canonical: matchHtml(body, /<link\s+rel=["']canonical["']\s+href=["']([^"']*)["']/i),
    h1: stripTags(matchHtml(body, /<h1[^>]*>([\s\S]*?)<\/h1>/i)),
    openGraphTitle: matchHtml(
      body,
      /<meta\s+property=["']og:title["']\s+content=["']([^"']*)["']/i
    ),
    openGraphDescription: matchHtml(
      body,
      /<meta\s+property=["']og:description["']\s+content=["']([^"']*)["']/i
    ),
  };
}

function withoutBody(timing: HttpTiming): Omit<HttpTiming, 'body'> {
  return {
    status: timing.status,
    ttfbMs: timing.ttfbMs,
    totalMs: timing.totalMs,
    bytes: timing.bytes,
    contentType: timing.contentType,
  };
}

async function measureRoute(
  appUrl: string,
  route: RouteCheck,
  thresholds: PerfSummary['thresholds']
): Promise<RouteResult> {
  const cold = await fetchWithTiming(`${appUrl}${route.path}`);
  const warm = await fetchWithTiming(`${appUrl}${route.path}`);
  const issues: string[] = [];

  if (warm.status !== 200) {
    issues.push(`Expected HTTP 200, got ${warm.status}`);
  }

  if (warm.totalMs > thresholds.maxWarmTotalMs) {
    issues.push(`Warm response ${warm.totalMs}ms exceeds ${thresholds.maxWarmTotalMs}ms`);
  }

  if (route.kind === 'html' && warm.bytes > thresholds.maxHtmlBytes) {
    issues.push(`HTML size ${warm.bytes} bytes exceeds ${thresholds.maxHtmlBytes} bytes`);
  }

  const seo = route.kind === 'html' ? extractSeo(warm.body) : undefined;
  if (route.requireSeo && seo) {
    if (!seo.title) issues.push('Missing <title>');
    if (!seo.description) issues.push('Missing meta description');
    if (!seo.h1) issues.push('Missing H1');
    if (!seo.openGraphTitle) issues.push('Missing og:title');
    if (!seo.openGraphDescription) issues.push('Missing og:description');
  }

  if (route.requireCanonical && !seo?.canonical) {
    issues.push('Missing canonical link');
  }

  return {
    path: route.path,
    kind: route.kind,
    cold: withoutBody(cold),
    warm: withoutBody(warm),
    seo,
    status: issues.length === 0 ? 'passed' : 'failed',
    issues,
  };
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? sorted[sorted.length - 1] ?? 0;
}

async function measureConcurrentRoute(
  appUrl: string,
  route: RouteCheck,
  thresholds: PerfSummary['thresholds'],
  requests: number
): Promise<ConcurrentRouteResult> {
  const timings = await Promise.all(
    Array.from({ length: requests }, () => fetchWithTiming(`${appUrl}${route.path}`))
  );
  const totals = timings.map((timing) => timing.totalMs);
  const statuses = timings.map((timing) => timing.status);
  const maxTotalMs = Math.max(...totals);
  const p95TotalMs = percentile(totals, 0.95);
  const issues: string[] = [];

  if (statuses.some((status) => status !== 200)) {
    issues.push(`Expected all HTTP 200, got ${[...new Set(statuses)].join(', ')}`);
  }
  if (maxTotalMs > thresholds.maxConcurrentTotalMs) {
    issues.push(
      `Concurrent max response ${maxTotalMs}ms exceeds ${thresholds.maxConcurrentTotalMs}ms`
    );
  }

  return {
    path: route.path,
    requests,
    maxTotalMs,
    p95TotalMs,
    statuses,
    status: issues.length === 0 ? 'passed' : 'failed',
    issues,
  };
}

async function main(): Promise<void> {
  const options = parseArgs();
  const appUrl = `http://${options.host}:${options.port}`;
  const env = createProdEnv(appUrl);
  let server: ChildProcess | null = null;

  mkdirSync(RESULT_DIR, { recursive: true });

  if (options.build) {
    await runCommand('npm', ['run', 'build'], env);
  }

  server = startServer(env);

  try {
    await waitForServer(appUrl, server);

    const thresholds = {
      maxWarmTotalMs: options.maxWarmTotalMs,
      maxHtmlBytes: options.maxHtmlBytes,
      maxConcurrentTotalMs: options.maxConcurrentTotalMs,
    };
    const routes: RouteResult[] = [];
    const concurrency: ConcurrentRouteResult[] = [];

    for (const route of DEFAULT_ROUTES) {
      const result = await measureRoute(appUrl, route, thresholds);
      routes.push(result);
      console.log(
        `${result.status.toUpperCase()} ${route.path} ` +
          `cold=${result.cold.totalMs}ms warm=${result.warm.totalMs}ms ` +
          `bytes=${result.warm.bytes}`
      );
      for (const issue of result.issues) {
        console.log(`  - ${issue}`);
      }
    }

    for (const route of CONCURRENT_ROUTES) {
      const result = await measureConcurrentRoute(
        appUrl,
        route,
        thresholds,
        options.concurrentRequests
      );
      concurrency.push(result);
      console.log(
        `${result.status.toUpperCase()} ${route.path} concurrent=${result.requests} ` +
          `p95=${result.p95TotalMs}ms max=${result.maxTotalMs}ms`
      );
      for (const issue of result.issues) {
        console.log(`  - ${issue}`);
      }
    }

    const summary: PerfSummary = {
      status:
        routes.every((route) => route.status === 'passed') &&
        concurrency.every((route) => route.status === 'passed')
          ? 'passed'
          : 'failed',
      appUrl,
      generatedAt: new Date().toISOString(),
      databaseUrl: maskDatabaseUrl(String(env.DATABASE_URL ?? '')),
      thresholds,
      routes,
      concurrency,
    };

    writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Wrote production perf summary to ${SUMMARY_PATH}`);

    if (summary.status !== 'passed') {
      process.exitCode = 1;
    }
  } finally {
    await stopServer(server);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
