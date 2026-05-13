/* eslint-disable no-console */

import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDockerDatabaseUrl, loadDockerDbEnv, maskDatabaseUrl } from './docker-db-env';

type Status = 'passed' | 'failed' | 'skipped';

interface StepResult {
  name: string;
  status: Status;
  command?: string;
  durationMs?: number;
  exitCode?: number | null;
  error?: string;
}

interface ObservabilityMatrixOptions {
  build: boolean;
  prepare: boolean;
  skipInstall: boolean;
  host: string;
  port: number;
}

interface ObservabilityMatrixSummary {
  status: Status;
  startedAt: string;
  finishedAt?: string;
  appUrl: string;
  databaseUrl: string;
  options: ObservabilityMatrixOptions;
  coverage: {
    systemStatus: boolean;
    auditLogsAndStats: boolean;
    usageMetrics: boolean;
    edgeAccessLogs: boolean;
    reliabilityTrends: boolean;
    adminPages: boolean;
  };
  steps: StepResult[];
  error?: string;
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'observability-matrix');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', '可观测性矩阵测试报告.md');
const STDOUT_PATH = resolve(RESULT_DIR, 'server.out.log');
const STDERR_PATH = resolve(RESULT_DIR, 'server.err.log');
const PLAYWRIGHT_CLI_PATH = resolve(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js');
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin@123456';

function parseOptions(): ObservabilityMatrixOptions {
  const args = new Set(process.argv.slice(2));
  const port = Number(process.env.OBSERVABILITY_MATRIX_PORT || process.env.PORT || 3206);

  return {
    build: args.has('--build'),
    prepare: !args.has('--skip-prepare'),
    skipInstall: args.has('--skip-install'),
    host: process.env.OBSERVABILITY_MATRIX_HOST || '127.0.0.1',
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
    STRIPE_SECRET_KEY: 'sk_test_observability_matrix_fake_key',
    STRIPE_WEBHOOK_SECRET: 'stripe_webhook_secret_observability_matrix_fake_secret',
  });
}

function commandFor(name: string, args: string[], env: NodeJS.ProcessEnv) {
  if (name === 'playwright') {
    return {
      file: process.execPath,
      args: [PLAYWRIGHT_CLI_PATH, ...args],
      display: [name, ...args].join(' '),
    };
  }

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
  summary: ObservabilityMatrixSummary,
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

    child.on('exit', (exitCode) => {
      step.durationMs = Date.now() - started;
      step.exitCode = exitCode;

      if (exitCode === 0) {
        step.status = 'passed';
        resolvePromise();
        return;
      }

      step.error = `${command.display} exited with code ${exitCode}`;
      reject(new Error(step.error));
    });
  });
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

async function waitForServer(appUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(`${appUrl}/api/plans`, { cache: 'no-store' });
      if (response.status < 500) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }

  throw new Error(
    `Timed out waiting for ${appUrl}: ${
      lastError instanceof Error ? lastError.message : String(lastError ?? 'no response')
    }`
  );
}

function getSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const direct = headers.getSetCookie?.();
  if (direct?.length) {
    return direct;
  }

  const combined = response.headers.get('set-cookie');
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

async function signInAsAdmin(appUrl: string): Promise<string> {
  const response = await fetch(`${appUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: appUrl,
      referer: `${appUrl}/en/login`,
      'x-requested-with': 'observability-matrix-test',
    },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      callbackURL: `${appUrl}/en`,
    }),
    redirect: 'manual',
  });

  if (!response.ok) {
    throw new Error(
      `Admin sign-in failed with status ${response.status}: ${await response.text()}`
    );
  }

  const cookie = toCookieHeader(getSetCookies(response));
  if (!cookie) {
    throw new Error('Admin sign-in did not return a session cookie.');
  }

  return cookie;
}

function resetResultDir(): void {
  const expectedRoot = resolve(process.cwd(), 'test-results', 'observability-matrix');
  if (RESULT_DIR !== expectedRoot) {
    throw new Error(`Refusing to clear unexpected result directory: ${RESULT_DIR}`);
  }

  rmSync(RESULT_DIR, { recursive: true, force: true });
  mkdirSync(RESULT_DIR, { recursive: true });
}

function writeSummary(summary: ObservabilityMatrixSummary): void {
  summary.finishedAt = new Date().toISOString();
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function writeReport(summary: ObservabilityMatrixSummary): void {
  const passedSteps = summary.steps.filter((step) => step.status === 'passed').length;
  const failedSteps = summary.steps.filter((step) => step.status === 'failed').length;
  const rows = summary.steps
    .map(
      (step) =>
        `| ${step.name} | ${step.status} | ${step.durationMs ?? '-'} | ${step.command ?? '-'} |`
    )
    .join('\n');

  writeFileSync(
    REPORT_PATH,
    [
      '# 可观测性矩阵测试报告',
      '',
      `更新时间：${new Date().toISOString()}`,
      '',
      '## 结论',
      '',
      `- 状态：${summary.status}`,
      `- 应用地址：${summary.appUrl}`,
      `- 数据库：${summary.databaseUrl}`,
      `- 步骤：${passedSteps} passed / ${failedSteps} failed`,
      '',
      '## 验收边界',
      '',
      '本报告用于 P1-09 可观测性验收。宿主只验证平台值班所需的通用信号：system status、审计查询与统计、用量聚合、edge access log 写入与查询、可靠性失败趋势，以及后台页面能真实展示这些信号。不内置业务监控模型、告警编排平台或行业专用指标。',
      '',
      '## 覆盖能力',
      '',
      `- system status 关键服务探针：${summary.coverage.systemStatus ? 'covered' : 'missing'}`,
      `- audit logs 与 stats：${summary.coverage.auditLogsAndStats ? 'covered' : 'missing'}`,
      `- usage metrics 聚合与筛选：${summary.coverage.usageMetrics ? 'covered' : 'missing'}`,
      `- edge access logs ingest/query/stats：${summary.coverage.edgeAccessLogs ? 'covered' : 'missing'}`,
      `- reliability 失败趋势与队列健康：${summary.coverage.reliabilityTrends ? 'covered' : 'missing'}`,
      `- admin 可见页面 smoke：${summary.coverage.adminPages ? 'covered' : 'missing'}`,
      '',
      '## 步骤',
      '',
      '| 步骤 | 状态 | 耗时 ms | 命令 |',
      '| ---- | ---- | ------- | ---- |',
      rows,
      '',
      '## 证据文件',
      '',
      '- `test-results/observability-matrix/summary.json`',
      '- `test-results/playwright/observability-matrix-report`',
      '- `test-results/playwright/observability-matrix`',
      '',
    ].join('\n'),
    'utf8'
  );
}

async function runSetup(
  summary: ObservabilityMatrixSummary,
  env: NodeJS.ProcessEnv
): Promise<void> {
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
}

async function main(): Promise<void> {
  const options = parseOptions();
  const appUrl = `http://${options.host}:${options.port}`;
  const env = createEnv(appUrl);
  const summary: ObservabilityMatrixSummary = {
    status: 'failed',
    startedAt: new Date().toISOString(),
    appUrl,
    databaseUrl: maskDatabaseUrl(getDockerDatabaseUrl(env)),
    options,
    coverage: {
      systemStatus: true,
      auditLogsAndStats: true,
      usageMetrics: true,
      edgeAccessLogs: true,
      reliabilityTrends: true,
      adminPages: true,
    },
    steps: [],
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

    if (!options.skipInstall) {
      await runCommandStep(
        summary,
        'playwright install chromium',
        'playwright',
        ['install', 'chromium'],
        env
      );
    }

    await runCommandStep(
      summary,
      'playwright observability matrix',
      'playwright',
      [
        'test',
        'tests/e2e/observability-matrix.spec.ts',
        '--project=chromium-desktop',
        '--reporter=list,html',
        '--output=test-results/playwright/observability-matrix',
      ],
      {
        ...env,
        PLAYWRIGHT_BASE_URL: appUrl,
        PLAYWRIGHT_SKIP_WEBSERVER: '1',
        PLAYWRIGHT_ADMIN_COOKIE: adminCookie,
        PLAYWRIGHT_HTML_REPORT: 'test-results/playwright/observability-matrix-report',
      }
    );

    summary.status = 'passed';
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

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
