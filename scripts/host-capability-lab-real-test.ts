/* eslint-disable no-console */

import { spawn, type ChildProcess } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { chromium, type Browser, type Page } from '@playwright/test';
import postgres from 'postgres';
import { getDockerDatabaseUrl, loadDockerDbEnv, maskDatabaseUrl } from './docker-db-env';

type StepStatus = 'passed' | 'failed' | 'skipped';

interface StepResult {
  name: string;
  status: StepStatus;
  durationMs?: number;
  command?: string;
  error?: string;
}

interface VisualCheck {
  name: string;
  url: string;
  screenshot: string;
  title?: string;
  status: StepStatus;
  evidence: Record<string, unknown>;
}

interface TestSummary {
  status: StepStatus;
  startedAt: string;
  finishedAt?: string;
  appUrl: string;
  databaseUrl: string;
  steps: StepResult[];
  visuals: VisualCheck[];
  error?: string;
}

const PLUGIN_ID = 'host-capability-lab';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin@123456';
const RESULT_DIR = resolve(process.cwd(), 'test-results', 'host-capability-lab');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const TEST_FILE_ROOT = resolve(process.cwd(), '.data', 'host-capability-lab-blobs');
const HOST = process.env.HOST_CAPABILITY_LAB_HOST || '127.0.0.1';
const PORT = Number(process.env.HOST_CAPABILITY_LAB_PORT || process.env.PORT || 3213);
const APP_URL = `http://${HOST}:${PORT}`;

function cleanSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => key.length > 0 && !key.includes('=') && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  ) as NodeJS.ProcessEnv;
}

function createTestEnv(): NodeJS.ProcessEnv {
  return cleanSpawnEnv({
    ...process.env,
    ...loadDockerDbEnv(),
    NODE_ENV: 'production',
    PORT: String(PORT),
    HOSTNAME: HOST,
    NEXT_PUBLIC_APP_URL: APP_URL,
    BETTER_AUTH_URL: APP_URL,
    BETTER_AUTH_SECRET: 'local-docker-dev-secret-change-me-32-chars',
    AUTH_PASSWORD_RESET_DELIVERY: 'log',
    PLUGIN_SECRET_ENCRYPTION_KEY: 'local-plugin-secret-change-me-32-chars',
    PLUGIN_FILE_SIGNING_SECRET: 'local-plugin-file-signing-secret-change-me-32-chars',
    BILLING_ENABLED: 'false',
    BILLING_DEMO_API_ENABLED: 'true',
    FILE_STORAGE_ENABLED: 'true',
    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_LOCAL_ROOT: TEST_FILE_ROOT,
    PLOYKIT_API_RATE_LIMIT_MULTIPLIER: process.env.PLOYKIT_API_RATE_LIMIT_MULTIPLIER || '20',
  });
}

function resetResults(): void {
  const expected = resolve(process.cwd(), 'test-results', 'host-capability-lab');
  if (RESULT_DIR !== expected) {
    throw new Error(`Refusing to clear unexpected result directory: ${RESULT_DIR}`);
  }

  rmSync(RESULT_DIR, { recursive: true, force: true });
  mkdirSync(RESULT_DIR, { recursive: true });
}

function commandFor(name: string, args: string[], env: NodeJS.ProcessEnv) {
  if (name === 'npm' && env.npm_execpath) {
    return {
      file: process.execPath,
      args: [env.npm_execpath, ...args],
      display: [name, ...args].join(' '),
    };
  }

  if (name === 'npx' && env.npm_execpath) {
    return {
      file: process.execPath,
      args: [env.npm_execpath, 'exec', '--', ...args],
      display: [name, ...args].join(' '),
    };
  }

  const commandName =
    process.platform === 'win32' && ['npm', 'npx'].includes(name) ? `${name}.cmd` : name;

  return {
    file: commandName,
    args,
    display: [name, ...args].join(' '),
  };
}

function stepLogPath(index: number, name: string, stream: 'out' | 'err'): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return resolve(RESULT_DIR, `${String(index).padStart(2, '0')}-${slug}.${stream}.log`);
}

async function runCommandStep(
  summary: TestSummary,
  name: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  const stepIndex = summary.steps.length + 1;
  const stdoutPath = stepLogPath(stepIndex, name, 'out');
  const stderrPath = stepLogPath(stepIndex, name, 'err');
  const stdout = createWriteStream(stdoutPath);
  const stderr = createWriteStream(stderrPath);
  const resolved = commandFor(command, args, env);
  const started = Date.now();
  const step: StepResult = {
    name,
    status: 'failed',
    command: resolved.display,
  };

  summary.steps.push(step);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(resolved.file, resolved.args, {
      cwd: process.cwd(),
      env: cleanSpawnEnv(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.pipe(stdout);
    child.stderr?.pipe(stderr);

    child.on('error', (error) => {
      step.durationMs = Date.now() - started;
      step.error = error.message;
      stdout.end();
      stderr.end();
      rejectPromise(error);
    });

    child.on('exit', (code) => {
      step.durationMs = Date.now() - started;
      stdout.end();
      stderr.end();

      if (code === 0) {
        step.status = 'passed';
        resolvePromise();
        return;
      }

      const error = new Error(`${resolved.display} exited with code ${code}`);
      step.error = error.message;
      rejectPromise(error);
    });
  });
}

function startServer(summary: TestSummary, env: NodeJS.ProcessEnv): ChildProcess {
  const standaloneServer = resolve(process.cwd(), '.next', 'standalone', 'server.js');
  if (!existsSync(standaloneServer)) {
    throw new Error('Standalone server was not found. Run npm run build before visual tests.');
  }

  const stepIndex = summary.steps.length + 1;
  const stdoutPath = stepLogPath(stepIndex, 'standalone-start', 'out');
  const stderrPath = stepLogPath(stepIndex, 'standalone-start', 'err');
  const stdout = createWriteStream(stdoutPath);
  const stderr = createWriteStream(stderrPath);
  const child = spawn(process.execPath, [standaloneServer], {
    cwd: process.cwd(),
    env: cleanSpawnEnv(env),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.pipe(stdout);
  child.stderr?.pipe(stderr);
  summary.steps.push({
    name: 'standalone start',
    status: 'passed',
    command: 'node .next/standalone/server.js',
  });

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

async function waitForServer(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Next server exited early with code ${child.exitCode}`);
    }

    try {
      const response = await fetch(`${APP_URL}/api/plans`, { cache: 'no-store' });
      if (response.status < 500) {
        return;
      }
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
  }

  throw new Error(
    `Timed out waiting for ${APP_URL}: ${
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

async function signInAsAdmin(): Promise<string> {
  const response = await fetch(`${APP_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: APP_URL,
      referer: `${APP_URL}/zh/login`,
      'x-requested-with': 'host-capability-lab-real-test',
    },
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      callbackURL: `${APP_URL}/zh`,
    }),
    redirect: 'manual',
  });

  if (!response.ok) {
    throw new Error(`Admin sign-in failed with ${response.status}: ${await response.text()}`);
  }

  const cookie = toCookieHeader(getSetCookies(response));
  if (!cookie) {
    throw new Error('Admin sign-in did not return a session cookie.');
  }

  return cookie;
}

async function preparePluginState(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });
  const now = new Date();

  try {
    await sql`
      insert into plugin_installations (plugin_id, version, enabled, installed_by, updated_at)
      values (${PLUGIN_ID}, '0.1.0', true, 'host-capability-lab-real-test', ${now})
      on conflict (plugin_id)
      do update set
        version = excluded.version,
        enabled = true,
        installed_by = excluded.installed_by,
        updated_at = excluded.updated_at
    `;

    await sql`
      update plugin_host_page_overrides
      set status = 'inactive', updated_at = ${now}
      where page_path = '/about'
        and status = 'active'
    `;

    await sql`
      insert into plugin_host_page_overrides (
        page_path,
        plugin_id,
        component_path,
        mode,
        status,
        priority,
        seo_hash,
        i18n_hash,
        activated_by,
        activated_at,
        updated_at
      )
      values (
        '/about',
        ${PLUGIN_ID},
        './pages/AboutOverride',
        'main.replace',
        'active',
        5,
        'host-capability-lab-real-test-seo',
        'host-capability-lab-real-test-i18n',
        'host-capability-lab-real-test',
        ${now},
        ${now}
      )
      on conflict (plugin_id, page_path)
      do update set
        component_path = excluded.component_path,
        mode = excluded.mode,
        status = excluded.status,
        priority = excluded.priority,
        seo_hash = excluded.seo_hash,
        i18n_hash = excluded.i18n_hash,
        activated_by = excluded.activated_by,
        activated_at = excluded.activated_at,
        updated_at = excluded.updated_at
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function assertText(page: Page, text: string): Promise<void> {
  await page.getByText(text, { exact: false }).waitFor({ state: 'visible', timeout: 15_000 });
}

async function assertMarker(page: Page, marker: string): Promise<void> {
  await page
    .locator(`[data-capability-marker="${marker}"]`)
    .waitFor({ state: 'visible', timeout: 15_000 });
}

interface VisualExpectations {
  texts?: readonly string[];
  markers?: readonly string[];
  evidence?: Record<string, unknown>;
}

async function addVisual(
  summary: TestSummary,
  page: Page,
  name: string,
  urlPath: string,
  expectations: VisualExpectations
): Promise<void> {
  const url = `${APP_URL}${urlPath}`;
  await page.goto(url, { waitUntil: 'load', timeout: 45_000 });

  for (const assertion of expectations.texts ?? []) {
    await assertText(page, assertion);
  }
  for (const marker of expectations.markers ?? []) {
    await assertMarker(page, marker);
  }

  const screenshotPath = resolve(RESULT_DIR, `${name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  summary.visuals.push({
    name,
    url,
    screenshot: screenshotPath,
    title: await page.title(),
    status: 'passed',
    evidence: expectations.evidence ?? {},
  });
}

async function runVisualChecks(summary: TestSummary, adminCookie: string): Promise<void> {
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      baseURL: APP_URL,
      viewport: { width: 1440, height: 1100 },
    });
    const page = await context.newPage();

    await addVisual(summary, page, '01-home-host-slots', '/zh', {
      texts: ['首页 Hero 前插件插槽', '首页 Hero 后插件插槽'],
      markers: ['HOST_CAPABILITY_LAB_HOME_HERO_BEFORE', 'HOST_CAPABILITY_LAB_HOME_HERO_AFTER'],
    });

    await addVisual(summary, page, '02-pricing-host-slots', '/zh/pricing', {
      texts: ['定价页插件提示', '定价页插件补充'],
      markers: [
        'HOST_CAPABILITY_LAB_PRICING_MAIN_BEFORE',
        'HOST_CAPABILITY_LAB_PRICING_MAIN_AFTER',
      ],
    });

    await addVisual(summary, page, '03-about-host-override', '/zh/about', {
      texts: ['关于页已由插件替换', '运行时证据'],
      markers: ['HOST_CAPABILITY_LAB_OVERRIDE_RENDERED'],
    });

    await addVisual(
      summary,
      page,
      '04-about-host-override-en-seo',
      '/en/about',
      {
        texts: ['About page replaced by a plugin'],
        markers: ['HOST_CAPABILITY_LAB_OVERRIDE_RENDERED'],
        evidence: { expectedTitleFragment: 'Capability Lab About Override' },
      }
    );

    const title = await page.title();
    if (!title.includes('Capability Lab About Override')) {
      throw new Error(`Expected English override SEO title, got "${title}".`);
    }

    await context.addCookies(
      adminCookie
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const separatorIndex = part.indexOf('=');
          return {
            name: part.slice(0, separatorIndex),
            value: part.slice(separatorIndex + 1),
            domain: HOST,
            path: '/',
            httpOnly: true,
            sameSite: 'Lax' as const,
            secure: false,
          };
        })
    );

    await addVisual(summary, page, '05-plugin-storage-page', '/zh/plugins/host-capability-lab', {
      texts: ['真实插件能力探针', 'ctx.storage 真实探针', '事务正常', 'database-filtered-jsonb'],
    });
  } finally {
    await browser?.close();
  }
}

function writeSummary(summary: TestSummary): void {
  summary.finishedAt = new Date().toISOString();
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

async function main(): Promise<void> {
  resetResults();
  const env = createTestEnv();
  const databaseUrl = getDockerDatabaseUrl(env);
  const summary: TestSummary = {
    status: 'failed',
    startedAt: new Date().toISOString(),
    appUrl: APP_URL,
    databaseUrl: maskDatabaseUrl(databaseUrl),
    steps: [],
    visuals: [],
  };

  let server: ChildProcess | null = null;

  try {
    console.log(`Using Docker database: ${maskDatabaseUrl(databaseUrl)}`);
    console.log(`Using app URL: ${APP_URL}`);

    await runCommandStep(summary, 'docker db up', 'docker', ['compose', 'up', '-d', 'db'], env);
    await runCommandStep(summary, 'docker db wait', 'npm', ['run', 'db:docker:wait'], env);
    await runCommandStep(summary, 'migration structure verify', 'npm', ['run', 'db:verify'], env);
    await runCommandStep(summary, 'database migrate', 'npm', ['run', 'db:migrate'], env);
    await runCommandStep(summary, 'seed tool site', 'npm', ['run', 'seed:tool-site'], env);
    await runCommandStep(summary, 'runtime reconcile', 'npm', ['run', 'runtime:check'], env);
    await runCommandStep(summary, 'plugin contract check', 'npm', ['run', 'plugins:check'], env);

    await preparePluginState(databaseUrl);
    summary.steps.push({ name: 'host capability lab plugin enabled and override activated', status: 'passed' });

    await runCommandStep(summary, 'production build', 'npm', ['run', 'build'], env);

    server = startServer(summary, env);
    await waitForServer(server);
    const adminCookie = await signInAsAdmin();
    await runVisualChecks(summary, adminCookie);

    summary.status = 'passed';
  } catch (error) {
    summary.error = serializeError(error);
    throw error;
  } finally {
    await stopServer(server);
    writeSummary(summary);
    console.log(`Wrote host capability lab summary to ${SUMMARY_PATH}`);
  }
}

main().catch((error) => {
  console.error(serializeError(error));
  process.exitCode = 1;
});
