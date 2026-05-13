/* eslint-disable no-console */

import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { resolve } from 'path';
import { Window } from 'happy-dom';
import { loadDockerDbEnv, maskDatabaseUrl } from './docker-db-env';

type CheckStatus = 'passed' | 'failed';

interface HttpResponse {
  status: number;
  body: string;
  contentType: string;
}

interface CheckResult {
  name: string;
  status: CheckStatus;
  details?: Record<string, unknown>;
  issues: string[];
}

interface SeoSummary {
  status: CheckStatus;
  appUrl: string;
  generatedAt: string;
  databaseUrl: string;
  checks: CheckResult[];
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'seo-real');
const STDOUT_PATH = resolve(RESULT_DIR, 'server.out.log');
const STDERR_PATH = resolve(RESULT_DIR, 'server.err.log');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');

const EXPECTED_SITE_URLS = [
  '/zh',
  '/en',
  '/zh/about',
  '/en/about',
  '/zh/contact',
  '/en/contact',
  '/zh/pricing',
  '/en/pricing',
  '/zh/privacy',
  '/en/privacy',
  '/zh/terms',
  '/en/terms',
];

const EXPECTED_PLUGIN_URLS = [
  '/zh/tools/json-format',
  '/en/tools/json-format',
  '/zh/json',
  '/en/json',
  '/zh/tools/pdf-ocr',
  '/en/tools/pdf-ocr',
  '/zh/tools/image-cutout',
  '/en/tools/image-cutout',
];

const FORBIDDEN_SITEMAP_URL_PARTS = [
  '/admin',
  '/api/',
  '/plugins/',
  '/profile',
  '/billing',
  '/notifications',
  '/tasks',
  '/settings',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/success',
  '/tools/self-test',
  '/tools/dev-assets',
];

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  const port = Number(process.env.SEO_REAL_PORT || process.env.PORT || 3202);
  const host = process.env.SEO_REAL_HOST || '127.0.0.1';

  return {
    build: args.has('--build'),
    host,
    port,
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
    STRIPE_SECRET_KEY: 'sk_test_seo_real_fake_key',
    STRIPE_WEBHOOK_SECRET: 'stripe_webhook_secret_seo_real_fake_secret',
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

async function fetchText(url: string): Promise<HttpResponse> {
  const target = new URL(url);
  const client = target.protocol === 'https:' ? httpsRequest : httpRequest;

  return await new Promise<HttpResponse>((resolvePromise, reject) => {
    const req = client(
      target,
      {
        method: 'GET',
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'PloyKitSeoReal/1.0',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolvePromise({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
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
      const response = await fetchText(`${appUrl}/api/plans`);
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

function createCheck(
  name: string,
  issues: string[],
  details?: Record<string, unknown>
): CheckResult {
  return {
    name,
    status: issues.length === 0 ? 'passed' : 'failed',
    details,
    issues,
  };
}

type ParsedDocument = ReturnType<InstanceType<Window['DOMParser']>['parseFromString']>;

function parseXml(body: string): ParsedDocument {
  const window = new Window();
  return new window.DOMParser().parseFromString(body, 'application/xml');
}

function parseHtml(body: string): ParsedDocument {
  const window = new Window();
  return new window.DOMParser().parseFromString(body, 'text/html');
}

function readMetaContent(document: ParsedDocument, selector: string): string {
  return document.querySelector(selector)?.getAttribute('content')?.trim() ?? '';
}

function readStructuredData(document: ParsedDocument): unknown[] {
  return [...document.querySelectorAll('script[type="application/ld+json"]')]
    .map((node) => node.textContent?.trim() ?? '')
    .filter(Boolean)
    .map((text) => {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    })
    .filter((value): value is unknown => value !== null);
}

function readSitemapUrls(body: string): string[] {
  const document = parseXml(body);
  return [...document.querySelectorAll('url > loc')].map((node) => node.textContent?.trim() ?? '');
}

function readAlternateLinks(body: string) {
  const document = parseXml(body);
  return [...document.querySelectorAll('url')].map((urlNode) => ({
    loc: urlNode.querySelector('loc')?.textContent?.trim() ?? '',
    alternates: [...urlNode.getElementsByTagName('*')]
      .filter(
        (node) =>
          node.tagName.toLowerCase().endsWith('link') && node.getAttribute('rel') === 'alternate'
      )
      .map((node) => ({
        hreflang: node.getAttribute('hreflang'),
        href: node.getAttribute('href'),
      })),
  }));
}

async function checkSitemap(appUrl: string): Promise<CheckResult> {
  const response = await fetchText(`${appUrl}/sitemap.xml`);
  const issues: string[] = [];
  if (response.status !== 200) issues.push(`Expected HTTP 200, got ${response.status}`);
  if (!response.contentType.includes('xml')) {
    issues.push(`Expected XML content type, got ${response.contentType}`);
  }

  const urls = readSitemapUrls(response.body);
  const expected = [...EXPECTED_SITE_URLS, ...EXPECTED_PLUGIN_URLS].map(
    (path) => `${appUrl}${path}`
  );

  for (const url of expected) {
    if (!urls.includes(url)) {
      issues.push(`Missing sitemap URL: ${url}`);
    }
  }

  for (const forbidden of FORBIDDEN_SITEMAP_URL_PARTS) {
    if (urls.some((url) => new URL(url).pathname.includes(forbidden))) {
      issues.push(`Sitemap contains forbidden path fragment: ${forbidden}`);
    }
  }

  const duplicates = urls.filter((url, index) => urls.indexOf(url) !== index);
  if (duplicates.length > 0) {
    issues.push(`Sitemap contains duplicate URLs: ${[...new Set(duplicates)].join(', ')}`);
  }

  const alternates = readAlternateLinks(response.body);
  const zhHome = alternates.find((item) => item.loc === `${appUrl}/zh`);
  if (!zhHome?.alternates.some((item) => item.hreflang === 'en' && item.href === `${appUrl}/en`)) {
    issues.push('Missing hreflang alternate for /zh -> /en');
  }

  return createCheck('sitemap.xml', issues, {
    urlCount: urls.length,
    sample: urls.slice(0, 12),
  });
}

async function checkRobots(appUrl: string): Promise<CheckResult> {
  const response = await fetchText(`${appUrl}/robots.txt`);
  const issues: string[] = [];

  if (response.status !== 200) issues.push(`Expected HTTP 200, got ${response.status}`);
  for (const expected of ['User-Agent: *', 'Disallow: /api/', 'Disallow: /admin/']) {
    if (!response.body.includes(expected)) {
      issues.push(`robots.txt missing "${expected}"`);
    }
  }
  if (!response.body.includes(`Sitemap: ${appUrl}/sitemap.xml`)) {
    issues.push('robots.txt missing root sitemap reference');
  }
  if (!response.body.includes(`Sitemap: ${appUrl}/sitemap/0.xml`)) {
    issues.push('robots.txt missing chunk sitemap reference');
  }

  return createCheck('robots.txt', issues, {
    lines: response.body.split(/\r?\n/).filter(Boolean).slice(0, 20),
  });
}

async function checkSitemapChunk(appUrl: string): Promise<CheckResult> {
  const response = await fetchText(`${appUrl}/sitemap/0.xml`);
  const issues: string[] = [];
  if (response.status !== 200) issues.push(`Expected HTTP 200, got ${response.status}`);
  const urls = readSitemapUrls(response.body);
  if (!urls.includes(`${appUrl}/zh`)) {
    issues.push('Chunk sitemap is missing /zh');
  }
  if (urls.length === 0) {
    issues.push('Chunk sitemap has no URLs');
  }

  return createCheck('sitemap chunk', issues, { urlCount: urls.length });
}

async function checkCanonical(
  appUrl: string,
  path: string,
  expectedCanonical: string,
  options: {
    requireOgImage?: boolean;
    requireStructuredData?: boolean;
  } = {}
) {
  const response = await fetchText(`${appUrl}${path}`);
  const issues: string[] = [];
  if (response.status !== 200) issues.push(`Expected HTTP 200, got ${response.status}`);

  const document = parseHtml(response.body);
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '';
  if (canonical !== `${appUrl}${expectedCanonical}`) {
    issues.push(
      `Expected canonical ${appUrl}${expectedCanonical}, got ${canonical || '<missing>'}`
    );
  }

  if (!document.querySelector('meta[property="og:title"]')) {
    issues.push('Missing og:title');
  }
  if (!document.querySelector('meta[property="og:description"]')) {
    issues.push('Missing og:description');
  }
  const ogImage = readMetaContent(document, 'meta[property="og:image"]');
  if (options.requireOgImage && !ogImage) {
    issues.push('Missing og:image');
  }
  if (!document.querySelector('meta[name="description"]')) {
    issues.push('Missing meta description');
  }
  if (options.requireOgImage && ogImage) {
    const imageResponse = await fetchText(ogImage);
    if (imageResponse.status !== 200) {
      issues.push(`Expected og:image HTTP 200, got ${imageResponse.status}`);
    }
    if (!imageResponse.contentType.startsWith('image/')) {
      issues.push(`Expected og:image content type image/*, got ${imageResponse.contentType}`);
    }
  }
  if (options.requireStructuredData) {
    const structuredData = readStructuredData(document);
    if (structuredData.length === 0) {
      issues.push('Missing application/ld+json structured data');
    }
    if (
      !structuredData.some(
        (value) =>
          typeof value === 'object' && value !== null && '@context' in value && '@type' in value
      )
    ) {
      issues.push('Structured data is missing @context/@type');
    }
  }

  return createCheck(`metadata ${path}`, issues, { canonical, ogImage });
}

async function checkNoindexRoute(appUrl: string, path: string): Promise<CheckResult> {
  const [pageResponse, sitemapResponse] = await Promise.all([
    fetchText(`${appUrl}${path}`),
    fetchText(`${appUrl}/sitemap.xml`),
  ]);
  const issues: string[] = [];

  if (pageResponse.status !== 200) issues.push(`Expected HTTP 200, got ${pageResponse.status}`);
  const document = parseHtml(pageResponse.body);
  const robots = readMetaContent(document, 'meta[name="robots"]');
  if (!robots.toLowerCase().includes('noindex')) {
    issues.push(`Expected noindex robots meta, got ${robots || '<missing>'}`);
  }
  if (sitemapResponse.status === 200) {
    const sitemapUrls = readSitemapUrls(sitemapResponse.body);
    if (sitemapUrls.some((url) => new URL(url).pathname === path)) {
      issues.push(`Noindex route is present in sitemap: ${path}`);
    }
  }

  return createCheck(`noindex ${path}`, issues, { robots });
}

async function checkOpenGraphImageEndpoint(appUrl: string): Promise<CheckResult> {
  const response = await fetchText(`${appUrl}/opengraph-image`);
  const issues: string[] = [];

  if (response.status !== 200) issues.push(`Expected HTTP 200, got ${response.status}`);
  if (!response.contentType.startsWith('image/')) {
    issues.push(`Expected image/* content type, got ${response.contentType}`);
  }

  return createCheck('opengraph image endpoint', issues, {
    contentType: response.contentType,
    bytes: Buffer.byteLength(response.body),
  });
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

    const checks = [
      await checkSitemap(appUrl),
      await checkRobots(appUrl),
      await checkSitemapChunk(appUrl),
      await checkCanonical(appUrl, '/zh', '/zh', { requireOgImage: true }),
      await checkCanonical(appUrl, '/zh/json', '/zh/json', {
        requireOgImage: true,
        requireStructuredData: true,
      }),
      await checkCanonical(appUrl, '/zh/tools/json-format', '/zh/tools/json-format', {
        requireOgImage: true,
        requireStructuredData: true,
      }),
      await checkNoindexRoute(appUrl, '/zh/tools/dev-assets'),
      await checkOpenGraphImageEndpoint(appUrl),
    ];

    for (const check of checks) {
      console.log(`${check.status.toUpperCase()} ${check.name}`);
      for (const issue of check.issues) {
        console.log(`  - ${issue}`);
      }
    }

    const summary: SeoSummary = {
      status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
      appUrl,
      generatedAt: new Date().toISOString(),
      databaseUrl: maskDatabaseUrl(String(env.DATABASE_URL ?? '')),
      checks,
    };

    writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`Wrote SEO real test summary to ${SUMMARY_PATH}`);

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
