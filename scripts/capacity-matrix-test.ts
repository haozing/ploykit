/* eslint-disable no-console */

import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { performance } from 'perf_hooks';
import { getDockerDatabaseUrl, loadDockerDbEnv, maskDatabaseUrl } from './docker-db-env';

type Status = 'passed' | 'failed' | 'skipped';

interface StepResult {
  name: string;
  status: Status;
  command?: string;
  durationMs?: number;
  exitCode?: number | null;
  detail?: string;
  error?: string;
}

interface CapacityMatrixOptions {
  build: boolean;
  prepare: boolean;
  host: string;
  port: number;
  scenarioRequestCount: number;
}

interface Thresholds {
  loginP95Ms: number;
  sitemapP95Ms: number;
  pluginApiP95Ms: number;
  fileUploadP95Ms: number;
  adminListP95Ms: number;
  maxRequestMs: number;
}

interface TimedFetchResult {
  status: number;
  totalMs: number;
  bytes: number;
  body: string;
  contentType: string;
  setCookies: string[];
  error?: string;
}

interface CapacityRequest {
  label: string;
  url: string;
  init?: RequestInit;
  expectedStatuses?: number[];
  validate?: (result: TimedFetchResult) => string[] | Promise<string[]>;
}

interface RequestResult {
  index: number;
  label: string;
  status: number;
  totalMs: number;
  bytes: number;
  issues: string[];
  error?: string;
}

interface ScenarioDefinition {
  id: string;
  description: string;
  coverage: string[];
  requests: number;
  p95ThresholdMs: number;
  maxThresholdMs: number;
  createRequest: (index: number) => CapacityRequest | Promise<CapacityRequest>;
}

interface ScenarioResult {
  id: string;
  description: string;
  coverage: string[];
  status: Status;
  requests: number;
  passedRequests: number;
  failedRequests: number;
  p95Ms: number;
  maxMs: number;
  minMs: number;
  avgMs: number;
  statusCodes: Record<string, number>;
  thresholds: {
    p95Ms: number;
    maxMs: number;
  };
  issues: string[];
  samples: RequestResult[];
}

interface CapacityMatrixSummary {
  status: Status;
  startedAt: string;
  finishedAt?: string;
  appUrl: string;
  databaseUrl: string;
  options: CapacityMatrixOptions;
  thresholds: Thresholds;
  steps: StepResult[];
  scenarios: ScenarioResult[];
  error?: string;
}

interface PluginListItem {
  id: string;
  installed: boolean;
  enabled?: boolean;
}

interface PluginListResponse {
  success?: boolean;
  plugins?: PluginListItem[];
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'capacity-matrix');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', '并发容量矩阵测试报告.md');
const STDOUT_PATH = resolve(RESULT_DIR, 'server.out.log');
const STDERR_PATH = resolve(RESULT_DIR, 'server.err.log');
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin@123456';
const PLUGIN_ID = 'sample-internal';

function parseOptions(): CapacityMatrixOptions {
  const args = new Set(process.argv.slice(2));
  const port = Number(process.env.CAPACITY_MATRIX_PORT || process.env.PORT || 3208);

  return {
    build: args.has('--build'),
    prepare: !args.has('--skip-prepare'),
    host: process.env.CAPACITY_MATRIX_HOST || '127.0.0.1',
    port,
    scenarioRequestCount: Number(process.env.CAPACITY_MATRIX_REQUESTS || 10),
  };
}

function readThresholds(): Thresholds {
  return {
    loginP95Ms: Number(process.env.CAPACITY_MATRIX_LOGIN_P95_MS || 2500),
    sitemapP95Ms: Number(process.env.CAPACITY_MATRIX_SITEMAP_P95_MS || 2000),
    pluginApiP95Ms: Number(process.env.CAPACITY_MATRIX_PLUGIN_API_P95_MS || 3000),
    fileUploadP95Ms: Number(process.env.CAPACITY_MATRIX_FILE_UPLOAD_P95_MS || 4000),
    adminListP95Ms: Number(process.env.CAPACITY_MATRIX_ADMIN_LIST_P95_MS || 3000),
    maxRequestMs: Number(process.env.CAPACITY_MATRIX_MAX_REQUEST_MS || 8000),
  };
}

function cleanSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => key.length > 0 && !key.includes('=') && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  ) as NodeJS.ProcessEnv;
}

function createEnv(appUrl: string): NodeJS.ProcessEnv {
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
    STRIPE_SECRET_KEY: 'sk_test_capacity_matrix_fake_key',
    STRIPE_WEBHOOK_SECRET: 'stripe_webhook_secret_capacity_matrix_fake_secret',
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

async function runCommandStep(
  summary: CapacityMatrixSummary,
  name: string,
  commandName: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  const command = commandFor(commandName, args, env);
  const started = Date.now();
  const step: StepResult = {
    name,
    status: 'failed',
    command: command.display,
  };

  summary.steps.push(step);
  console.log(`Running ${command.display}`);

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command.file, command.args, {
      cwd: process.cwd(),
      env: cleanSpawnEnv(env),
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      step.durationMs = Date.now() - started;
      step.error = error.stack || error.message;
      reject(error);
    });

    child.on('exit', (code) => {
      step.durationMs = Date.now() - started;
      step.exitCode = code;

      if (code === 0) {
        step.status = 'passed';
        resolvePromise();
        return;
      }

      step.error = `${command.display} exited with code ${code}`;
      reject(new Error(step.error));
    });
  });
}

function resetResultDir(): void {
  const expected = resolve(process.cwd(), 'test-results', 'capacity-matrix');
  if (RESULT_DIR !== expected) {
    throw new Error(`Refusing to clear unexpected result directory: ${RESULT_DIR}`);
  }

  rmSync(RESULT_DIR, { recursive: true, force: true });
  mkdirSync(RESULT_DIR, { recursive: true });
}

function startServer(env: NodeJS.ProcessEnv): ChildProcess {
  const serverPath = resolve(process.cwd(), '.next', 'standalone', 'server.js');
  if (!existsSync(serverPath)) {
    throw new Error('Standalone server was not found. Run npm run build first.');
  }

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

  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise())),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 5000)),
  ]);

  if (child.exitCode === null) {
    child.kill('SIGKILL');
  }
}

async function fetchWithTiming(request: CapacityRequest): Promise<TimedFetchResult> {
  const started = performance.now();

  try {
    const response = await fetch(request.url, request.init);
    const body = await response.text();
    return {
      status: response.status,
      totalMs: Math.round(performance.now() - started),
      bytes: Buffer.byteLength(body),
      body,
      contentType: response.headers.get('content-type') ?? '',
      setCookies: getSetCookies(response.headers),
    };
  } catch (error) {
    return {
      status: 0,
      totalMs: Math.round(performance.now() - started),
      bytes: 0,
      body: '',
      contentType: '',
      setCookies: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForServer(appUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next server exited early with code ${child.exitCode}`);
    }

    try {
      const result = await fetchWithTiming({
        label: 'ready',
        url: `${appUrl}/api/plans`,
        expectedStatuses: [200],
      });
      if (result.status === 200) {
        return;
      }
      lastError = new Error(`Ready probe returned HTTP ${result.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }

  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${appUrl}`);
}

function getSetCookies(headers: Headers): string[] {
  const cookieHeaders = headers as Headers & { getSetCookie?: () => string[] };
  const direct = cookieHeaders.getSetCookie?.();
  if (direct?.length) {
    return direct;
  }

  const combined = headers.get('set-cookie');
  if (!combined) {
    return [];
  }

  return combined.split(/,(?=\s*[^;,]+=)/).map((cookie) => cookie.trim());
}

function toCookieHeader(setCookies: string[]): string {
  return setCookies
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

function signInRequest(
  appUrl: string,
  options: { allowRateLimited?: boolean } = {}
): CapacityRequest {
  const expectedStatuses = options.allowRateLimited ? [200, 429] : [200];

  return {
    label: 'admin sign-in',
    url: `${appUrl}/api/auth/sign-in/email`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: appUrl,
        referer: `${appUrl}/en/login`,
        'x-requested-with': 'capacity-matrix-test',
      },
      body: JSON.stringify({
        email: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
        callbackURL: `${appUrl}/en`,
      }),
      redirect: 'manual',
    },
    expectedStatuses,
    validate: (result) => {
      if (result.status === 429) {
        const payload = parseJson(result.body);
        const lowerBody = result.body.toLowerCase();
        const rateLimitBody =
          lowerBody.includes('rate') ||
          lowerBody.includes('too many') ||
          lowerBody.includes('try again later');

        if (!hasRecordKey(payload, 'code') && !rateLimitBody) {
          return ['Rate-limited sign-in did not return a structured rate-limit response'];
        }
        return [];
      }

      if (result.status === 200 && result.setCookies.length === 0) {
        return ['Sign-in did not return a session cookie'];
      }
      return [];
    },
  };
}

async function signInAsAdmin(appUrl: string): Promise<string> {
  const request = signInRequest(appUrl);
  const result = await fetchWithTiming(request);
  const issues = await validateRequest(request, result);
  if (issues.length > 0) {
    throw new Error(`Admin sign-in failed: ${issues.join('; ')}; body=${result.body}`);
  }

  return toCookieHeader(result.setCookies);
}

function authHeaders(cookie: string, extra?: Record<string, string>): Record<string, string> {
  return {
    cookie,
    ...extra,
  };
}

function browserMutationHeaders(
  appUrl: string,
  cookie: string,
  extra?: Record<string, string>
): Record<string, string> {
  return authHeaders(cookie, {
    origin: appUrl,
    referer: `${appUrl}/en`,
    'sec-fetch-site': 'same-origin',
    'x-requested-with': 'capacity-matrix-test',
    ...extra,
  });
}

function jsonHeaders(appUrl: string, cookie: string): Record<string, string> {
  return browserMutationHeaders(appUrl, cookie, {
    'content-type': 'application/json',
  });
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function hasRecordKey(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && key in value;
}

async function requestJson<T>(
  request: CapacityRequest,
  expectedStatuses: number[] = [200]
): Promise<T> {
  const result = await fetchWithTiming({
    ...request,
    expectedStatuses,
  });
  const issues = await validateRequest(
    {
      ...request,
      expectedStatuses,
    },
    result
  );

  if (issues.length > 0) {
    throw new Error(`${request.label} failed: ${issues.join('; ')}; body=${result.body}`);
  }

  return parseJson(result.body) as T;
}

async function ensurePluginEnabled(
  summary: CapacityMatrixSummary,
  appUrl: string,
  cookie: string
): Promise<void> {
  const started = Date.now();
  const step: StepResult = {
    name: `ensure ${PLUGIN_ID} plugin enabled`,
    status: 'failed',
  };
  summary.steps.push(step);

  try {
    const listPlugins = async () =>
      requestJson<PluginListResponse>({
        label: 'list plugins',
        url: `${appUrl}/api/admin/plugins`,
        init: { headers: authHeaders(cookie) },
      });

    let plugins = await listPlugins();
    let plugin = plugins.plugins?.find((entry) => entry.id === PLUGIN_ID);

    if (!plugin) {
      throw new Error(`Plugin "${PLUGIN_ID}" was not found in runtime plugin list`);
    }

    if (!plugin.installed) {
      await requestJson({
        label: `install ${PLUGIN_ID}`,
        url: `${appUrl}/api/admin/plugins/${PLUGIN_ID}/install`,
        init: {
          method: 'POST',
          headers: authHeaders(cookie),
        },
      });
      plugins = await listPlugins();
      plugin = plugins.plugins?.find((entry) => entry.id === PLUGIN_ID);
    }

    if (!plugin?.enabled) {
      await requestJson({
        label: `enable ${PLUGIN_ID}`,
        url: `${appUrl}/api/admin/plugins/${PLUGIN_ID}/enable`,
        init: {
          method: 'POST',
          headers: authHeaders(cookie),
        },
      });
      plugins = await listPlugins();
      plugin = plugins.plugins?.find((entry) => entry.id === PLUGIN_ID);
    }

    if (!plugin?.installed || !plugin.enabled) {
      throw new Error(`Plugin "${PLUGIN_ID}" is not installed and enabled after setup`);
    }

    step.status = 'passed';
    step.durationMs = Date.now() - started;
    step.detail = 'installed=true enabled=true';
  } catch (error) {
    step.status = 'failed';
    step.durationMs = Date.now() - started;
    step.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  }
}

async function validateRequest(
  request: CapacityRequest,
  result: TimedFetchResult
): Promise<string[]> {
  const expectedStatuses = request.expectedStatuses ?? [200];
  const issues: string[] = [];

  if (result.error) {
    issues.push(result.error);
  }

  if (!expectedStatuses.includes(result.status)) {
    issues.push(`Expected HTTP ${expectedStatuses.join('/')}, got ${result.status}`);
  }

  if (request.validate) {
    issues.push(...(await request.validate(result)));
  }

  return issues;
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? sorted[sorted.length - 1] ?? 0;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

async function runScenario(definition: ScenarioDefinition): Promise<ScenarioResult> {
  const requestResults = await Promise.all(
    Array.from({ length: definition.requests }, async (_, index): Promise<RequestResult> => {
      const request = await definition.createRequest(index);
      const result = await fetchWithTiming(request);
      const issues = await validateRequest(request, result);

      return {
        index,
        label: request.label,
        status: result.status,
        totalMs: result.totalMs,
        bytes: result.bytes,
        issues,
        error: result.error,
      };
    })
  );

  const totals = requestResults.map((result) => result.totalMs);
  const p95Ms = percentile(totals, 0.95);
  const maxMs = Math.max(...totals);
  const minMs = Math.min(...totals);
  const avgMs = average(totals);
  const failedRequests = requestResults.filter((result) => result.issues.length > 0).length;
  const statusCodes = requestResults.reduce<Record<string, number>>((acc, result) => {
    const key = String(result.status);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const issues: string[] = [];

  if (failedRequests > 0) {
    issues.push(`${failedRequests} request(s) failed validation`);
  }
  if (p95Ms > definition.p95ThresholdMs) {
    issues.push(`p95 ${p95Ms}ms exceeds ${definition.p95ThresholdMs}ms`);
  }
  if (maxMs > definition.maxThresholdMs) {
    issues.push(`max ${maxMs}ms exceeds ${definition.maxThresholdMs}ms`);
  }

  const samples = requestResults
    .filter((result) => result.issues.length > 0)
    .concat([...requestResults].sort((a, b) => b.totalMs - a.totalMs).slice(0, 3))
    .slice(0, 8);

  return {
    id: definition.id,
    description: definition.description,
    coverage: definition.coverage,
    status: issues.length === 0 ? 'passed' : 'failed',
    requests: definition.requests,
    passedRequests: definition.requests - failedRequests,
    failedRequests,
    p95Ms,
    maxMs,
    minMs,
    avgMs,
    statusCodes,
    thresholds: {
      p95Ms: definition.p95ThresholdMs,
      maxMs: definition.maxThresholdMs,
    },
    issues,
    samples,
  };
}

function createFileUploadRequest(appUrl: string, cookie: string, index: number): CapacityRequest {
  const body = [
    `capacity matrix upload ${index}`,
    new Date().toISOString(),
    'This file is intentionally small; the scenario checks concurrent auth, multipart parsing, storage metadata, and blob writes.',
  ].join('\n');
  const formData = new FormData();
  formData.set('folder', 'capacity-matrix');
  formData.set(
    'file',
    new Blob([body], { type: 'text/plain' }),
    `capacity-matrix-${Date.now()}-${index}.txt`
  );

  return {
    label: 'user file upload',
    url: `${appUrl}/api/files`,
    init: {
      method: 'POST',
      headers: browserMutationHeaders(appUrl, cookie),
      body: formData,
    },
    expectedStatuses: [201],
    validate: (result) => {
      const payload = parseJson(result.body);
      if (!hasRecordKey(payload, 'file')) {
        return ['Upload response did not include file metadata'];
      }
      return [];
    },
  };
}

function createScenarios(
  appUrl: string,
  cookie: string,
  options: CapacityMatrixOptions,
  thresholds: Thresholds
): ScenarioDefinition[] {
  const baseRequests = Math.max(1, options.scenarioRequestCount);

  return [
    {
      id: 'auth.concurrent-sign-in',
      description:
        'Admin email sign-in endpoint under short concurrent burst with controlled rate limiting.',
      coverage: ['login', 'auth session cookie', 'auth rate limit'],
      requests: Math.max(6, baseRequests),
      p95ThresholdMs: thresholds.loginP95Ms,
      maxThresholdMs: thresholds.maxRequestMs,
      createRequest: () => signInRequest(appUrl, { allowRateLimited: true }),
    },
    {
      id: 'seo.concurrent-sitemap',
      description: 'Public sitemap.xml under concurrent crawler-style access.',
      coverage: ['sitemap', 'public SEO route'],
      requests: Math.max(12, baseRequests * 2),
      p95ThresholdMs: thresholds.sitemapP95Ms,
      maxThresholdMs: thresholds.maxRequestMs,
      createRequest: () => ({
        label: 'GET sitemap.xml',
        url: `${appUrl}/sitemap.xml`,
        init: {
          headers: {
            accept: 'application/xml,text/xml,*/*',
            'user-agent': 'PloyKitCapacityMatrix/1.0',
          },
        },
        validate: (result) => {
          if (!result.body.includes('<sitemapindex') && !result.body.includes('<urlset')) {
            return ['Sitemap response did not include sitemap XML'];
          }
          return [];
        },
      }),
    },
    {
      id: 'plugin.concurrent-api',
      description: 'Enabled plugin API reads and writes through the real Plugin Runtime.',
      coverage: ['plugin API', 'plugin storage collection', 'authenticated plugin route'],
      requests: Math.max(10, baseRequests),
      p95ThresholdMs: thresholds.pluginApiP95Ms,
      maxThresholdMs: thresholds.maxRequestMs,
      createRequest: (index) => {
        if (index % 3 === 0) {
          return {
            label: 'GET sample-internal notes',
            url: `${appUrl}/api/plugins/${PLUGIN_ID}/notes`,
            init: { headers: authHeaders(cookie) },
            validate: (result) => {
              const payload = parseJson(result.body);
              if (!hasRecordKey(payload, 'notes')) {
                return ['Plugin notes list response did not include notes'];
              }
              return [];
            },
          };
        }

        return {
          label: 'POST sample-internal note',
          url: `${appUrl}/api/plugins/${PLUGIN_ID}/notes`,
          init: {
            method: 'POST',
            headers: jsonHeaders(appUrl, cookie),
            body: JSON.stringify({
              title: `capacity-${Date.now()}-${index}`,
              status: index % 2 === 0 ? 'done' : 'open',
              body: 'Created by P2 capacity matrix.',
            }),
          },
          expectedStatuses: [201],
          validate: (result) => {
            const payload = parseJson(result.body);
            if (!hasRecordKey(payload, 'note')) {
              return ['Plugin note create response did not include note'];
            }
            return [];
          },
        };
      },
    },
    {
      id: 'files.concurrent-upload',
      description: 'Authenticated multipart file upload under concurrent writes.',
      coverage: ['file upload', 'local storage driver', 'file metadata'],
      requests: Math.max(6, Math.ceil(baseRequests * 0.8)),
      p95ThresholdMs: thresholds.fileUploadP95Ms,
      maxThresholdMs: thresholds.maxRequestMs,
      createRequest: (index) => createFileUploadRequest(appUrl, cookie, index),
    },
    {
      id: 'admin.concurrent-lists',
      description: 'Admin list endpoints used by dashboard tables under concurrent access.',
      coverage: ['admin users list', 'admin files list', 'admin plugins list'],
      requests: Math.max(12, baseRequests * 2),
      p95ThresholdMs: thresholds.adminListP95Ms,
      maxThresholdMs: thresholds.maxRequestMs,
      createRequest: (index) => {
        const paths = [
          '/api/admin/users?limit=10',
          '/api/admin/files?limit=10',
          '/api/admin/plugins',
        ];
        const path = paths[index % paths.length] ?? paths[0];

        return {
          label: `GET ${path}`,
          url: `${appUrl}${path}`,
          init: { headers: authHeaders(cookie) },
          validate: (result) => {
            const payload = parseJson(result.body);
            if (!payload || typeof payload !== 'object') {
              return ['Admin list response was not JSON'];
            }
            return [];
          },
        };
      },
    },
  ];
}

function writeSummary(summary: CapacityMatrixSummary): void {
  summary.finishedAt = new Date().toISOString();
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function writeReport(summary: CapacityMatrixSummary): void {
  const scenarioRows = summary.scenarios
    .map(
      (scenario) =>
        `| ${scenario.id} | ${scenario.status} | ${scenario.requests} | ${scenario.passedRequests}/${scenario.failedRequests} | ${scenario.p95Ms} | ${scenario.maxMs} | ${Object.entries(
          scenario.statusCodes
        )
          .map(([status, count]) => `${status}:${count}`)
          .join(', ')} |`
    )
    .join('\n');
  const stepRows = summary.steps
    .map(
      (step) =>
        `| ${step.name} | ${step.status} | ${step.durationMs ?? '-'} | ${step.command ?? step.detail ?? '-'} |`
    )
    .join('\n');
  const failedSamples = summary.scenarios
    .flatMap((scenario) =>
      scenario.samples
        .filter((sample) => sample.issues.length > 0)
        .map(
          (sample) =>
            `- ${scenario.id} #${sample.index} ${sample.label}: ${sample.issues.join('; ')}`
        )
    )
    .join('\n');

  writeFileSync(
    REPORT_PATH,
    `# 并发容量矩阵测试报告

更新时间：${new Date().toISOString()}

## 结论

- 状态：${summary.status}
- 应用地址：${summary.appUrl}
- 数据库：${summary.databaseUrl}
- 单场景基准请求数：${summary.options.scenarioRequestCount}
- 覆盖：登录、sitemap、插件 API、文件上传、后台列表

## 验收边界

本报告用于 P2-01 并发与容量验收。它不是极限压测，而是正式可用前的生产入口并发哨兵：在 production standalone 下，以真实 admin 登录态和真实插件 runtime 路径，对核心入口做短突发并发请求，验证 HTTP 状态、返回结构、p95 与单请求最大耗时。

## 场景

| 场景 | 状态 | 请求数 | 通过/失败 | p95 ms | max ms | 状态码 |
| ---- | ---- | ------ | --------- | ------ | ------ | ------ |
${scenarioRows}

## 步骤

| 步骤 | 状态 | 耗时 ms | 命令/详情 |
| ---- | ---- | ------- | --------- |
${stepRows}

## 阈值

- login p95：${summary.thresholds.loginP95Ms}ms
- sitemap p95：${summary.thresholds.sitemapP95Ms}ms
- plugin API p95：${summary.thresholds.pluginApiP95Ms}ms
- file upload p95：${summary.thresholds.fileUploadP95Ms}ms
- admin list p95：${summary.thresholds.adminListP95Ms}ms
- 单请求最大：${summary.thresholds.maxRequestMs}ms

## 失败样本

${failedSamples || '- 无'}

## 结果文件

- \`test-results/capacity-matrix/summary.json\`
- \`test-results/capacity-matrix/server.out.log\`
- \`test-results/capacity-matrix/server.err.log\`
`,
    'utf8'
  );
}

async function runSetup(summary: CapacityMatrixSummary, env: NodeJS.ProcessEnv): Promise<void> {
  if (!summary.options.prepare) {
    summary.steps.push({ name: 'prepare database and runtime', status: 'skipped' });
    return;
  }

  await runCommandStep(summary, 'docker db up', 'docker', ['compose', 'up', '-d', 'db'], env);
  await runCommandStep(summary, 'migration structure verify', 'npm', ['run', 'db:verify'], env);
  await runCommandStep(summary, 'docker db wait', 'npm', ['run', 'db:docker:wait'], env);
  await runCommandStep(summary, 'database migrate', 'npm', ['run', 'db:migrate'], env);
  await runCommandStep(summary, 'seed tool site', 'npm', ['run', 'seed:tool-site'], env);
  await runCommandStep(summary, 'runtime reconcile', 'npm', ['run', 'runtime:check'], env);
  await runCommandStep(summary, 'plugin contract check', 'npm', ['run', 'plugins:check'], env);
}

async function main(): Promise<void> {
  const options = parseOptions();
  const thresholds = readThresholds();
  const appUrl = `http://${options.host}:${options.port}`;
  const env = createEnv(appUrl);
  const summary: CapacityMatrixSummary = {
    status: 'failed',
    startedAt: new Date().toISOString(),
    appUrl,
    databaseUrl: maskDatabaseUrl(getDockerDatabaseUrl(env)),
    options,
    thresholds,
    steps: [],
    scenarios: [],
  };

  resetResultDir();

  let server: ChildProcess | null = null;

  try {
    await runSetup(summary, env);

    if (options.build) {
      await runCommandStep(summary, 'production build', 'npm', ['run', 'build'], env);
    }

    server = startServer(env);
    summary.steps.push({ name: 'standalone start', status: 'passed' });
    await waitForServer(appUrl, server);

    const adminCookie = await signInAsAdmin(appUrl);
    await ensurePluginEnabled(summary, appUrl, adminCookie);

    const scenarios = createScenarios(appUrl, adminCookie, options, thresholds);
    for (const scenario of scenarios) {
      console.log(`Running scenario ${scenario.id} (${scenario.requests} requests)`);
      const result = await runScenario(scenario);
      summary.scenarios.push(result);
      console.log(
        `${result.status.toUpperCase()} ${result.id} requests=${result.requests} ` +
          `p95=${result.p95Ms}ms max=${result.maxMs}ms failures=${result.failedRequests}`
      );
      for (const issue of result.issues) {
        console.log(`  - ${issue}`);
      }
    }

    summary.status = summary.scenarios.every((scenario) => scenario.status === 'passed')
      ? 'passed'
      : 'failed';

    if (summary.status !== 'passed') {
      process.exitCode = 1;
    }
  } catch (error) {
    summary.status = 'failed';
    summary.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    await stopServer(server);
    writeSummary(summary);
    writeReport(summary);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
