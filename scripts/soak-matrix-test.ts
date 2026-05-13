/* eslint-disable no-console */

import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import postgres from 'postgres';
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

interface SoakOptions {
  build: boolean;
  prepare: boolean;
  host: string;
  port: number;
  durationSeconds: number;
  intervalMs: number;
  maxHeapGrowthMb: number;
  maxRssGrowthMb: number;
  maxFailureRate: number;
  maxBacklogGrowth: number;
}

interface ProbeResult {
  name: string;
  status: number;
  ok: boolean;
  durationMs: number;
  bytes: number;
  error?: string;
}

interface IterationResult {
  index: number;
  elapsedMs: number;
  probes: ProbeResult[];
  memory: NodeJS.MemoryUsage;
  queues: QueueSnapshot;
}

interface QueueSnapshot {
  outboxPending: number;
  outboxFailed: number;
  webhookRetryable: number;
  jobDeadLetter: number;
}

interface SoakSummary {
  status: Status;
  startedAt: string;
  finishedAt?: string;
  appUrl: string;
  databaseUrl: string;
  options: SoakOptions;
  steps: StepResult[];
  iterations: IterationResult[];
  aggregate?: {
    iterations: number;
    requests: number;
    failedRequests: number;
    failureRate: number;
    p95Ms: number;
    maxMs: number;
    heapGrowthMb: number;
    rssGrowthMb: number;
    backlogGrowth: QueueSnapshot;
  };
  issues: string[];
  error?: string;
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'soak-matrix');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', '长时间Soak矩阵测试报告.md');
const STDOUT_PATH = resolve(RESULT_DIR, 'server.out.log');
const STDERR_PATH = resolve(RESULT_DIR, 'server.err.log');
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin@123456';

function parseOptions(): SoakOptions {
  const args = new Set(process.argv.slice(2));
  const durationSeconds = Number(process.env.SOAK_MATRIX_DURATION_SECONDS || 45);

  return {
    build: args.has('--build'),
    prepare: !args.has('--skip-prepare'),
    host: process.env.SOAK_MATRIX_HOST || '127.0.0.1',
    port: Number(process.env.SOAK_MATRIX_PORT || process.env.PORT || 3209),
    durationSeconds,
    intervalMs: Number(process.env.SOAK_MATRIX_INTERVAL_MS || 1500),
    maxHeapGrowthMb: Number(process.env.SOAK_MATRIX_MAX_HEAP_GROWTH_MB || 96),
    maxRssGrowthMb: Number(process.env.SOAK_MATRIX_MAX_RSS_GROWTH_MB || 160),
    maxFailureRate: Number(process.env.SOAK_MATRIX_MAX_FAILURE_RATE || 0),
    maxBacklogGrowth: Number(process.env.SOAK_MATRIX_MAX_BACKLOG_GROWTH || 5),
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
    STRIPE_SECRET_KEY: 'sk_test_soak_matrix_fake_key',
    STRIPE_WEBHOOK_SECRET: 'stripe_webhook_secret_soak_matrix_fake_secret',
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
  summary: SoakSummary,
  name: string,
  commandName: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  const command = commandFor(commandName, args, env);
  const started = Date.now();
  const step: StepResult = { name, status: 'failed', command: command.display };
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
  const expected = resolve(process.cwd(), 'test-results', 'soak-matrix');
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
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise())),
    new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 5000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function waitForServer(appUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(`${appUrl}/api/plans`, { cache: 'no-store' });
      if (response.status < 500) return;
      lastError = new Error(`Ready probe returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }

  throw lastError instanceof Error ? lastError : new Error(`Timed out waiting for ${appUrl}`);
}

function getSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const direct = headers.getSetCookie?.();
  if (direct?.length) return direct;

  const combined = response.headers.get('set-cookie');
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,]+=)/).map((cookie) => cookie.trim());
}

function toCookieHeader(setCookies: string[]): string {
  return setCookies
    .map((cookie) => cookie.split(';')[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

async function signInAsAdmin(appUrl: string): Promise<string> {
  const response = await fetch(`${appUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: appUrl,
      referer: `${appUrl}/en/login`,
      'x-requested-with': 'soak-matrix-test',
    },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      callbackURL: `${appUrl}/en`,
    }),
    redirect: 'manual',
  });

  if (!response.ok) {
    throw new Error(`Admin sign-in failed with ${response.status}: ${await response.text()}`);
  }

  const cookie = toCookieHeader(getSetCookies(response));
  if (!cookie) {
    throw new Error('Admin sign-in did not return a session cookie');
  }
  return cookie;
}

async function probe(name: string, url: string, init?: RequestInit): Promise<ProbeResult> {
  const started = performance.now();
  try {
    const response = await fetch(url, init);
    const body = await response.text();
    return {
      name,
      status: response.status,
      ok: response.status < 500,
      durationMs: Math.round(performance.now() - started),
      bytes: Buffer.byteLength(body),
    };
  } catch (error) {
    return {
      name,
      status: 0,
      ok: false,
      durationMs: Math.round(performance.now() - started),
      bytes: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readQueueSnapshot(databaseUrl: string): Promise<QueueSnapshot> {
  const sqlClient = postgres(databaseUrl, { max: 1 });
  try {
    const [row] = await sqlClient<QueueSnapshot[]>`
      select
        count(*) filter (where table_name = 'event_outbox' and status in ('pending', 'processing'))::int as "outboxPending",
        count(*) filter (where table_name = 'event_outbox' and status = 'failed')::int as "outboxFailed",
        count(*) filter (where table_name = 'webhook_logs' and status in ('received', 'processing', 'failed', 'dead_letter'))::int as "webhookRetryable",
        count(*) filter (where table_name = 'plugin_job_runs' and status = 'dead_letter')::int as "jobDeadLetter"
      from (
        select 'event_outbox' as table_name, status from event_outbox
        union all
        select 'webhook_logs' as table_name, status from webhook_logs
        union all
        select 'plugin_job_runs' as table_name, status from plugin_job_runs
      ) q
    `;
    return {
      outboxPending: Number(row?.outboxPending ?? 0),
      outboxFailed: Number(row?.outboxFailed ?? 0),
      webhookRetryable: Number(row?.webhookRetryable ?? 0),
      jobDeadLetter: Number(row?.jobDeadLetter ?? 0),
    };
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

function subtractQueueSnapshot(after: QueueSnapshot, before: QueueSnapshot): QueueSnapshot {
  return {
    outboxPending: after.outboxPending - before.outboxPending,
    outboxFailed: after.outboxFailed - before.outboxFailed,
    webhookRetryable: after.webhookRetryable - before.webhookRetryable,
    jobDeadLetter: after.jobDeadLetter - before.jobDeadLetter,
  };
}

function queueGrowthMax(growth: QueueSnapshot): number {
  return Math.max(
    growth.outboxPending,
    growth.outboxFailed,
    growth.webhookRetryable,
    growth.jobDeadLetter
  );
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index] ?? 0;
}

function bytesToMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 100) / 100;
}

function createAggregate(iterations: IterationResult[]): NonNullable<SoakSummary['aggregate']> {
  const probes = iterations.flatMap((iteration) => iteration.probes);
  const failedRequests = probes.filter((probeResult) => !probeResult.ok).length;
  const requestDurations = probes.map((probeResult) => probeResult.durationMs);
  const firstMemory = iterations[0]?.memory ?? process.memoryUsage();
  const lastMemory = iterations[iterations.length - 1]?.memory ?? firstMemory;
  const firstQueue = iterations[0]?.queues ?? {
    outboxPending: 0,
    outboxFailed: 0,
    webhookRetryable: 0,
    jobDeadLetter: 0,
  };
  const lastQueue = iterations[iterations.length - 1]?.queues ?? firstQueue;

  return {
    iterations: iterations.length,
    requests: probes.length,
    failedRequests,
    failureRate: probes.length > 0 ? failedRequests / probes.length : 0,
    p95Ms: percentile(requestDurations, 0.95),
    maxMs: Math.max(0, ...requestDurations),
    heapGrowthMb: bytesToMb(lastMemory.heapUsed - firstMemory.heapUsed),
    rssGrowthMb: bytesToMb(lastMemory.rss - firstMemory.rss),
    backlogGrowth: subtractQueueSnapshot(lastQueue, firstQueue),
  };
}

function evaluate(summary: SoakSummary): void {
  const aggregate = summary.aggregate;
  if (!aggregate) {
    summary.issues.push('No soak iterations were collected');
    return;
  }

  if (aggregate.failureRate > summary.options.maxFailureRate) {
    summary.issues.push(
      `Failure rate ${aggregate.failureRate} exceeds ${summary.options.maxFailureRate}`
    );
  }
  if (aggregate.heapGrowthMb > summary.options.maxHeapGrowthMb) {
    summary.issues.push(
      `Heap growth ${aggregate.heapGrowthMb}MB exceeds ${summary.options.maxHeapGrowthMb}MB`
    );
  }
  if (aggregate.rssGrowthMb > summary.options.maxRssGrowthMb) {
    summary.issues.push(
      `RSS growth ${aggregate.rssGrowthMb}MB exceeds ${summary.options.maxRssGrowthMb}MB`
    );
  }
  if (queueGrowthMax(aggregate.backlogGrowth) > summary.options.maxBacklogGrowth) {
    summary.issues.push(
      `Queue backlog growth ${JSON.stringify(aggregate.backlogGrowth)} exceeds ${summary.options.maxBacklogGrowth}`
    );
  }
}

function writeSummary(summary: SoakSummary): void {
  summary.finishedAt = new Date().toISOString();
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function writeReport(summary: SoakSummary): void {
  const aggregate = summary.aggregate;
  const rows = summary.steps
    .map(
      (step) =>
        `| ${step.name} | ${step.status} | ${step.durationMs ?? '-'} | ${step.command ?? step.detail ?? '-'} |`
    )
    .join('\n');

  writeFileSync(
    REPORT_PATH,
    `# 长时间 Soak 矩阵测试报告

更新时间：${new Date().toISOString()}

## 结论

- 状态：${summary.status}
- 应用地址：${summary.appUrl}
- 数据库：${summary.databaseUrl}
- 持续时间：${summary.options.durationSeconds}s
- 迭代次数：${aggregate?.iterations ?? 0}
- 请求数：${aggregate?.requests ?? 0}
- 失败率：${aggregate ? (aggregate.failureRate * 100).toFixed(2) : '-'}%
- p95：${aggregate?.p95Ms ?? '-'}ms
- heap 增长：${aggregate?.heapGrowthMb ?? '-'}MB
- RSS 增长：${aggregate?.rssGrowthMb ?? '-'}MB

## 验收边界

本报告用于 P2-02 长时间 soak 验收。默认配置是本地短跑哨兵，验证 production standalone 在持续访问 public/API/admin/reliability 路径时没有 5xx、明显内存增长或队列积压扩大。Nightly 或上线前可通过环境变量把 \`SOAK_MATRIX_DURATION_SECONDS\` 拉长到数小时。

## 队列增长

- Outbox pending/processing：${aggregate?.backlogGrowth.outboxPending ?? '-'}
- Outbox failed：${aggregate?.backlogGrowth.outboxFailed ?? '-'}
- Webhook retryable：${aggregate?.backlogGrowth.webhookRetryable ?? '-'}
- Plugin job dead letter：${aggregate?.backlogGrowth.jobDeadLetter ?? '-'}

## 步骤

| 步骤 | 状态 | 耗时 ms | 命令/详情 |
| ---- | ---- | ------- | --------- |
${rows}

## 问题

${summary.issues.map((issue) => `- ${issue}`).join('\n') || '- 无'}

## 结果文件

- \`test-results/soak-matrix/summary.json\`
- \`test-results/soak-matrix/server.out.log\`
- \`test-results/soak-matrix/server.err.log\`
`,
    'utf8'
  );
}

async function runSetup(summary: SoakSummary, env: NodeJS.ProcessEnv): Promise<void> {
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function main(): Promise<void> {
  const options = parseOptions();
  const appUrl = `http://${options.host}:${options.port}`;
  const env = createEnv(appUrl);
  const databaseUrl = getDockerDatabaseUrl(env);
  const summary: SoakSummary = {
    status: 'failed',
    startedAt: new Date().toISOString(),
    appUrl,
    databaseUrl: maskDatabaseUrl(databaseUrl),
    options,
    steps: [],
    iterations: [],
    issues: [],
  };
  let server: ChildProcess | null = null;

  resetResultDir();

  try {
    await runSetup(summary, env);
    if (options.build) {
      await runCommandStep(summary, 'production build', 'npm', ['run', 'build'], env);
    }

    server = startServer(env);
    summary.steps.push({ name: 'standalone start', status: 'passed' });
    await waitForServer(appUrl, server);
    const adminCookie = await signInAsAdmin(appUrl);

    const deadline = Date.now() + options.durationSeconds * 1000;
    let index = 0;
    while (Date.now() < deadline) {
      const elapsedMs = Date.now() - Date.parse(summary.startedAt);
      const probes = await Promise.all([
        probe('public home', `${appUrl}/zh`),
        probe('sitemap', `${appUrl}/sitemap.xml`),
        probe('plans api', `${appUrl}/api/plans`),
        probe('admin reliability', `${appUrl}/api/admin/analytics/reliability?days=1`, {
          headers: { cookie: adminCookie },
        }),
        probe('system status', `${appUrl}/api/admin/dashboard/system-status?mode=quick`, {
          headers: { cookie: adminCookie },
        }),
      ]);
      const queues = await readQueueSnapshot(databaseUrl);
      summary.iterations.push({
        index,
        elapsedMs,
        probes,
        memory: process.memoryUsage(),
        queues,
      });
      console.log(
        `SOAK iteration=${index} probes=${probes.length} failed=${
          probes.filter((probeResult) => !probeResult.ok).length
        } heap=${bytesToMb(process.memoryUsage().heapUsed)}MB`
      );
      index += 1;
      await sleep(options.intervalMs);
    }

    summary.aggregate = createAggregate(summary.iterations);
    evaluate(summary);
    summary.status = summary.issues.length === 0 ? 'passed' : 'failed';
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
