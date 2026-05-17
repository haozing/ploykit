/* eslint-disable no-console */

import { spawn, type ChildProcess } from 'child_process';
import { createHash, createHmac } from 'crypto';
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import postgres from 'postgres';
import { getDockerDatabaseUrl, loadDockerDbEnv, maskDatabaseUrl } from './docker-db-env';

type StepStatus = 'passed' | 'failed' | 'skipped';

interface StepResult {
  name: string;
  status: StepStatus;
  command?: string;
  durationMs?: number;
  exitCode?: number | null;
  log?: {
    stdout: string;
    stderr: string;
  };
  error?: string;
}

interface SmokeResult {
  name: string;
  status: StepStatus;
  details?: Record<string, unknown>;
  error?: string;
}

interface RealTestOptions {
  resetDb: boolean;
  prepareOnly: boolean;
  keepServer: boolean;
  skipBuild: boolean;
  playwright: boolean;
  headed: boolean;
  host: string;
  port: number;
}

interface TestSummary {
  status: StepStatus;
  startedAt: string;
  finishedAt?: string;
  appUrl: string;
  databaseUrl: string;
  options: Omit<RealTestOptions, 'host' | 'port'> & { host: string; port: number };
  steps: StepResult[];
  smoke: SmokeResult[];
  error?: string;
}

interface PluginListItem {
  id: string;
  installed: boolean;
  enabled?: boolean;
}

interface SignedInUser {
  email: string;
  cookie: string;
}

interface NoteRecord {
  id?: string;
}

interface UploadedFileRecord {
  id?: string;
  path?: string;
  originalName?: string;
  mimeType?: string;
  size?: number;
  userId?: string;
  uploadedByEmail?: string;
}

interface NotificationSmokeRecord {
  id?: string;
  type?: string;
  subject?: string | null;
  readAt?: string | null;
}

interface UsageResponse {
  success?: boolean;
  usage?: {
    storage?: number;
  };
}

interface UserSubscriptionResponse {
  plan?: {
    id?: string;
    name?: string;
    slug?: string;
    limits?: Record<string, unknown>;
    pricing?: Record<string, unknown>;
  };
  status?: string;
  isActive?: boolean;
  usage?: Record<string, unknown>;
}

interface UserOrderSmokeRecord {
  id?: string;
  orderType?: string;
  providerOrderId?: string;
  amount?: string | null;
  currency?: string | null;
  status?: string;
  plan?: { id?: string; name?: string; slug?: string } | null;
}

interface UserOrdersResponse {
  orders?: UserOrderSmokeRecord[];
  count?: number;
  pagination?: { limit?: number; offset?: number; hasMore?: boolean };
}

interface UserCreditLogSmokeRecord {
  id?: string;
  logType?: string;
  changeAmount?: number;
  reason?: string | null;
  relatedOrder?: { id?: string; orderType?: string } | null;
}

interface UserCreditHistoryResponse {
  logs?: UserCreditLogSmokeRecord[];
  count?: number;
  pagination?: { limit?: number; offset?: number; hasMore?: boolean };
}

interface CapabilityDemoSelfTestCheck {
  id: string;
  capability: string;
  status: StepStatus;
  durationMs?: number;
  reason?: string;
  error?: {
    code?: string;
    message?: string;
    statusCode?: number;
  };
  evidence?: Record<string, unknown>;
}

interface CapabilityDemoSelfTestResponse {
  ok?: boolean;
  seed?: string;
  generatedAt?: string;
  statusCounts?: Record<StepStatus, number>;
  workspaceScope?: { type?: string; id?: string };
  runId?: string;
  apiKey?: {
    id?: string;
    key?: string;
    keyPreview?: string;
    scope?: { type?: string; id?: string };
    permissions?: string[];
  } | null;
  checks?: CapabilityDemoSelfTestCheck[];
}

interface AdminPlanRecord {
  id: string;
  name: string;
  slug: string;
  features?: Record<string, unknown>;
  limits?: {
    monthly?: Record<string, number>;
    yearly?: Record<string, number>;
  };
  pricing?: {
    currency?: string;
    monthly?: number;
    yearly?: number;
  };
  isActive?: boolean;
  isDefault?: boolean;
  subscriberCount?: number;
}

interface AdminPlansResponse {
  success?: boolean;
  data?: AdminPlanRecord[];
}

interface AdminPlanResponse {
  success?: boolean;
  data?: AdminPlanRecord;
}

interface AdminUsageResponse {
  success?: boolean;
  data?: {
    rangeDays?: number;
    startAt?: string;
    endAt?: string;
    filters?: {
      metric?: string | null;
      userId?: string | null;
      limit?: number;
    };
    totalEvents?: number;
    topMetrics?: Array<{ key?: string; total?: number }>;
    topUsers?: Array<{ userId?: string; total?: number }>;
    recentEvents?: Array<{ userId?: string; key?: string; value?: number }>;
  };
}

interface AdminDashboardStatsResponse {
  success?: boolean;
  data?: {
    users?: { total?: number; growth?: string; growthValue?: number };
    subscriptions?: { total?: number; active?: number; description?: string };
    roles?: { total?: number; active?: number; description?: string };
    plugins?: { total?: number; enabled?: number; description?: string };
    apiRequests?: { total?: string; growth?: string; trend?: string };
    meta?: { rangeDays?: number; usageSource?: string };
  };
}

interface AdminRolesResponse {
  success?: boolean;
  roles?: Array<{ id?: string; slug?: string; name?: string; userCount?: number }>;
}

interface AdminSettingsResponse {
  success?: boolean;
  data?: {
    general?: {
      siteName?: string;
      supportEmail?: string;
      defaultLocale?: string;
      timezone?: string;
    };
    security?: {
      requireEmailVerification?: boolean;
      sessionMaxAgeDays?: number;
      passwordMinLength?: number;
    };
    email?: {
      provider?: string;
      fromEmail?: string;
      fromName?: string;
      passwordResetDelivery?: string;
    };
    notifications?: {
      inAppEnabled?: boolean;
      emailEnabled?: boolean;
      webhookEnabled?: boolean;
      digestFrequency?: string;
    };
  };
}

interface OutboxReplaySmokeState {
  entryId: string;
}

interface WebhookRetryDetailSmokeState {
  receiptId: string;
}

interface WebhookSmokeState {
  signedStripeEventId: string;
}

interface PasswordResetSmokeState {
  userId: string;
  email: string;
  oldCookie: string;
}

interface PasswordlessUserSmokeState {
  userId: string;
  email: string;
  cookie: string;
  password: string;
}

interface EntitlementAdminSmokeState {
  userId: string;
  entitlementId: string;
  targetPlanId: string;
  finalStatus: string;
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'codex-real');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const TEST_FILE_ROOT = resolve(process.cwd(), '.data', 'test-blobs');
const SAMPLE_PLUGIN_ID = 'sample-internal';
const SAMPLE_PLUGIN_PROJECT_ID = 'codex-real-project';
const CAPABILITY_DEMO_PLUGIN_ID = 'capability-demo';
const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin@123456';
const REGULAR_USER_PASSWORD = 'User@123456';
const STRIPE_WEBHOOK_SECRET = 'stripe_webhook_secret_codex_real_fake_secret';

function resetResultDir(): void {
  const expectedRoot = resolve(process.cwd(), 'test-results', 'codex-real');

  if (RESULT_DIR !== expectedRoot) {
    throw new Error(`Refusing to clear unexpected result directory: ${RESULT_DIR}`);
  }

  rmSync(RESULT_DIR, { recursive: true, force: true });
  mkdirSync(RESULT_DIR, { recursive: true });
}

function samplePluginNotesUrl(appUrl: string): string {
  return `${appUrl}/api/plugins/${SAMPLE_PLUGIN_ID}/notes/${SAMPLE_PLUGIN_PROJECT_ID}`;
}

async function ensureSampleInternalServiceBinding(
  appUrl: string,
  cookie: string
): Promise<Response> {
  return fetch(`${appUrl}/api/admin/plugin-internal-services`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, cookie),
    body: JSON.stringify({
      action: 'upsert',
      pluginId: SAMPLE_PLUGIN_ID,
      serviceName: 'core-api',
      scopeType: 'global',
      scopeId: null,
      environment: process.env.NODE_ENV || 'production',
      baseUrl: appUrl,
      authType: 'none',
      actorClaimsEnabled: false,
      actorClaimsType: 'hmac',
      actorClaimsAudience: null,
      actorClaimsSecretRef: null,
      actorClaimsTtlSeconds: 60,
      timeoutMs: 30000,
      retryAttempts: 0,
      retryBackoffMs: 250,
      maxResponseBytes: 10485760,
      healthPath: '/api/plans',
      healthMethod: 'GET',
      healthExpectedStatus: 200,
      status: 'active',
      metadata: {
        source: 'codex-real-test',
      },
    }),
  });
}

function parseOptions(): RealTestOptions {
  const args = new Set(process.argv.slice(2));
  const port = Number(process.env.CODEX_REAL_TEST_PORT || process.env.PORT || 3100);

  return {
    resetDb: args.has('--reset-db'),
    prepareOnly: args.has('--prepare-only'),
    keepServer: args.has('--keep-server'),
    skipBuild: args.has('--skip-build'),
    playwright: args.has('--playwright'),
    headed: args.has('--headed'),
    host: process.env.CODEX_REAL_TEST_HOST || '127.0.0.1',
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

function createTestEnv(appUrl: string): NodeJS.ProcessEnv {
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
    FILE_STORAGE_LOCAL_ROOT: TEST_FILE_ROOT,
    STRIPE_SECRET_KEY: 'sk_test_codex_real_fake_key',
    STRIPE_WEBHOOK_SECRET,
    PLOYKIT_API_RATE_LIMIT_MULTIPLIER: process.env.PLOYKIT_API_RATE_LIMIT_MULTIPLIER || '20',
  });
}

function assertLocalDatabaseUrl(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error(`Refusing to run real tests against non-Postgres URL: ${parsed.protocol}`);
  }

  if (!allowedHosts.has(parsed.hostname)) {
    throw new Error(
      `Refusing to run real tests against non-local database host: ${parsed.hostname}`
    );
  }
}

function commandFor(
  name: string,
  args: string[],
  env: NodeJS.ProcessEnv
): { file: string; args: string[]; display: string } {
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
  const resolved = commandFor(command, args, env);
  const started = Date.now();
  const stdout = createWriteStream(stdoutPath);
  const stderr = createWriteStream(stderrPath);

  const step: StepResult = {
    name,
    status: 'failed',
    command: resolved.display,
    log: {
      stdout: stdoutPath,
      stderr: stderrPath,
    },
  };

  summary.steps.push(step);

  await new Promise<void>((resolvePromise, reject) => {
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
      reject(error);
    });

    child.on('exit', (code) => {
      step.durationMs = Date.now() - started;
      step.exitCode = code;
      stdout.end();
      stderr.end();

      if (code === 0) {
        step.status = 'passed';
        resolvePromise();
        return;
      }

      const error = new Error(`${resolved.display} exited with code ${code}`);
      step.error = error.message;
      reject(error);
    });
  });
}

function startServer(summary: TestSummary, appUrl: string, env: NodeJS.ProcessEnv): ChildProcess {
  const stepIndex = summary.steps.length + 1;
  const stdoutPath = stepLogPath(stepIndex, 'standalone-start', 'out');
  const stderrPath = stepLogPath(stepIndex, 'standalone-start', 'err');
  const stdout = createWriteStream(stdoutPath);
  const stderr = createWriteStream(stderrPath);
  const standaloneServer = resolve(process.cwd(), '.next', 'standalone', 'server.js');

  if (!existsSync(standaloneServer)) {
    throw new Error('Standalone server was not found. Run npm run build before starting tests.');
  }

  const args = [standaloneServer];
  const child = spawn(process.execPath, args, {
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
    log: {
      stdout: stdoutPath,
      stderr: stderrPath,
    },
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

function recordSmoke(
  summary: TestSummary,
  name: string,
  passed: boolean,
  details?: Record<string, unknown>
): void {
  summary.smoke.push({
    name,
    status: passed ? 'passed' : 'failed',
    details,
    error: passed ? undefined : `${name} failed`,
  });

  if (!passed) {
    throw new Error(`${name} failed`);
  }
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

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

async function readJsonSafely<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function jsonHeaders(appUrl: string, cookie?: string, clientIp?: string): HeadersInit {
  return {
    'content-type': 'application/json',
    origin: appUrl,
    referer: `${appUrl}/zh/admin/plugins`,
    'x-requested-with': 'codex-real-test',
    ...(clientIp ? { 'x-forwarded-for': clientIp } : {}),
    ...(cookie ? { cookie } : {}),
  };
}

function formHeaders(appUrl: string, cookie: string): HeadersInit {
  return {
    origin: appUrl,
    referer: `${appUrl}/zh/files`,
    'x-requested-with': 'codex-real-test',
    cookie,
  };
}

function authHeaders(cookie: string): HeadersInit {
  return { cookie };
}

function randomTestEmail(prefix: string): string {
  return `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2)}@example.com`;
}

function createStripeSignature(payload: string, secret = STRIPE_WEBHOOK_SECRET): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = createHmac('sha256', secret).update(signedPayload).digest('hex');

  return `t=${timestamp},v1=${signature}`;
}

function hashPluginApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

async function signInAsAdmin(appUrl: string): Promise<string> {
  const response = await fetch(`${appUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: jsonHeaders(appUrl),
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      callbackURL: `${appUrl}/zh`,
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
    throw new Error('Admin sign-in did not return a session cookie');
  }

  return cookie;
}

async function registerUser(
  appUrl: string,
  email = randomTestEmail('codex-real'),
  clientIp?: string
): Promise<void> {
  const response = await fetch(`${appUrl}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, undefined, clientIp),
    body: JSON.stringify({
      name: 'Codex Real User',
      email,
      password: REGULAR_USER_PASSWORD,
      callbackURL: `${appUrl}/zh`,
    }),
    redirect: 'manual',
  });

  if (!response.ok) {
    throw new Error(`User sign-up failed with status ${response.status}: ${await response.text()}`);
  }
}

async function signInUser(appUrl: string, email: string, clientIp?: string): Promise<string> {
  const response = await fetch(`${appUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, undefined, clientIp),
    body: JSON.stringify({
      email,
      password: REGULAR_USER_PASSWORD,
      callbackURL: `${appUrl}/zh`,
    }),
    redirect: 'manual',
  });

  if (!response.ok) {
    throw new Error(`User sign-in failed with status ${response.status}: ${await response.text()}`);
  }

  const cookie = toCookieHeader(getSetCookies(response));
  if (!cookie) {
    throw new Error('User sign-in did not return a session cookie');
  }

  return cookie;
}

async function createRegularUser(appUrl: string, clientIp?: string): Promise<SignedInUser> {
  const email = randomTestEmail('codex-user');
  await registerUser(appUrl, email, clientIp);
  const cookie = await signInUser(appUrl, email, clientIp);
  return { email, cookie };
}

async function runPasswordResetSmoke(
  summary: TestSummary,
  appUrl: string,
  databaseUrl: string
): Promise<PasswordResetSmokeState> {
  const email = randomTestEmail('codex-reset');
  await registerUser(appUrl, email);
  const oldCookie = await signInUser(appUrl, email);
  const userId = await fetchSessionUserId(appUrl, oldCookie);

  const requestResponse = await fetch(`${appUrl}/api/auth/forget-password`, {
    method: 'POST',
    headers: jsonHeaders(appUrl),
    body: JSON.stringify({
      email,
      redirectTo: '/zh/reset-password',
    }),
  });
  const requestBody = await readJson<{ status?: boolean }>(requestResponse);
  recordSmoke(
    summary,
    'password reset request creates reset workflow',
    requestResponse.ok && requestBody.status === true,
    { status: requestResponse.status, responseStatus: requestBody.status }
  );

  const sql = postgres(databaseUrl, { max: 1 });
  let token = '';
  try {
    const resetTokens = await sql<{ identifier: string; value: string }[]>`
      select identifier
           , value
      from verification
      where value = ${userId}
        and identifier like 'reset-password:%'
      order by "createdAt" desc
      limit 1
    `;
    token = resetTokens[0]?.identifier.replace('reset-password:', '') ?? '';
    recordSmoke(summary, 'password reset token persisted for user', Boolean(token), {
      userId,
      rows: resetTokens.length,
      tokenLength: token.length,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }

  const callbackResponse = token
    ? await fetch(
        `${appUrl}/api/auth/reset-password/${token}?callbackURL=${encodeURIComponent('/zh/reset-password')}`,
        {
          headers: { referer: `${appUrl}/zh/forgot-password` },
          redirect: 'manual',
        }
      )
    : null;
  const callbackLocation = callbackResponse?.headers.get('location') ?? '';
  const callbackUrl = callbackLocation.startsWith('http')
    ? new URL(callbackLocation)
    : callbackLocation
      ? new URL(callbackLocation, appUrl)
      : null;
  recordSmoke(
    summary,
    'password reset callback redirects to localized reset page',
    callbackResponse?.status === 302 &&
      callbackUrl?.pathname === '/zh/reset-password' &&
      callbackUrl.searchParams.get('token') === token,
    {
      status: callbackResponse?.status,
      location: callbackLocation,
      pathname: callbackUrl?.pathname,
      hasToken: callbackUrl?.searchParams.has('token') ?? false,
    }
  );

  const newPassword = 'Reset@123456';
  const resetResponse = await fetch(`${appUrl}/api/auth/reset-password`, {
    method: 'POST',
    headers: jsonHeaders(appUrl),
    body: JSON.stringify({
      newPassword,
      token,
    }),
  });
  const resetBody = await readJson<{ status?: boolean }>(resetResponse);
  recordSmoke(summary, 'password reset accepts token and updates password', resetResponse.ok, {
    status: resetResponse.status,
    responseStatus: resetBody.status,
  });

  const oldPasswordResponse = await fetch(`${appUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, undefined, '127.0.0.101'),
    body: JSON.stringify({
      email,
      password: REGULAR_USER_PASSWORD,
      callbackURL: `${appUrl}/zh`,
    }),
    redirect: 'manual',
  });
  recordSmoke(
    summary,
    'password reset rejects old password',
    oldPasswordResponse.status === 401 || oldPasswordResponse.status === 403,
    { status: oldPasswordResponse.status }
  );

  const newPasswordResponse = await fetch(`${appUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, undefined, '127.0.0.102'),
    body: JSON.stringify({
      email,
      password: newPassword,
      callbackURL: `${appUrl}/zh`,
    }),
    redirect: 'manual',
  });
  recordSmoke(summary, 'password reset allows new password sign-in', newPasswordResponse.ok, {
    status: newPasswordResponse.status,
    hasCookie: getSetCookies(newPasswordResponse).length > 0,
  });

  const oldSessionResponse = await fetch(`${appUrl}/api/user/profile`, {
    headers: authHeaders(oldCookie),
    cache: 'no-store',
  });
  recordSmoke(summary, 'password reset revokes old sessions', oldSessionResponse.status === 401, {
    status: oldSessionResponse.status,
  });

  return { userId, email, oldCookie };
}

async function fetchPluginList(appUrl: string, cookie: string): Promise<PluginListItem[]> {
  const response = await fetch(`${appUrl}/api/admin/plugins`, {
    headers: cookie ? { cookie } : undefined,
    cache: 'no-store',
  });
  const body = await readJson<{ plugins?: PluginListItem[] }>(response);

  if (!response.ok) {
    throw new Error(`Admin plugin list failed with status ${response.status}`);
  }

  return body.plugins ?? [];
}

async function postAdminPluginAction(
  appUrl: string,
  cookie: string,
  pluginId: string,
  action: string
): Promise<void> {
  const response = await fetch(`${appUrl}/api/admin/plugins/${pluginId}/${action}`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, cookie),
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    throw new Error(
      `Admin plugin ${pluginId} ${action} failed with status ${response.status}: ${await response.text()}`
    );
  }
}

async function postAdminAction(appUrl: string, cookie: string, action: string): Promise<void> {
  await postAdminPluginAction(appUrl, cookie, SAMPLE_PLUGIN_ID, action);
}

async function deleteAdminPlugin(appUrl: string, cookie: string): Promise<void> {
  const response = await fetch(`${appUrl}/api/admin/plugins/${SAMPLE_PLUGIN_ID}/uninstall`, {
    method: 'DELETE',
    headers: jsonHeaders(appUrl, cookie),
  });

  if (!response.ok) {
    throw new Error(
      `Admin plugin uninstall failed with status ${response.status}: ${await response.text()}`
    );
  }
}

async function getSamplePluginState(appUrl: string, cookie: string): Promise<PluginListItem> {
  const plugins = await fetchPluginList(appUrl, cookie);
  const sample = plugins.find((plugin) => plugin.id === SAMPLE_PLUGIN_ID);
  if (!sample) {
    throw new Error(`Plugin ${SAMPLE_PLUGIN_ID} was not present in /api/admin/plugins`);
  }

  return sample;
}

async function getPluginState(
  appUrl: string,
  cookie: string,
  pluginId: string
): Promise<PluginListItem> {
  const plugins = await fetchPluginList(appUrl, cookie);
  const plugin = plugins.find((candidate) => candidate.id === pluginId);
  if (!plugin) {
    throw new Error(`Plugin ${pluginId} was not present in /api/admin/plugins`);
  }

  return plugin;
}

async function ensureSamplePluginEnabled(appUrl: string, cookie: string): Promise<PluginListItem> {
  let plugins = await fetchPluginList(appUrl, cookie);
  let sample = plugins.find((plugin) => plugin.id === SAMPLE_PLUGIN_ID);

  if (!sample) {
    throw new Error(`Plugin ${SAMPLE_PLUGIN_ID} was not present in /api/admin/plugins`);
  }

  if (!sample.installed) {
    await postAdminAction(appUrl, cookie, 'install');
    plugins = await fetchPluginList(appUrl, cookie);
    sample = plugins.find((plugin) => plugin.id === SAMPLE_PLUGIN_ID);
  }

  if (!sample?.enabled) {
    const bindingResponse = await ensureSampleInternalServiceBinding(appUrl, cookie);
    if (!bindingResponse.ok) {
      throw new Error(
        `Sample internal service binding failed with status ${bindingResponse.status}: ${await bindingResponse.text()}`
      );
    }
    await postAdminAction(appUrl, cookie, 'enable');
    plugins = await fetchPluginList(appUrl, cookie);
    sample = plugins.find((plugin) => plugin.id === SAMPLE_PLUGIN_ID);
  }

  if (!sample?.installed || !sample.enabled) {
    throw new Error(`Plugin ${SAMPLE_PLUGIN_ID} could not be installed and enabled`);
  }

  return sample;
}

async function ensurePluginEnabled(
  appUrl: string,
  cookie: string,
  pluginId: string
): Promise<PluginListItem> {
  let plugin = await getPluginState(appUrl, cookie, pluginId);

  if (!plugin.installed) {
    await postAdminPluginAction(appUrl, cookie, pluginId, 'install');
    plugin = await getPluginState(appUrl, cookie, pluginId);
  }

  if (!plugin.enabled) {
    await postAdminPluginAction(appUrl, cookie, pluginId, 'enable');
    plugin = await getPluginState(appUrl, cookie, pluginId);
  }

  if (!plugin.installed || !plugin.enabled) {
    throw new Error(`Plugin ${pluginId} could not be installed and enabled`);
  }

  return plugin;
}

async function createPluginNote(
  appUrl: string,
  cookie: string,
  input: {
    title: string;
    status?: 'open' | 'done';
    body?: string;
  }
): Promise<{ response: Response; note: NoteRecord | undefined }> {
  const response = await fetch(samplePluginNotesUrl(appUrl), {
    method: 'POST',
    headers: jsonHeaders(appUrl, cookie),
    body: JSON.stringify({
      status: 'open',
      ...input,
    }),
  });
  const created = await readJson<{ note?: NoteRecord }>(response);

  return {
    response,
    note: created.note,
  };
}

async function listPluginNotes(
  appUrl: string,
  cookie: string
): Promise<{
  response: Response;
  notes: NoteRecord[];
}> {
  const response = await fetch(samplePluginNotesUrl(appUrl), {
    headers: authHeaders(cookie),
    cache: 'no-store',
  });
  const body = await readJson<{ notes?: NoteRecord[] }>(response);

  return {
    response,
    notes: body.notes ?? [],
  };
}

async function fetchSessionUserId(appUrl: string, cookie: string): Promise<string> {
  const response = await fetch(`${appUrl}/api/user/profile`, {
    headers: authHeaders(cookie),
    cache: 'no-store',
  });
  const body = await readJson<{ profile?: { id?: string } }>(response);

  if (!response.ok || !body.profile?.id) {
    throw new Error(`Unable to resolve session user id with status ${response.status}`);
  }

  return body.profile.id;
}

async function runProfileSmoke(
  summary: TestSummary,
  appUrl: string,
  regular: SignedInUser
): Promise<void> {
  const unicodeName = '李小明 Test';
  const updateNameResponse = await fetch(`${appUrl}/api/user/profile`, {
    method: 'PUT',
    headers: jsonHeaders(appUrl, regular.cookie),
    body: JSON.stringify({ name: unicodeName }),
  });
  const updateNameBody = await readJson<{ success?: boolean; user?: { name?: string } }>(
    updateNameResponse
  );
  recordSmoke(
    summary,
    'user profile accepts unicode display name',
    updateNameResponse.ok && updateNameBody.user?.name === unicodeName,
    {
      status: updateNameResponse.status,
      name: updateNameBody.user?.name,
    }
  );

  const avatarForm = new FormData();
  const avatarBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  );
  avatarForm.set('file', new File([avatarBytes], 'avatar.png', { type: 'image/png' }));

  const avatarResponse = await fetch(`${appUrl}/api/user/profile/avatar`, {
    method: 'POST',
    headers: formHeaders(appUrl, regular.cookie),
    body: avatarForm,
  });
  const avatarBody = await readJson<{
    success?: boolean;
    image?: string;
    file?: { id?: string; folder?: string | null };
  }>(avatarResponse);
  recordSmoke(
    summary,
    'user profile avatar upload stores file and updates short image URL',
    avatarResponse.status === 201 &&
      avatarBody.success === true &&
      typeof avatarBody.image === 'string' &&
      avatarBody.image.startsWith('/api/files/') &&
      avatarBody.image.includes('download=true') &&
      avatarBody.file?.folder === 'avatars',
    {
      status: avatarResponse.status,
      image: avatarBody.image,
      fileId: avatarBody.file?.id,
      folder: avatarBody.file?.folder,
    }
  );

  const profileResponse = await fetch(`${appUrl}/api/user/profile`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const profileBody = await readJson<{
    profile?: { name?: string | null; image?: string | null };
  }>(profileResponse);
  recordSmoke(
    summary,
    'user profile returns updated unicode name and avatar URL',
    profileResponse.ok &&
      profileBody.profile?.name === unicodeName &&
      profileBody.profile?.image === avatarBody.image,
    {
      status: profileResponse.status,
      name: profileBody.profile?.name,
      image: profileBody.profile?.image,
    }
  );
}

async function runPasswordCapabilitySmoke(
  summary: TestSummary,
  appUrl: string,
  databaseUrl: string,
  regular: SignedInUser
): Promise<PasswordlessUserSmokeState> {
  const regularCapabilityResponse = await fetch(`${appUrl}/api/user/profile/password`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const regularCapabilityBody = await readJson<{
    success?: boolean;
    hasPassword?: boolean;
    mode?: string;
  }>(regularCapabilityResponse);
  recordSmoke(
    summary,
    'password capability reports credential users can change password',
    regularCapabilityResponse.ok &&
      regularCapabilityBody.success === true &&
      regularCapabilityBody.hasPassword === true &&
      regularCapabilityBody.mode === 'change',
    {
      status: regularCapabilityResponse.status,
      hasPassword: regularCapabilityBody.hasPassword,
      mode: regularCapabilityBody.mode,
    }
  );

  const email = randomTestEmail('codex-passwordless');
  await registerUser(appUrl, email);
  const cookie = await signInUser(appUrl, email, '127.0.0.104');
  const userId = await fetchSessionUserId(appUrl, cookie);
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`
      delete from account
      where "userId" = ${userId}
        and "providerId" = 'credential'
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }

  const passwordlessCapabilityResponse = await fetch(`${appUrl}/api/user/profile/password`, {
    headers: authHeaders(cookie),
    cache: 'no-store',
  });
  const passwordlessCapabilityBody = await readJson<{
    success?: boolean;
    hasPassword?: boolean;
    mode?: string;
  }>(passwordlessCapabilityResponse);
  recordSmoke(
    summary,
    'password capability reports passwordless users should set password',
    passwordlessCapabilityResponse.ok &&
      passwordlessCapabilityBody.success === true &&
      passwordlessCapabilityBody.hasPassword === false &&
      passwordlessCapabilityBody.mode === 'set',
    {
      status: passwordlessCapabilityResponse.status,
      hasPassword: passwordlessCapabilityBody.hasPassword,
      mode: passwordlessCapabilityBody.mode,
      userId,
    }
  );

  const password = 'SetPassword1';
  const setPasswordResponse = await fetch(`${appUrl}/api/user/profile/password`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, cookie),
    body: JSON.stringify({
      newPassword: password,
      confirmPassword: password,
    }),
  });
  const setPasswordBody = await readJson<{ success?: boolean; mode?: string }>(setPasswordResponse);
  recordSmoke(
    summary,
    'passwordless user can set an initial credential password',
    setPasswordResponse.ok && setPasswordBody.success === true && setPasswordBody.mode === 'set',
    {
      status: setPasswordResponse.status,
      mode: setPasswordBody.mode,
      userId,
    }
  );

  const signInResponse = await fetch(`${appUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, undefined, '127.0.0.103'),
    body: JSON.stringify({
      email,
      password,
      callbackURL: `${appUrl}/zh`,
    }),
    redirect: 'manual',
  });
  recordSmoke(
    summary,
    'initial credential password allows email sign-in',
    signInResponse.ok && getSetCookies(signInResponse).length > 0,
    {
      status: signInResponse.status,
      userId,
    }
  );

  return { userId, email, cookie, password };
}

async function runUserBillingSmoke(
  summary: TestSummary,
  appUrl: string,
  regular: SignedInUser & { userId: string }
): Promise<void> {
  const guestSubscriptionResponse = await fetch(`${appUrl}/api/user/subscription`, {
    cache: 'no-store',
  });
  recordSmoke(
    summary,
    'user subscription API rejects guests',
    guestSubscriptionResponse.status === 401,
    { status: guestSubscriptionResponse.status }
  );

  const subscriptionResponse = await fetch(`${appUrl}/api/user/subscription`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const subscriptionBody = await readJson<UserSubscriptionResponse>(subscriptionResponse);
  recordSmoke(
    summary,
    'user subscription API returns current active plan',
    subscriptionResponse.ok &&
      subscriptionBody.isActive === true &&
      ['active', 'trial', 'trialing', 'past_due'].includes(subscriptionBody.status ?? '') &&
      Boolean(subscriptionBody.plan?.id) &&
      subscriptionBody.plan?.slug === 'free',
    {
      status: subscriptionResponse.status,
      userId: regular.userId,
      planSlug: subscriptionBody.plan?.slug,
      subscriptionStatus: subscriptionBody.status,
      isActive: subscriptionBody.isActive,
    }
  );

  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });
  const smokeProviderOrderId = `codex_order_${Date.now()}`;
  const smokeOrderId = crypto.randomUUID();
  const smokeCreditLogId = crypto.randomUUID();
  try {
    await sql`
      insert into orders (
        id,
        user_id,
        order_type,
        provider,
        provider_order_id,
        amount,
        currency,
        status,
        plan_id,
        metadata,
        created_at,
        updated_at
      )
      values (
        ${smokeOrderId},
        ${regular.userId},
        'one_time_purchase',
        'codex',
        ${smokeProviderOrderId},
        '12.34',
        'USD',
        'succeeded',
        ${subscriptionBody.plan?.id ?? null},
        ${sql.json({ source: 'codex-real-test' })},
        now(),
        now()
      )
    `;
    await sql`
      insert into credit_logs (
        id,
        user_id,
        log_type,
        change_amount,
        balance_after,
        reason,
        related_order_id,
        metadata,
        created_at
      )
      values (
        ${smokeCreditLogId},
        ${regular.userId},
        'grant',
        1234,
        ${sql.json({ apiCallsRemaining: 1234 })},
        'Codex smoke credit grant',
        ${smokeOrderId},
        ${sql.json({ source: 'codex-real-test' })},
        now()
      )
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }

  const ordersResponse = await fetch(`${appUrl}/api/user/orders?limit=10`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const ordersBody = await readJson<UserOrdersResponse>(ordersResponse);
  recordSmoke(
    summary,
    'user orders API returns isolated order history shape',
    ordersResponse.ok &&
      Array.isArray(ordersBody.orders) &&
      ordersBody.count === ordersBody.orders.length,
    {
      status: ordersResponse.status,
      userId: regular.userId,
      count: ordersBody.count,
    }
  );

  const smokeOrder = ordersBody.orders?.find((order) => order.id === smokeOrderId);
  recordSmoke(
    summary,
    'user orders API returns real seeded order data',
    Boolean(
      smokeOrder &&
      smokeOrder.orderType === 'one_time_purchase' &&
      smokeOrder.providerOrderId === smokeProviderOrderId &&
      smokeOrder.amount === '12.34'
    ),
    {
      status: ordersResponse.status,
      orderId: smokeOrderId,
      providerOrderId: smokeOrder?.providerOrderId,
      amount: smokeOrder?.amount,
    }
  );

  const pagedOrdersResponse = await fetch(`${appUrl}/api/user/orders?limit=1&offset=0`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const pagedOrdersBody = await readJson<UserOrdersResponse>(pagedOrdersResponse);
  recordSmoke(
    summary,
    'user orders API returns pagination metadata',
    pagedOrdersResponse.ok &&
      pagedOrdersBody.count === 1 &&
      pagedOrdersBody.pagination?.limit === 1 &&
      pagedOrdersBody.pagination.offset === 0 &&
      typeof pagedOrdersBody.pagination.hasMore === 'boolean',
    {
      status: pagedOrdersResponse.status,
      count: pagedOrdersBody.count,
      pagination: pagedOrdersBody.pagination,
    }
  );

  const invalidOrdersLimitResponse = await fetch(`${appUrl}/api/user/orders?limit=101`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  recordSmoke(
    summary,
    'user orders API rejects invalid limit',
    invalidOrdersLimitResponse.status === 400,
    { status: invalidOrdersLimitResponse.status }
  );

  const invalidOrdersOffsetResponse = await fetch(`${appUrl}/api/user/orders?offset=-1`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  recordSmoke(
    summary,
    'user orders API rejects invalid offset',
    invalidOrdersOffsetResponse.status === 400,
    { status: invalidOrdersOffsetResponse.status }
  );

  const ordersCsvResponse = await fetch(`${appUrl}/api/user/orders?limit=10&format=csv`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const ordersCsv = await ordersCsvResponse.text();
  recordSmoke(
    summary,
    'user orders CSV export returns owned order rows',
    ordersCsvResponse.ok &&
      ordersCsvResponse.headers.get('content-type')?.includes('text/csv') === true &&
      ordersCsv.includes('providerOrderId') === false &&
      ordersCsv.includes(smokeOrderId) &&
      ordersCsv.includes('one_time_purchase'),
    {
      status: ordersCsvResponse.status,
      contentType: ordersCsvResponse.headers.get('content-type'),
      orderId: smokeOrderId,
    }
  );

  const creditHistoryResponse = await fetch(`${appUrl}/api/user/credit-history?limit=10`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const creditHistoryBody = await readJson<UserCreditHistoryResponse>(creditHistoryResponse);
  recordSmoke(
    summary,
    'user credit history API returns isolated history shape',
    creditHistoryResponse.ok &&
      Array.isArray(creditHistoryBody.logs) &&
      creditHistoryBody.count === creditHistoryBody.logs.length,
    {
      status: creditHistoryResponse.status,
      userId: regular.userId,
      count: creditHistoryBody.count,
    }
  );

  const smokeCreditLog = creditHistoryBody.logs?.find((log) => log.id === smokeCreditLogId);
  recordSmoke(
    summary,
    'user credit history API returns real seeded credit log',
    Boolean(
      smokeCreditLog &&
      smokeCreditLog.logType === 'grant' &&
      smokeCreditLog.changeAmount === 1234 &&
      smokeCreditLog.relatedOrder?.id === smokeOrderId
    ),
    {
      status: creditHistoryResponse.status,
      creditLogId: smokeCreditLogId,
      relatedOrderId: smokeCreditLog?.relatedOrder?.id,
      changeAmount: smokeCreditLog?.changeAmount,
    }
  );

  const pagedCreditHistoryResponse = await fetch(
    `${appUrl}/api/user/credit-history?limit=1&offset=0`,
    {
      headers: authHeaders(regular.cookie),
      cache: 'no-store',
    }
  );
  const pagedCreditHistoryBody = await readJson<UserCreditHistoryResponse>(
    pagedCreditHistoryResponse
  );
  recordSmoke(
    summary,
    'user credit history API returns pagination metadata',
    pagedCreditHistoryResponse.ok &&
      pagedCreditHistoryBody.count === 1 &&
      pagedCreditHistoryBody.pagination?.limit === 1 &&
      pagedCreditHistoryBody.pagination.offset === 0 &&
      typeof pagedCreditHistoryBody.pagination.hasMore === 'boolean',
    {
      status: pagedCreditHistoryResponse.status,
      count: pagedCreditHistoryBody.count,
      pagination: pagedCreditHistoryBody.pagination,
    }
  );

  const invalidCreditOffsetResponse = await fetch(`${appUrl}/api/user/credit-history?offset=-1`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  recordSmoke(
    summary,
    'user credit history API rejects invalid offset',
    invalidCreditOffsetResponse.status === 400,
    { status: invalidCreditOffsetResponse.status }
  );

  const creditHistoryCsvResponse = await fetch(
    `${appUrl}/api/user/credit-history?limit=10&format=csv`,
    {
      headers: authHeaders(regular.cookie),
      cache: 'no-store',
    }
  );
  const creditHistoryCsv = await creditHistoryCsvResponse.text();
  recordSmoke(
    summary,
    'user credit history CSV export returns owned credit rows',
    creditHistoryCsvResponse.ok &&
      creditHistoryCsvResponse.headers.get('content-type')?.includes('text/csv') === true &&
      creditHistoryCsv.includes(smokeCreditLogId) &&
      creditHistoryCsv.includes('Codex smoke credit grant'),
    {
      status: creditHistoryCsvResponse.status,
      contentType: creditHistoryCsvResponse.headers.get('content-type'),
      creditLogId: smokeCreditLogId,
    }
  );

  const billingPageResponse = await fetch(`${appUrl}/zh/billing`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  recordSmoke(
    summary,
    'user billing page is reachable for authenticated users',
    billingPageResponse.ok,
    { status: billingPageResponse.status }
  );

  const guestPortalResponse = await fetch(`${appUrl}/api/billing/portal`, {
    method: 'POST',
    headers: jsonHeaders(appUrl),
    body: JSON.stringify({ returnUrl: `${appUrl}/zh/billing` }),
  });
  recordSmoke(summary, 'billing portal API rejects guests', guestPortalResponse.status === 401, {
    status: guestPortalResponse.status,
  });

  const freePortalResponse = await fetch(`${appUrl}/api/billing/portal`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, regular.cookie),
    body: JSON.stringify({ returnUrl: `${appUrl}/zh/billing` }),
  });
  const freePortalBody = await readJsonSafely<Record<string, unknown>>(freePortalResponse);
  recordSmoke(
    summary,
    'billing portal API reports missing Stripe customer for free user',
    freePortalResponse.status === 404,
    {
      status: freePortalResponse.status,
      code:
        typeof freePortalBody?.error === 'object' && freePortalBody.error !== null
          ? (freePortalBody.error as Record<string, unknown>).code
          : undefined,
    }
  );
}

async function runAdminPlanManagementSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser
): Promise<void> {
  const slug = `codex-plan-${Date.now()}`;
  const createResponse = await fetch(`${appUrl}/api/admin/entitlements/plans`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, admin.cookie),
    body: JSON.stringify({
      name: 'Codex Smoke Plan',
      slug,
      features: {
        'codex.smokeFeature': true,
      },
      limits: {
        monthly: { 'codex.calls': 25 },
        yearly: { 'codex.calls': 300 },
      },
      pricing: {
        currency: 'USD',
        monthly: 12,
        yearly: 120,
      },
      sortOrder: 90,
      isActive: true,
      isDefault: false,
      isPopular: false,
    }),
  });
  const createBody = await readJson<AdminPlanResponse>(createResponse);
  const planId = createBody.data?.id;
  recordSmoke(
    summary,
    'admin plan management creates a temporary plan',
    createResponse.status === 201 && createBody.success === true && Boolean(planId),
    {
      status: createResponse.status,
      planId,
      slug: createBody.data?.slug,
    }
  );

  const detailResponse = await fetch(`${appUrl}/api/admin/entitlements/plans/${planId}`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const detailBody = await readJson<AdminPlanResponse>(detailResponse);
  recordSmoke(
    summary,
    'admin plan management reads plan detail',
    detailResponse.ok &&
      detailBody.data?.id === planId &&
      detailBody.data?.slug === slug &&
      detailBody.data?.subscriberCount === 0,
    {
      status: detailResponse.status,
      planId,
      subscriberCount: detailBody.data?.subscriberCount,
    }
  );

  const updateResponse = await fetch(`${appUrl}/api/admin/entitlements/plans/${planId}`, {
    method: 'PUT',
    headers: jsonHeaders(appUrl, admin.cookie),
    body: JSON.stringify({
      name: 'Codex Smoke Plan Updated',
      pricing: {
        currency: 'USD',
        monthly: 15,
        yearly: 150,
      },
      limits: {
        monthly: { 'codex.calls': 30 },
        yearly: { 'codex.calls': 360 },
      },
      isPopular: true,
    }),
  });
  const updateBody = await readJson<AdminPlanResponse>(updateResponse);
  recordSmoke(
    summary,
    'admin plan management updates pricing and limits',
    updateResponse.ok &&
      updateBody.data?.name === 'Codex Smoke Plan Updated' &&
      updateBody.data?.pricing?.monthly === 15 &&
      updateBody.data?.limits?.monthly?.['codex.calls'] === 30,
    {
      status: updateResponse.status,
      planId,
      monthly: updateBody.data?.pricing?.monthly,
      calls: updateBody.data?.limits?.monthly?.['codex.calls'],
    }
  );

  const listResponse = await fetch(`${appUrl}/api/admin/entitlements/plans`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const listBody = await readJson<AdminPlansResponse>(listResponse);
  recordSmoke(
    summary,
    'admin plan management list includes temporary plan',
    listResponse.ok &&
      Array.isArray(listBody.data) &&
      listBody.data.some((plan) => plan.id === planId && plan.subscriberCount === 0),
    {
      status: listResponse.status,
      planId,
      count: listBody.data?.length,
    }
  );

  const defaultPlan = listBody.data?.find((plan) => plan.isDefault === true);
  const deleteDefaultResponse = defaultPlan
    ? await fetch(`${appUrl}/api/admin/entitlements/plans/${defaultPlan.id}`, {
        method: 'DELETE',
        headers: jsonHeaders(appUrl, admin.cookie),
      })
    : null;
  recordSmoke(
    summary,
    'admin plan management rejects deleting default plan',
    Boolean(defaultPlan) && deleteDefaultResponse?.status === 403,
    {
      status: deleteDefaultResponse?.status,
      defaultPlanId: defaultPlan?.id,
      defaultSlug: defaultPlan?.slug,
    }
  );

  const deleteResponse = await fetch(`${appUrl}/api/admin/entitlements/plans/${planId}`, {
    method: 'DELETE',
    headers: jsonHeaders(appUrl, admin.cookie),
  });
  const deleteBody = await readJson<{ success?: boolean }>(deleteResponse);
  recordSmoke(
    summary,
    'admin plan management deletes unused temporary plan',
    deleteResponse.ok && deleteBody.success === true,
    {
      status: deleteResponse.status,
      planId,
    }
  );

  const deletedDetailResponse = await fetch(`${appUrl}/api/admin/entitlements/plans/${planId}`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  recordSmoke(
    summary,
    'admin plan management detail returns 404 after delete',
    deletedDetailResponse.status === 404,
    {
      status: deletedDetailResponse.status,
      planId,
    }
  );
}

async function runAdminAnalyticsSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser
): Promise<void> {
  const now = new Date();
  const startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const previousStartDate = new Date(startDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    startDate: startDate.toISOString(),
    endDate: now.toISOString(),
    previousStartDate: previousStartDate.toISOString(),
    previousEndDate: startDate.toISOString(),
  });

  const dashboardResponse = await fetch(
    `${appUrl}/api/admin/analytics/dashboard?${params.toString()}`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const dashboardBody = await readJsonSafely<{
    success?: boolean;
    analytics?: Record<string, unknown>;
  }>(dashboardResponse);
  recordSmoke(
    summary,
    'admin analytics dashboard API returns composite metrics',
    dashboardResponse.ok &&
      dashboardBody?.success === true &&
      Boolean(dashboardBody.analytics?.revenue) &&
      Boolean(dashboardBody.analytics?.growth) &&
      Boolean(dashboardBody.analytics?.churn),
    { status: dashboardResponse.status }
  );

  const revenueResponse = await fetch(
    `${appUrl}/api/admin/analytics/revenue?${params.toString()}`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const revenueBody = await readJsonSafely<{
    success?: boolean;
    metrics?: Record<string, unknown>;
  }>(revenueResponse);
  recordSmoke(
    summary,
    'admin analytics revenue API returns financial metrics',
    revenueResponse.ok &&
      revenueBody?.success === true &&
      typeof revenueBody.metrics?.mrr === 'number' &&
      typeof revenueBody.metrics?.arr === 'number',
    {
      status: revenueResponse.status,
      mrr: revenueBody?.metrics?.mrr,
      arr: revenueBody?.metrics?.arr,
    }
  );

  const revenuePageResponse = await fetch(`${appUrl}/en/admin/revenue`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const revenuePageHtml = await revenuePageResponse.text();
  recordSmoke(
    summary,
    'admin revenue page renders analytics revenue surface',
    revenuePageResponse.ok && revenuePageHtml.includes('Revenue By Plan'),
    {
      status: revenuePageResponse.status,
      hasRevenueByPlan: revenuePageHtml.includes('Revenue By Plan'),
    }
  );

  const growthResponse = await fetch(`${appUrl}/api/admin/analytics/growth?${params.toString()}`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const growthBody = await readJsonSafely<{ success?: boolean; metrics?: Record<string, unknown> }>(
    growthResponse
  );
  recordSmoke(
    summary,
    'admin analytics growth API returns growth metrics',
    growthResponse.ok &&
      growthBody?.success === true &&
      typeof growthBody.metrics?.newUsers === 'number' &&
      typeof growthBody.metrics?.growthRate === 'number',
    {
      status: growthResponse.status,
      newUsers: growthBody?.metrics?.newUsers,
      growthRate: growthBody?.metrics?.growthRate,
    }
  );

  const churnResponse = await fetch(`${appUrl}/api/admin/analytics/churn?${params.toString()}`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const churnBody = await readJsonSafely<{ success?: boolean; metrics?: Record<string, unknown> }>(
    churnResponse
  );
  recordSmoke(
    summary,
    'admin analytics churn API returns churn metrics',
    churnResponse.ok &&
      churnBody?.success === true &&
      typeof churnBody.metrics?.churnRate === 'number' &&
      typeof churnBody.metrics?.retentionRate === 'number',
    {
      status: churnResponse.status,
      churnRate: churnBody?.metrics?.churnRate,
      retentionRate: churnBody?.metrics?.retentionRate,
    }
  );

  const cohortsResponse = await fetch(`${appUrl}/api/admin/analytics/cohorts?months=3`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const cohortsBody = await readJsonSafely<{ success?: boolean; cohorts?: unknown[] }>(
    cohortsResponse
  );
  recordSmoke(
    summary,
    'admin analytics cohorts API returns cohort array',
    cohortsResponse.ok && cohortsBody?.success === true && Array.isArray(cohortsBody.cohorts),
    {
      status: cohortsResponse.status,
      count: cohortsBody?.cohorts?.length,
    }
  );

  const usagePatternsParams = new URLSearchParams(params);
  usagePatternsParams.set('metric', 'platform.storageBytes');
  const usagePatternsResponse = await fetch(
    `${appUrl}/api/admin/analytics/usage-patterns?${usagePatternsParams.toString()}`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const usagePatternsBody = await readJsonSafely<{
    success?: boolean;
    patterns?: Record<string, unknown>;
  }>(usagePatternsResponse);
  recordSmoke(
    summary,
    'admin analytics usage patterns API returns scoped metric analysis',
    usagePatternsResponse.ok &&
      usagePatternsBody?.success === true &&
      Boolean(usagePatternsBody.patterns),
    { status: usagePatternsResponse.status }
  );

  const growthTrendsResponse = await fetch(`${appUrl}/api/admin/analytics/growth-trends?days=7`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const growthTrendsBody = await readJsonSafely<{
    success?: boolean;
    data?: { dateLabels?: unknown[]; newUsers?: { data?: unknown[] } };
  }>(growthTrendsResponse);
  recordSmoke(
    summary,
    'admin analytics growth trends API returns daily series',
    growthTrendsResponse.ok &&
      growthTrendsBody?.success === true &&
      Array.isArray(growthTrendsBody.data?.dateLabels) &&
      Array.isArray(growthTrendsBody.data?.newUsers?.data),
    {
      status: growthTrendsResponse.status,
      points: growthTrendsBody?.data?.dateLabels?.length,
    }
  );

  const usageTrendsResponse = await fetch(
    `${appUrl}/api/admin/analytics/usage-trends?days=7&metric=all`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const usageTrendsBody = await readJsonSafely<{
    success?: boolean;
    data?: { dateLabels?: unknown[]; users?: { data?: unknown[] } };
  }>(usageTrendsResponse);
  recordSmoke(
    summary,
    'admin analytics usage trends API returns cumulative series',
    usageTrendsResponse.ok &&
      usageTrendsBody?.success === true &&
      Array.isArray(usageTrendsBody.data?.dateLabels) &&
      Array.isArray(usageTrendsBody.data?.users?.data),
    {
      status: usageTrendsResponse.status,
      points: usageTrendsBody?.data?.dateLabels?.length,
    }
  );

  const reliabilityResponse = await fetch(`${appUrl}/api/admin/analytics/reliability?days=30`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const reliabilityBody = await readJsonSafely<{
    success?: boolean;
    rangeDays?: number;
    reliability?: {
      outbox?: { total?: unknown; failureRate?: unknown };
      webhooks?: { total?: unknown; retryAttempts?: unknown; failureRate?: unknown };
      jobs?: { total?: unknown; failureRate?: unknown };
      overall?: { totalWorkItems?: unknown; failedWorkItems?: unknown; backlog?: unknown };
    };
  }>(reliabilityResponse);
  recordSmoke(
    summary,
    'admin analytics reliability API returns queue health metrics',
    reliabilityResponse.ok &&
      reliabilityBody?.success === true &&
      reliabilityBody.rangeDays === 30 &&
      typeof reliabilityBody.reliability?.outbox?.total === 'number' &&
      typeof reliabilityBody.reliability?.outbox?.failureRate === 'number' &&
      typeof reliabilityBody.reliability?.webhooks?.total === 'number' &&
      typeof reliabilityBody.reliability?.webhooks?.retryAttempts === 'number' &&
      typeof reliabilityBody.reliability?.webhooks?.failureRate === 'number' &&
      typeof reliabilityBody.reliability?.jobs?.total === 'number' &&
      typeof reliabilityBody.reliability?.jobs?.failureRate === 'number' &&
      typeof reliabilityBody.reliability?.overall?.totalWorkItems === 'number' &&
      typeof reliabilityBody.reliability?.overall?.failedWorkItems === 'number' &&
      typeof reliabilityBody.reliability?.overall?.backlog === 'number',
    {
      status: reliabilityResponse.status,
      outboxTotal: reliabilityBody?.reliability?.outbox?.total,
      webhookTotal: reliabilityBody?.reliability?.webhooks?.total,
      jobTotal: reliabilityBody?.reliability?.jobs?.total,
    }
  );

  const analyticsPageResponse = await fetch(`${appUrl}/en/admin/analytics`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const analyticsPageHtml = await analyticsPageResponse.text();
  recordSmoke(
    summary,
    'admin analytics page exposes reliability tab',
    analyticsPageResponse.ok && analyticsPageHtml.includes('Reliability'),
    {
      status: analyticsPageResponse.status,
      hasReliability: analyticsPageHtml.includes('Reliability'),
    }
  );
}

async function runAdminDashboardSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser
): Promise<void> {
  const statsResponse = await fetch(`${appUrl}/api/admin/dashboard/stats`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const statsBody = await readJsonSafely<AdminDashboardStatsResponse>(statsResponse);
  recordSmoke(
    summary,
    'admin dashboard stats API returns real aggregate metrics',
    statsResponse.ok &&
      statsBody?.success === true &&
      typeof statsBody.data?.users?.total === 'number' &&
      typeof statsBody.data?.users?.growthValue === 'number' &&
      typeof statsBody.data?.subscriptions?.active === 'number' &&
      typeof statsBody.data?.roles?.active === 'number' &&
      typeof statsBody.data?.plugins?.enabled === 'number' &&
      typeof statsBody.data?.apiRequests?.total === 'string' &&
      statsBody.data?.apiRequests?.total !== '45.2K' &&
      statsBody.data?.meta?.usageSource === 'usage_history',
    {
      status: statsResponse.status,
      users: statsBody?.data?.users,
      subscriptions: statsBody?.data?.subscriptions,
      roles: statsBody?.data?.roles,
      plugins: statsBody?.data?.plugins,
      apiRequests: statsBody?.data?.apiRequests,
      meta: statsBody?.data?.meta,
    }
  );

  const recentUsersResponse = await fetch(`${appUrl}/api/admin/dashboard/recent-users`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const recentUsersBody = await readJsonSafely<{ success?: boolean; data?: unknown[] }>(
    recentUsersResponse
  );
  recordSmoke(
    summary,
    'admin dashboard recent users API returns latest users',
    recentUsersResponse.ok &&
      recentUsersBody?.success === true &&
      Array.isArray(recentUsersBody.data),
    {
      status: recentUsersResponse.status,
      count: recentUsersBody?.data?.length,
    }
  );
}

async function runAdminUsageSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser,
  target: SignedInUser & { userId: string }
): Promise<void> {
  const guestResponse = await fetch(`${appUrl}/api/admin/entitlements/usage`, {
    cache: 'no-store',
  });
  recordSmoke(summary, 'admin usage API rejects guests', guestResponse.status === 401, {
    status: guestResponse.status,
  });

  const usageSeedMetric = `codexUsage.metric${Date.now()}`;
  const usageSeedOtherMetric = `codexUsageOther.metric${Date.now()}`;
  await seedUsageHistoryRows(target.userId, usageSeedMetric, usageSeedOtherMetric);

  const usageResponse = await fetch(`${appUrl}/api/admin/entitlements/usage`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const usageBody = await readJsonSafely<AdminUsageResponse>(usageResponse);
  recordSmoke(
    summary,
    'admin usage API returns platform usage summary',
    usageResponse.ok &&
      usageBody?.success === true &&
      typeof usageBody.data?.rangeDays === 'number' &&
      typeof usageBody.data?.totalEvents === 'number' &&
      Array.isArray(usageBody.data?.topMetrics) &&
      Array.isArray(usageBody.data?.topUsers) &&
      Array.isArray(usageBody.data?.recentEvents),
    {
      status: usageResponse.status,
      rangeDays: usageBody?.data?.rangeDays,
      totalEvents: usageBody?.data?.totalEvents,
      metricCount: usageBody?.data?.topMetrics?.length,
      userCount: usageBody?.data?.topUsers?.length,
      recentCount: usageBody?.data?.recentEvents?.length,
    }
  );

  const metricFilterResponse = await fetch(
    `${appUrl}/api/admin/entitlements/usage?metric=${encodeURIComponent(usageSeedMetric)}&days=7&limit=5`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const metricFilterBody = await readJsonSafely<AdminUsageResponse>(metricFilterResponse);
  const metricTotal = metricFilterBody?.data?.topMetrics?.find(
    (metric) => metric.key === usageSeedMetric
  )?.total;
  recordSmoke(
    summary,
    'admin usage API filters by metric key',
    metricFilterResponse.ok &&
      metricFilterBody?.success === true &&
      metricFilterBody.data?.filters?.metric === usageSeedMetric &&
      metricTotal === 7 &&
      Boolean(metricFilterBody.data?.recentEvents?.every((event) => event.key === usageSeedMetric)),
    {
      status: metricFilterResponse.status,
      metric: metricFilterBody?.data?.filters?.metric,
      metricTotal,
      recentKeys: metricFilterBody?.data?.recentEvents?.map((event) => event.key),
    }
  );

  const userFilterResponse = await fetch(
    `${appUrl}/api/admin/entitlements/usage?userId=${encodeURIComponent(target.userId)}&days=7&limit=5`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const userFilterBody = await readJsonSafely<AdminUsageResponse>(userFilterResponse);
  recordSmoke(
    summary,
    'admin usage API filters by user id',
    userFilterResponse.ok &&
      userFilterBody?.success === true &&
      userFilterBody.data?.filters?.userId === target.userId &&
      (userFilterBody.data?.topUsers?.find((user) => user.userId === target.userId)?.total ?? 0) >=
        10 &&
      Boolean(userFilterBody.data?.recentEvents?.every((event) => event.userId === target.userId)),
    {
      status: userFilterResponse.status,
      userId: userFilterBody?.data?.filters?.userId,
      topUsers: userFilterBody?.data?.topUsers,
      recentUsers: userFilterBody?.data?.recentEvents?.map((event) => event.userId),
    }
  );

  const invalidUsageResponse = await fetch(`${appUrl}/api/admin/entitlements/usage?days=0`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  recordSmoke(
    summary,
    'admin usage API rejects invalid filter params',
    invalidUsageResponse.status === 400,
    { status: invalidUsageResponse.status }
  );

  const pageResponse = await fetch(`${appUrl}/en/admin/usage`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const pageHtml = await pageResponse.text();
  recordSmoke(
    summary,
    'admin usage page renders platform usage dashboard',
    pageResponse.ok &&
      pageHtml.includes('Usage') &&
      pageHtml.includes('Top Metrics') &&
      pageHtml.includes('Recent Events'),
    {
      status: pageResponse.status,
      hasUsageTitle: pageHtml.includes('Usage'),
      hasTopMetrics: pageHtml.includes('Top Metrics'),
      hasRecentEvents: pageHtml.includes('Recent Events'),
    }
  );
}

async function seedUsageHistoryRows(userId: string, metricKey: string, otherMetricKey: string) {
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });
  const [pluginId, ...metricParts] = metricKey.split('.');
  const [otherPluginId, ...otherMetricParts] = otherMetricKey.split('.');
  const now = new Date();

  try {
    await sql`
      insert into usage_history (
        idempotency_key,
        user_id,
        plugin_id,
        metric,
        value,
        unit,
        metadata,
        recorded_at
      )
      values
        (
          ${`codex_usage_${Date.now()}_a`},
          ${userId},
          ${pluginId},
          ${metricParts.join('.')},
          3,
          'count',
          ${sql.json({ source: 'codex-real-test' })},
          ${now}
        ),
        (
          ${`codex_usage_${Date.now()}_b`},
          ${userId},
          ${pluginId},
          ${metricParts.join('.')},
          4,
          'count',
          ${sql.json({ source: 'codex-real-test' })},
          ${now}
        ),
        (
          ${`codex_usage_${Date.now()}_c`},
          ${userId},
          ${otherPluginId},
          ${otherMetricParts.join('.')},
          5,
          'count',
          ${sql.json({ source: 'codex-real-test' })},
          ${now}
        )
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function runAdminAuditLogSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser & { userId: string }
): Promise<void> {
  const listResponse = await fetch(`${appUrl}/api/admin/audit-logs?limit=5`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const listBody = await readJsonSafely<{
    success?: boolean;
    logs?: Array<{ id?: string; userId?: string }>;
    pagination?: { total?: number; limit?: number };
  }>(listResponse);
  recordSmoke(
    summary,
    'admin audit log list API returns paginated logs',
    listResponse.ok &&
      listBody?.success === true &&
      Array.isArray(listBody.logs) &&
      listBody.pagination?.limit === 5,
    {
      status: listResponse.status,
      total: listBody?.pagination?.total,
      count: listBody?.logs?.length,
    }
  );

  const userFilterResponse = await fetch(
    `${appUrl}/api/admin/audit-logs?userId=${encodeURIComponent(admin.userId)}&limit=5`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const userFilterBody = await readJsonSafely<{
    success?: boolean;
    logs?: Array<{ userId?: string }>;
  }>(userFilterResponse);
  recordSmoke(
    summary,
    'admin audit log list accepts non-UUID userId filter',
    userFilterResponse.ok &&
      userFilterBody?.success === true &&
      Array.isArray(userFilterBody.logs) &&
      userFilterBody.logs.every((log) => log.userId === admin.userId),
    {
      status: userFilterResponse.status,
      userId: admin.userId,
      count: userFilterBody?.logs?.length,
    }
  );

  const csvExportResponse = await fetch(
    `${appUrl}/api/admin/audit-logs/export?format=csv&limit=5`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const csvText = await csvExportResponse.text();
  recordSmoke(
    summary,
    'admin audit log CSV export returns downloadable CSV',
    csvExportResponse.ok &&
      (csvExportResponse.headers.get('content-type') ?? '').includes('text/csv') &&
      (csvExportResponse.headers.get('content-disposition') ?? '').includes('audit-logs-') &&
      csvText.startsWith('# Exported for ') &&
      (csvText.includes('\nid,createdAt,userId') || csvText.endsWith('\nNo data to export')),
    {
      status: csvExportResponse.status,
      contentType: csvExportResponse.headers.get('content-type'),
    }
  );

  const jsonExportResponse = await fetch(
    `${appUrl}/api/admin/audit-logs/export?format=json&limit=5`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const jsonExportBody = await readJsonSafely<{
    watermark?: string;
    exportedAt?: string;
    logs?: unknown[];
  }>(jsonExportResponse);
  recordSmoke(
    summary,
    'admin audit log JSON export returns downloadable JSON payload',
    jsonExportResponse.ok &&
      (jsonExportResponse.headers.get('content-type') ?? '').includes('application/json') &&
      (jsonExportResponse.headers.get('content-disposition') ?? '').includes('audit-logs-') &&
      typeof jsonExportBody?.watermark === 'string' &&
      typeof jsonExportBody.exportedAt === 'string' &&
      Array.isArray(jsonExportBody.logs),
    {
      status: jsonExportResponse.status,
      contentType: jsonExportResponse.headers.get('content-type'),
      count: jsonExportBody?.logs?.length,
    }
  );

  const invalidExportResponse = await fetch(
    `${appUrl}/api/admin/audit-logs/export?format=json&limit=0`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  recordSmoke(
    summary,
    'admin audit log export rejects invalid limit',
    invalidExportResponse.status === 400,
    { status: invalidExportResponse.status }
  );
}

async function runAdminSystemSettingsSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser
): Promise<void> {
  const guestResponse = await fetch(`${appUrl}/api/admin/settings`, {
    cache: 'no-store',
  });
  recordSmoke(summary, 'admin system settings API rejects guests', guestResponse.status === 401, {
    status: guestResponse.status,
  });

  const getResponse = await fetch(`${appUrl}/api/admin/settings`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const getBody = await readJsonSafely<AdminSettingsResponse>(getResponse);
  recordSmoke(
    summary,
    'admin system settings API returns defaults',
    getResponse.ok &&
      getBody?.success === true &&
      typeof getBody.data?.general?.siteName === 'string' &&
      typeof getBody.data?.security?.sessionMaxAgeDays === 'number' &&
      typeof getBody.data?.email?.provider === 'string' &&
      typeof getBody.data?.notifications?.inAppEnabled === 'boolean',
    {
      status: getResponse.status,
      siteName: getBody?.data?.general?.siteName,
      provider: getBody?.data?.email?.provider,
    }
  );

  const updatedSiteName = `Ploykit Smoke ${Date.now()}`;
  const payload = {
    general: {
      siteName: updatedSiteName,
      supportEmail: 'support@example.com',
      defaultLocale: 'en',
      timezone: 'UTC',
    },
    security: {
      requireEmailVerification: true,
      sessionMaxAgeDays: 45,
      passwordMinLength: 10,
    },
    email: {
      provider: 'log',
      fromEmail: 'noreply@example.com',
      fromName: 'Ploykit Smoke',
      passwordResetDelivery: 'log',
    },
    notifications: {
      inAppEnabled: true,
      emailEnabled: false,
      webhookEnabled: false,
      digestFrequency: 'daily',
    },
  };
  const putResponse = await fetch(`${appUrl}/api/admin/settings`, {
    method: 'PUT',
    headers: jsonHeaders(appUrl, admin.cookie),
    body: JSON.stringify(payload),
  });
  const putBody = await readJsonSafely<AdminSettingsResponse>(putResponse);
  recordSmoke(
    summary,
    'admin system settings API persists updates',
    putResponse.ok &&
      putBody?.success === true &&
      putBody.data?.general?.siteName === updatedSiteName &&
      putBody.data?.security?.sessionMaxAgeDays === 45 &&
      putBody.data?.notifications?.digestFrequency === 'daily',
    {
      status: putResponse.status,
      siteName: putBody?.data?.general?.siteName,
      digestFrequency: putBody?.data?.notifications?.digestFrequency,
    }
  );

  const invalidResponse = await fetch(`${appUrl}/api/admin/settings`, {
    method: 'PUT',
    headers: jsonHeaders(appUrl, admin.cookie),
    body: JSON.stringify({
      ...payload,
      general: {
        ...payload.general,
        supportEmail: 'not-an-email',
      },
    }),
  });
  recordSmoke(
    summary,
    'admin system settings API rejects invalid payloads',
    invalidResponse.status === 400,
    { status: invalidResponse.status }
  );

  const readBackResponse = await fetch(`${appUrl}/api/admin/settings`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const readBackBody = await readJsonSafely<AdminSettingsResponse>(readBackResponse);
  recordSmoke(
    summary,
    'admin system settings API reads persisted values',
    readBackResponse.ok &&
      readBackBody?.success === true &&
      readBackBody.data?.general?.siteName === updatedSiteName &&
      readBackBody.data?.security?.passwordMinLength === 10,
    {
      status: readBackResponse.status,
      siteName: readBackBody?.data?.general?.siteName,
      passwordMinLength: readBackBody?.data?.security?.passwordMinLength,
    }
  );

  const pageResponse = await fetch(`${appUrl}/en/admin/settings`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const pageHtml = await pageResponse.text();
  recordSmoke(
    summary,
    'admin system settings page renders editable settings',
    pageResponse.ok && pageHtml.includes('System Settings'),
    {
      status: pageResponse.status,
      hasSystemSettings: pageHtml.includes('System Settings'),
    }
  );

  const auditResponse = await fetch(
    `${appUrl}/api/admin/audit-logs?action=system.config.update&resource=system_settings&limit=5`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const auditBody = await readJsonSafely<{
    success?: boolean;
    logs?: Array<{ action?: string; resource?: string; resourceId?: string }>;
  }>(auditResponse);
  recordSmoke(
    summary,
    'admin system settings update writes audit log',
    auditResponse.ok &&
      auditBody?.success === true &&
      Array.isArray(auditBody.logs) &&
      auditBody.logs.some(
        (log) =>
          log.action === 'system.config.update' &&
          log.resource === 'system_settings' &&
          log.resourceId === 'platform'
      ),
    {
      status: auditResponse.status,
      count: auditBody?.logs?.length,
    }
  );
}

async function runPublicAndAuthSmoke(summary: TestSummary, appUrl: string): Promise<void> {
  const plansResponse = await fetch(`${appUrl}/api/plans`, { cache: 'no-store' });
  recordSmoke(summary, 'public plans API', plansResponse.ok, { status: plansResponse.status });

  const contactInvalidResponse = await fetch(`${appUrl}/api/contact`, {
    method: 'POST',
    headers: jsonHeaders(appUrl),
    body: JSON.stringify({
      name: '',
      email: 'bad-email',
      subject: 'support',
      message: 'short',
    }),
  });
  const contactInvalidBody = await readJsonSafely<Record<string, unknown>>(contactInvalidResponse);
  recordSmoke(
    summary,
    'contact API rejects invalid payload',
    contactInvalidResponse.status === 400,
    {
      status: contactInvalidResponse.status,
      code: contactInvalidBody?.code,
    }
  );

  const contactValidResponse = await fetch(`${appUrl}/api/contact`, {
    method: 'POST',
    headers: jsonHeaders(appUrl),
    body: JSON.stringify({
      name: 'Codex Real Test',
      email: 'codex-real@example.com',
      subject: 'support',
      message: 'This is a real smoke test contact payload.',
    }),
  });
  recordSmoke(summary, 'contact API accepts valid payload', contactValidResponse.ok, {
    status: contactValidResponse.status,
  });

  const adminGuestResponse = await fetch(`${appUrl}/api/admin/plugins`, { cache: 'no-store' });
  recordSmoke(summary, 'admin API rejects guests', [401, 403].includes(adminGuestResponse.status), {
    status: adminGuestResponse.status,
  });

  const filesGuestResponse = await fetch(`${appUrl}/api/files`, { cache: 'no-store' });
  recordSmoke(summary, 'files API rejects guests', filesGuestResponse.status === 401, {
    status: filesGuestResponse.status,
  });

  const pluginApiGuestResponse = await fetch(samplePluginNotesUrl(appUrl), {
    cache: 'no-store',
  });
  const pluginApiGuestBody = await readJsonSafely<{
    code?: string;
    error?: { code?: string };
  }>(pluginApiGuestResponse);
  recordSmoke(
    summary,
    'plugin API is closed before installation or enablement',
    [401, 403, 404].includes(pluginApiGuestResponse.status),
    {
      status: pluginApiGuestResponse.status,
      code: pluginApiGuestBody?.code ?? pluginApiGuestBody?.error?.code,
    }
  );

  const pluginGuestResponse = await fetch(`${appUrl}/zh/plugins/${SAMPLE_PLUGIN_ID}`, {
    redirect: 'manual',
    cache: 'no-store',
  });
  recordSmoke(
    summary,
    'plugin page is not public before installation or enablement',
    [307, 308, 403, 404].includes(pluginGuestResponse.status),
    {
      status: pluginGuestResponse.status,
      location: pluginGuestResponse.headers.get('location'),
    }
  );
}

async function runAdminAndUserSmoke(
  summary: TestSummary,
  appUrl: string
): Promise<{
  admin: SignedInUser;
  regular: SignedInUser;
  adminUserId: string;
  regularUserId: string;
}> {
  const adminCookie = await signInAsAdmin(appUrl);
  const regular = await createRegularUser(appUrl);
  const adminUserId = await fetchSessionUserId(appUrl, adminCookie);
  const regularUserId = await fetchSessionUserId(appUrl, regular.cookie);

  recordSmoke(summary, 'admin HTTP sign-in', true, {
    cookieCount: adminCookie.split(';').length,
    userId: adminUserId,
  });
  recordSmoke(summary, 'regular user sign-up and sign-in', true, {
    email: regular.email,
    userId: regularUserId,
  });

  const regularAdminResponse = await fetch(`${appUrl}/api/admin/plugins`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  recordSmoke(summary, 'admin API rejects regular users', regularAdminResponse.status === 403, {
    status: regularAdminResponse.status,
  });

  return {
    admin: { email: ADMIN_EMAIL, cookie: adminCookie },
    regular,
    adminUserId,
    regularUserId,
  };
}

async function runPluginRuntimeSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser,
  regular: SignedInUser
): Promise<{
  adminNoteId: string;
  regularNoteId: string;
}> {
  const sample = await ensureSamplePluginEnabled(appUrl, admin.cookie);
  recordSmoke(summary, 'sample plugin installed and enabled', true, { plugin: sample });

  const enabledGuestApiResponse = await fetch(samplePluginNotesUrl(appUrl), {
    cache: 'no-store',
  });
  recordSmoke(
    summary,
    'enabled plugin API rejects guests',
    enabledGuestApiResponse.status === 401,
    {
      status: enabledGuestApiResponse.status,
    }
  );

  const enabledGuestPageResponse = await fetch(`${appUrl}/zh/plugins/${SAMPLE_PLUGIN_ID}`, {
    redirect: 'manual',
    cache: 'no-store',
  });
  recordSmoke(
    summary,
    'enabled plugin page redirects guests',
    [307, 308].includes(enabledGuestPageResponse.status) &&
      (enabledGuestPageResponse.headers.get('location') ?? '').includes('/zh/login'),
    {
      status: enabledGuestPageResponse.status,
      location: enabledGuestPageResponse.headers.get('location'),
    }
  );

  const pluginPageResponse = await fetch(`${appUrl}/zh/plugins/${SAMPLE_PLUGIN_ID}`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const pluginPageText = await pluginPageResponse.text();
  recordSmoke(
    summary,
    'authenticated plugin page renders',
    pluginPageResponse.ok && pluginPageText.includes('Sample Internal'),
    { status: pluginPageResponse.status }
  );

  const adminNoteTitle = `Codex admin smoke ${new Date().toISOString()}`;
  const adminNoteCreate = await createPluginNote(appUrl, admin.cookie, {
    title: adminNoteTitle,
    body: 'created by admin in scripts/codex-real-test.ts',
  });
  const adminNoteId = adminNoteCreate.note?.id;
  recordSmoke(
    summary,
    'plugin notes POST as admin',
    adminNoteCreate.response.status === 201 && Boolean(adminNoteId),
    { status: adminNoteCreate.response.status, noteId: adminNoteId }
  );

  const adminNotes = await listPluginNotes(appUrl, admin.cookie);
  recordSmoke(
    summary,
    'plugin notes GET returns admin note',
    adminNotes.response.ok && Boolean(adminNotes.notes.some((note) => note.id === adminNoteId)),
    { status: adminNotes.response.status, noteId: adminNoteId, count: adminNotes.notes.length }
  );

  const regularNotesBefore = await listPluginNotes(appUrl, regular.cookie);
  recordSmoke(
    summary,
    'plugin storage hides admin note from regular user',
    regularNotesBefore.response.ok &&
      !regularNotesBefore.notes.some((note) => note.id === adminNoteId),
    {
      status: regularNotesBefore.response.status,
      adminNoteId,
      regularCount: regularNotesBefore.notes.length,
    }
  );

  const regularNoteCreate = await createPluginNote(appUrl, regular.cookie, {
    title: `Codex regular smoke ${new Date().toISOString()}`,
    body: 'created by regular user in scripts/codex-real-test.ts',
  });
  const regularNoteId = regularNoteCreate.note?.id;
  recordSmoke(
    summary,
    'plugin notes POST as regular user',
    regularNoteCreate.response.status === 201 && Boolean(regularNoteId),
    { status: regularNoteCreate.response.status, noteId: regularNoteId }
  );

  const adminNotesAfterRegular = await listPluginNotes(appUrl, admin.cookie);
  recordSmoke(
    summary,
    'plugin storage hides regular note from admin user scope',
    adminNotesAfterRegular.response.ok &&
      !adminNotesAfterRegular.notes.some((note) => note.id === regularNoteId),
    {
      status: adminNotesAfterRegular.response.status,
      regularNoteId,
      adminCount: adminNotesAfterRegular.notes.length,
    }
  );

  return {
    adminNoteId: adminNoteId!,
    regularNoteId: regularNoteId!,
  };
}

async function runCapabilityDemoHostSurfaceSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser
): Promise<void> {
  const plugin = await ensurePluginEnabled(appUrl, admin.cookie, CAPABILITY_DEMO_PLUGIN_ID);
  recordSmoke(summary, 'capability demo plugin installed and enabled', true, { plugin });

  const aliasResponse = await fetch(`${appUrl}/zh/json`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const aliasHtml = await aliasResponse.text();
  recordSmoke(
    summary,
    'plugin public alias renders real page with route slot',
    aliasResponse.ok &&
      aliasHtml.includes('JSON Formatter') &&
      aliasHtml.includes('Public alias slot rendered for /json.'),
    {
      status: aliasResponse.status,
      hasTool: aliasHtml.includes('JSON Formatter'),
      hasRouteSlot: aliasHtml.includes('Public alias slot rendered for /json.'),
    }
  );

  recordSmoke(
    summary,
    'plugin public alias injects SEO and structured data',
    aliasHtml.includes('Format, inspect, and copy JSON from a plugin-owned public alias.') &&
      aliasHtml.includes('plugin-public-alias-structured-data-0') &&
      aliasHtml.includes('Plugin Public Alias JSON Formatter'),
    {
      hasDescription: aliasHtml.includes(
        'Format, inspect, and copy JSON from a plugin-owned public alias.'
      ),
      hasStructuredDataId: aliasHtml.includes('plugin-public-alias-structured-data-0'),
      hasStructuredDataName: aliasHtml.includes('Plugin Public Alias JSON Formatter'),
    }
  );

  const sitemapResponse = await fetch(`${appUrl}/sitemap.xml`, { cache: 'no-store' });
  const sitemapXml = await sitemapResponse.text();
  const localizedAliasUrls = [`${appUrl}/zh/json`, `${appUrl}/en/json`];
  recordSmoke(
    summary,
    'plugin public alias is listed in sitemap',
    sitemapResponse.ok && localizedAliasUrls.every((url) => sitemapXml.includes(url)),
    {
      status: sitemapResponse.status,
      localizedAliasUrls,
      hasLocalizedAliases: localizedAliasUrls.every((url) => sitemapXml.includes(url)),
      hasBareAlias: sitemapXml.includes(`${appUrl}/json`),
    }
  );

  recordSmoke(
    summary,
    'trusted plugin theme tokens reach rendered shell',
    aliasHtml.includes('--color-primary: #0369a1') &&
      aliasHtml.includes('--header-border-bottom: 1px solid #bae6fd'),
    {
      hasPrimaryToken: aliasHtml.includes('--color-primary: #0369a1'),
      hasHeaderBorderToken: aliasHtml.includes('--header-border-bottom: 1px solid #bae6fd'),
    }
  );
}

async function seedCapabilityDemoCredits(userId: string): Promise<number> {
  const balance = 1000;
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });

  try {
    await sql`
      update user_entitlements
      set usage_metrics = coalesce(usage_metrics, '{}'::jsonb)
        || ${sql.json({ 'platform.apiCallsRemaining': balance })}::jsonb,
          usage_updated_at = now(),
          updated_at = now()
      where user_id = ${userId}
        and status = 'active'
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }

  return balance;
}

async function readCapabilityDemoDbEvidence(input: {
  userId: string;
  workspaceId?: string;
  runId?: string;
  seed?: string;
  apiKeyId?: string;
}): Promise<Record<string, unknown>> {
  const sql = postgres(getDockerDatabaseUrl(), { max: 1 });

  try {
    const [storageRows, runRows, fileRows, usageRows, apiKeyRows, notificationRows] =
      await Promise.all([
        input.seed
          ? sql<{ count: number }[]>`
            select count(*)::int as count
            from plugin_records
            where plugin_id = ${CAPABILITY_DEMO_PLUGIN_ID}
              and collection_name = 'capability_demo_items'
              and data->>'title' like ${`%${input.seed}%`}
          `
          : Promise.resolve([]),
        input.runId
          ? sql<{ status: string; visibility: string; scope_type: string; scope_id: string }[]>`
            select status, visibility, scope_type, scope_id
            from plugin_runs
            where plugin_id = ${CAPABILITY_DEMO_PLUGIN_ID}
              and id = ${input.runId}
            limit 1
          `
          : Promise.resolve([]),
        input.workspaceId
          ? sql<{ count: number }[]>`
            select count(*)::int as count
            from plugin_files
            where plugin_id = ${CAPABILITY_DEMO_PLUGIN_ID}
              and scope_type = 'workspace'
              and scope_id = ${input.workspaceId}
          `
          : Promise.resolve([]),
        sql<{ metric: string; count: number }[]>`
        select metric, count(*)::int as count
        from usage_history
        where user_id = ${input.userId}
          and plugin_id = ${CAPABILITY_DEMO_PLUGIN_ID}
        group by metric
        order by metric
      `,
        input.apiKeyId
          ? sql<{ last_used_at: string | null; revoked_at: string | null; scope_type: string }[]>`
            select last_used_at, revoked_at, scope_type
            from plugin_api_keys
            where id = ${input.apiKeyId}
              and plugin_id = ${CAPABILITY_DEMO_PLUGIN_ID}
            limit 1
          `
          : Promise.resolve([]),
        sql<{ count: number }[]>`
        select count(*)::int as count
        from notifications
        where user_id = ${input.userId}
          and type = ${`${CAPABILITY_DEMO_PLUGIN_ID}.notification`}
      `,
      ]);

    return {
      storageProbeRows: Number(storageRows[0]?.count ?? 0),
      run: runRows[0] ?? null,
      pluginFileRows: Number(fileRows[0]?.count ?? 0),
      usageMetrics: usageRows,
      apiKey: apiKeyRows[0] ?? null,
      notificationCount: Number(notificationRows[0]?.count ?? 0),
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function writeCapabilityDemoRuntimeReport(input: {
  appUrl: string;
  userId: string;
  response: CapabilityDemoSelfTestResponse;
  echoStatus?: number;
  echoBody?: Record<string, unknown> | null;
  invalidKeyStatus?: number;
  expiredKeyStatus?: number;
  crossPluginKeyStatus?: number;
  crossWorkspaceKeyStatus?: number;
  crossRouteKeyStatus?: number;
  revokedKeyStatus?: number;
  webhookStatus?: number;
  webhookBody?: Record<string, unknown> | null;
  dbEvidence?: Record<string, unknown>;
}): Promise<void> {
  const reportPath = resolve(
    process.cwd(),
    'docs',
    'capability-demo宿主能力真实运行测试报告.zh-CN.md'
  );
  const checks = input.response.checks ?? [];
  const rows = checks
    .map((check) => {
      const note = check.error?.code ?? check.reason ?? '';
      return `| ${check.id} | ${check.capability} | ${check.status} | ${note.replace(/\|/g, '/')} |`;
    })
    .join('\n');

  const failed = checks.filter((check) => check.status === 'failed');
  const skipped = checks.filter((check) => check.status === 'skipped');
  const body = `# Capability Demo 宿主能力真实运行测试报告

生成时间：${new Date().toISOString()}

测试对象：\`plugins/capability-demo\`

运行入口：\`${input.appUrl}/api/plugins/capability-demo/self-test\`

测试用户：\`${input.userId}\`

## 总结

- Self-test 状态：${input.response.ok ? '通过' : '失败'}
- passed：${input.response.statusCounts?.passed ?? 0}
- skipped：${input.response.statusCounts?.skipped ?? 0}
- failed：${input.response.statusCounts?.failed ?? 0}
- seed：\`${input.response.seed ?? ''}\`
- workspace：\`${input.response.workspaceScope?.id ?? ''}\`
- run：\`${input.response.runId ?? ''}\`
- API key echo：HTTP ${input.echoStatus ?? 'n/a'}
- invalid API key：HTTP ${input.invalidKeyStatus ?? 'n/a'}
- expired API key：HTTP ${input.expiredKeyStatus ?? 'n/a'}
- cross-plugin API key：HTTP ${input.crossPluginKeyStatus ?? 'n/a'}
- cross-workspace API key：HTTP ${input.crossWorkspaceKeyStatus ?? 'n/a'}
- cross-route API key：HTTP ${input.crossRouteKeyStatus ?? 'n/a'}
- revoked API key：HTTP ${input.revokedKeyStatus ?? 'n/a'}
- plugin webhook：HTTP ${input.webhookStatus ?? 'n/a'}

## 结论

真实 Next runtime 中，capability-demo 已覆盖宿主 storage、workspace、files、runs、artifacts、RAG、metering、credits、billing read gate、API key machine auth、rate limit、connectors、events、jobs、webhook、config、secrets、notifications、usage、audit、UI toast、external HTTP、SEO/sitemap/slots/theme/assets。AI 与兑换码兑换如果宿主未配置 provider/兑换码账本，会按平台边界返回 unavailable/skip，而不是伪造通过。

## 失败项

${failed.length ? failed.map((check) => `- ${check.id}: ${check.error?.message ?? check.reason ?? 'failed'}`).join('\n') : '- 无'}

## 跳过项

${skipped.length ? skipped.map((check) => `- ${check.id}: ${check.reason ?? check.error?.message ?? 'skipped'}`).join('\n') : '- 无'}

## 分项结果

| ID | 能力 | 状态 | 备注 |
| --- | --- | --- | --- |
${rows}

## API Key / Webhook 证据

\`\`\`json
${JSON.stringify(
  {
    echoStatus: input.echoStatus,
    echoBody: input.echoBody,
    invalidKeyStatus: input.invalidKeyStatus,
    expiredKeyStatus: input.expiredKeyStatus,
    crossPluginKeyStatus: input.crossPluginKeyStatus,
    crossWorkspaceKeyStatus: input.crossWorkspaceKeyStatus,
    crossRouteKeyStatus: input.crossRouteKeyStatus,
    revokedKeyStatus: input.revokedKeyStatus,
    webhookStatus: input.webhookStatus,
    webhookBody: input.webhookBody,
  },
  null,
  2
)}
\`\`\`

## DB 抽样证据

\`\`\`json
${JSON.stringify(input.dbEvidence ?? {}, null, 2)}
\`\`\`
`;

  writeFileSync(reportPath, body, 'utf-8');
}

async function runCapabilityDemoRuntimeSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser,
  regular: SignedInUser & { userId: string }
): Promise<void> {
  const plugin = await ensurePluginEnabled(appUrl, admin.cookie, CAPABILITY_DEMO_PLUGIN_ID);
  recordSmoke(summary, 'capability demo runtime plugin installed and enabled', true, { plugin });
  const seededCredits = await seedCapabilityDemoCredits(regular.userId);

  const pageResponse = await fetch(`${appUrl}/zh/tools/self-test`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const pageHtml = await pageResponse.text();
  recordSmoke(
    summary,
    'capability demo self-test page renders for signed-in user',
    pageResponse.ok && pageHtml.includes('Capability Self Test'),
    { status: pageResponse.status, hasTitle: pageHtml.includes('Capability Self Test') }
  );

  const selfTestResponse = await fetch(
    `${appUrl}/api/plugins/${CAPABILITY_DEMO_PLUGIN_ID}/self-test`,
    {
      method: 'POST',
      headers: jsonHeaders(appUrl, regular.cookie),
      body: JSON.stringify({
        includeAi: true,
        includeExternal: true,
        createApiKey: true,
        returnApiKey: true,
      }),
    }
  );
  const selfTestBody = await readJsonSafely<CapabilityDemoSelfTestResponse>(selfTestResponse);
  const failedChecks =
    selfTestBody?.checks?.filter((check) => check.status === 'failed').map((check) => check.id) ??
    [];
  recordSmoke(
    summary,
    'capability demo self-test API exercises host capability surface',
    selfTestResponse.ok && selfTestBody?.ok === true && failedChecks.length === 0,
    {
      status: selfTestResponse.status,
      seededCredits,
      counts: selfTestBody?.statusCounts,
      seed: selfTestBody?.seed,
      failedChecks,
      skippedChecks: selfTestBody?.checks
        ?.filter((check) => check.status === 'skipped')
        .map((check) => ({ id: check.id, reason: check.reason ?? check.error?.code })),
    }
  );

  const apiKey = selfTestBody?.apiKey?.key;
  const apiKeyEchoResponse = apiKey
    ? await fetch(`${appUrl}/api/plugins/${CAPABILITY_DEMO_PLUGIN_ID}/api-key-echo`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          origin: appUrl,
        },
        body: JSON.stringify({ seed: selfTestBody?.seed }),
      })
    : null;
  const apiKeyEchoBody = apiKeyEchoResponse
    ? await readJsonSafely<Record<string, unknown>>(apiKeyEchoResponse)
    : null;
  const echoApiKey = apiKeyEchoBody?.apiKey as
    | { id?: string; scope?: { type?: string; id?: string }; permissions?: string[] }
    | undefined;
  recordSmoke(
    summary,
    'capability demo machine API key route accepts scoped bearer key',
    Boolean(
      apiKeyEchoResponse?.ok &&
      echoApiKey?.id === selfTestBody?.apiKey?.id &&
      echoApiKey?.scope?.id === selfTestBody?.apiKey?.scope?.id
    ),
    {
      status: apiKeyEchoResponse?.status,
      apiKeyId: echoApiKey?.id,
      scope: echoApiKey?.scope,
    }
  );

  const invalidKeyResponse = await fetch(
    `${appUrl}/api/plugins/${CAPABILITY_DEMO_PLUGIN_ID}/api-key-echo`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer pk_invalid_capability_demo',
        origin: appUrl,
      },
      body: JSON.stringify({ seed: selfTestBody?.seed }),
    }
  );
  recordSmoke(
    summary,
    'capability demo machine API key route rejects invalid bearer key',
    invalidKeyResponse.status === 401,
    { status: invalidKeyResponse.status }
  );

  let expiredKeyStatus: number | undefined;
  let crossPluginKeyStatus: number | undefined;
  let crossWorkspaceKeyStatus: number | undefined;
  let crossRouteKeyStatus: number | undefined;
  if (selfTestBody?.apiKey?.scope?.id) {
    const sql = postgres(getDockerDatabaseUrl(), { max: 1 });
    const fixtures = {
      expired: {
        id: `codex-expired-${Date.now()}`,
        key: `pk_capability_demo_codex_expired_${Date.now()}`,
      },
      crossPlugin: {
        id: `codex-cross-plugin-${Date.now()}`,
        key: `pk_capability_demo_codex_cross_plugin_${Date.now()}`,
      },
      crossWorkspace: {
        id: `codex-cross-workspace-${Date.now()}`,
        key: `pk_capability_demo_codex_cross_workspace_${Date.now()}`,
      },
      crossRoute: {
        id: `codex-cross-route-${Date.now()}`,
        key: `pk_capability_demo_codex_cross_route_${Date.now()}`,
      },
    };
    const otherWorkspaceId = `codex-other-workspace-${Date.now()}`;
    try {
      await sql`
        insert into plugin_api_keys (
          id,
          plugin_id,
          user_id,
          scope_type,
          scope_id,
          name,
          prefix,
          key_hash,
          permissions,
          metadata,
          expires_at,
          created_at,
          updated_at
        )
        values
          (
            ${fixtures.expired.id},
            ${CAPABILITY_DEMO_PLUGIN_ID},
            ${regular.userId},
            'workspace',
            ${selfTestBody.apiKey.scope.id},
            'Codex expired key',
            'pk_capability_demo',
            ${hashPluginApiKey(fixtures.expired.key)},
            ${sql.json(['POST:/api-key-echo'])},
            ${sql.json({ source: 'codex-real-test', fixture: 'expired' })},
            now() - interval '1 minute',
            now(),
            now()
          ),
          (
            ${fixtures.crossPlugin.id},
            ${SAMPLE_PLUGIN_ID},
            ${regular.userId},
            'workspace',
            ${selfTestBody.apiKey.scope.id},
            'Codex cross plugin key',
            'pk_capability_demo',
            ${hashPluginApiKey(fixtures.crossPlugin.key)},
            ${sql.json(['POST:/api-key-echo'])},
            ${sql.json({ source: 'codex-real-test', fixture: 'cross-plugin' })},
            null,
            now(),
            now()
          ),
          (
            ${fixtures.crossWorkspace.id},
            ${CAPABILITY_DEMO_PLUGIN_ID},
            ${regular.userId},
            'workspace',
            ${otherWorkspaceId},
            'Codex cross workspace key',
            'pk_capability_demo',
            ${hashPluginApiKey(fixtures.crossWorkspace.key)},
            ${sql.json(['POST:/api-key-echo'])},
            ${sql.json({ source: 'codex-real-test', fixture: 'cross-workspace' })},
            null,
            now(),
            now()
          ),
          (
            ${fixtures.crossRoute.id},
            ${CAPABILITY_DEMO_PLUGIN_ID},
            ${regular.userId},
            'workspace',
            ${selfTestBody.apiKey.scope.id},
            'Codex cross route key',
            'pk_capability_demo',
            ${hashPluginApiKey(fixtures.crossRoute.key)},
            ${sql.json(['POST:/csv-convert'])},
            ${sql.json({ source: 'codex-real-test', fixture: 'cross-route' })},
            null,
            now(),
            now()
          )
      `;
    } finally {
      await sql.end({ timeout: 5 });
    }

    const expiredKeyResponse = await fetch(
      `${appUrl}/api/plugins/${CAPABILITY_DEMO_PLUGIN_ID}/api-key-echo`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.expired.key}`,
          origin: appUrl,
        },
        body: JSON.stringify({ seed: selfTestBody.seed }),
      }
    );
    expiredKeyStatus = expiredKeyResponse.status;
    recordSmoke(
      summary,
      'capability demo machine API key route rejects expired bearer key',
      expiredKeyResponse.status === 401,
      { status: expiredKeyResponse.status, apiKeyId: fixtures.expired.id }
    );

    const crossPluginKeyResponse = await fetch(
      `${appUrl}/api/plugins/${CAPABILITY_DEMO_PLUGIN_ID}/api-key-echo`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.crossPlugin.key}`,
          origin: appUrl,
        },
        body: JSON.stringify({ seed: selfTestBody.seed }),
      }
    );
    crossPluginKeyStatus = crossPluginKeyResponse.status;
    recordSmoke(
      summary,
      'capability demo machine API key route rejects cross-plugin bearer key',
      crossPluginKeyResponse.status === 401,
      { status: crossPluginKeyResponse.status, apiKeyId: fixtures.crossPlugin.id }
    );

    const crossWorkspaceKeyResponse = await fetch(
      `${appUrl}/api/plugins/${CAPABILITY_DEMO_PLUGIN_ID}/api-key-echo`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.crossWorkspace.key}`,
          origin: appUrl,
        },
        body: JSON.stringify({
          seed: selfTestBody.seed,
          requestedScope: {
            type: 'workspace',
            id: selfTestBody.apiKey.scope.id,
          },
        }),
      }
    );
    crossWorkspaceKeyStatus = crossWorkspaceKeyResponse.status;
    recordSmoke(
      summary,
      'capability demo machine API key route rejects cross-workspace bearer key',
      crossWorkspaceKeyResponse.status === 403,
      { status: crossWorkspaceKeyResponse.status, apiKeyId: fixtures.crossWorkspace.id }
    );

    const crossRouteKeyResponse = await fetch(
      `${appUrl}/api/plugins/${CAPABILITY_DEMO_PLUGIN_ID}/api-key-echo`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${fixtures.crossRoute.key}`,
          origin: appUrl,
        },
        body: JSON.stringify({ seed: selfTestBody.seed }),
      }
    );
    crossRouteKeyStatus = crossRouteKeyResponse.status;
    recordSmoke(
      summary,
      'capability demo machine API key route rejects cross-route bearer key',
      crossRouteKeyResponse.status === 403,
      { status: crossRouteKeyResponse.status, apiKeyId: fixtures.crossRoute.id }
    );
  }

  let revokedKeyStatus: number | undefined;
  if (selfTestBody?.apiKey?.id) {
    const sql = postgres(getDockerDatabaseUrl(), { max: 1 });
    try {
      await sql`
        update plugin_api_keys
        set revoked_at = now(),
            updated_at = now()
        where id = ${selfTestBody.apiKey.id}
      `;
    } finally {
      await sql.end({ timeout: 5 });
    }

    const revokedResponse = await fetch(
      `${appUrl}/api/plugins/${CAPABILITY_DEMO_PLUGIN_ID}/api-key-echo`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          origin: appUrl,
        },
        body: JSON.stringify({ seed: selfTestBody.seed }),
      }
    );
    revokedKeyStatus = revokedResponse.status;
    recordSmoke(
      summary,
      'capability demo machine API key route rejects revoked bearer key',
      revokedResponse.status === 401,
      { status: revokedResponse.status, apiKeyId: selfTestBody.apiKey.id }
    );
  }

  const webhookEventId = `evt_capability_demo_${Date.now()}`;
  const webhookResponse = await fetch(
    `${appUrl}/api/plugins/${CAPABILITY_DEMO_PLUGIN_ID}/webhooks/self-test`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: webhookEventId, seed: selfTestBody?.seed }),
    }
  );
  const webhookBody = await readJsonSafely<Record<string, unknown>>(webhookResponse);
  recordSmoke(
    summary,
    'capability demo plugin webhook route verifies and records receipt',
    webhookResponse.status === 202,
    { status: webhookResponse.status, body: webhookBody }
  );

  const assetResponse = await fetch(
    `${appUrl}/api/plugin-assets/${CAPABILITY_DEMO_PLUGIN_ID}/assets/template.svg`,
    { cache: 'no-store' }
  );
  const assetText = await assetResponse.text();
  recordSmoke(
    summary,
    'capability demo declared asset is served by plugin asset gateway',
    assetResponse.ok && assetText.includes('<svg'),
    { status: assetResponse.status, bytes: assetText.length }
  );

  const dbEvidence = await readCapabilityDemoDbEvidence({
    userId: regular.userId,
    workspaceId: selfTestBody?.workspaceScope?.id,
    runId: selfTestBody?.runId,
    seed: selfTestBody?.seed,
    apiKeyId: selfTestBody?.apiKey?.id,
  });
  const fullDbEvidence = {
    ...dbEvidence,
    webhookStatus: webhookResponse.status,
    webhookAccepted: webhookBody?.accepted === true,
  };
  recordSmoke(
    summary,
    'capability demo DB evidence shows real host-side persistence',
    Boolean(
      dbEvidence.run &&
      Number(dbEvidence.pluginFileRows ?? 0) >= 1 &&
      Array.isArray(dbEvidence.usageMetrics) &&
      dbEvidence.apiKey &&
      webhookResponse.status === 202
    ),
    fullDbEvidence
  );

  await writeCapabilityDemoRuntimeReport({
    appUrl,
    userId: regular.userId,
    response: selfTestBody ?? {},
    echoStatus: apiKeyEchoResponse?.status,
    echoBody: apiKeyEchoBody,
    invalidKeyStatus: invalidKeyResponse.status,
    expiredKeyStatus,
    crossPluginKeyStatus,
    crossWorkspaceKeyStatus,
    crossRouteKeyStatus,
    revokedKeyStatus,
    webhookStatus: webhookResponse.status,
    webhookBody,
    dbEvidence: fullDbEvidence,
  });
}

async function runFileStorageSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser & { userId?: string },
  regular: SignedInUser
): Promise<string> {
  const form = new FormData();
  const fileContent = `Codex real file smoke ${new Date().toISOString()}\n`;
  const file = new File([fileContent], 'codex-real-file.txt', { type: 'text/plain' });
  form.set('file', file);
  form.set('folder', 'codex-real');

  const uploadResponse = await fetch(`${appUrl}/api/files`, {
    method: 'POST',
    headers: formHeaders(appUrl, admin.cookie),
    body: form,
  });
  const uploadBody = await readJson<{ file?: UploadedFileRecord }>(uploadResponse);
  const fileId = uploadBody.file?.id;
  recordSmoke(
    summary,
    'file upload stores metadata and blob',
    uploadResponse.status === 201 && Boolean(fileId),
    {
      status: uploadResponse.status,
      fileId,
      path: uploadBody.file?.path,
      size: uploadBody.file?.size,
    }
  );

  const uploadedSize = uploadBody.file?.size ?? fileContent.length;
  if (admin.userId) {
    const usageResponse = await fetch(`${appUrl}/api/usage/${admin.userId}`, {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    });
    const usageBody = await readJson<UsageResponse>(usageResponse);
    recordSmoke(
      summary,
      'file upload syncs storage usage metric',
      usageResponse.ok && Number(usageBody.usage?.storage ?? 0) >= uploadedSize,
      {
        status: usageResponse.status,
        fileId,
        storageBytes: usageBody.usage?.storage ?? null,
        uploadedSize,
      }
    );
  }

  const listResponse = await fetch(`${appUrl}/api/files`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const listBody = await readJson<{ files?: UploadedFileRecord[] }>(listResponse);
  recordSmoke(
    summary,
    'file list returns uploaded file',
    listResponse.ok && Boolean(listBody.files?.some((entry) => entry.id === fileId)),
    { status: listResponse.status, fileId, count: listBody.files?.length ?? 0 }
  );

  const adminFilesResponse = await fetch(`${appUrl}/api/admin/files?limit=10`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const adminFilesBody = await readJson<{
    success?: boolean;
    files?: UploadedFileRecord[];
    pagination?: { total?: number };
  }>(adminFilesResponse);
  recordSmoke(
    summary,
    'admin files API lists files across users',
    adminFilesResponse.ok && Boolean(adminFilesBody.files?.some((entry) => entry.id === fileId)),
    {
      status: adminFilesResponse.status,
      total: adminFilesBody.pagination?.total,
      fileId,
    }
  );

  const adminFilteredFilesResponse = await fetch(
    `${appUrl}/api/admin/files?limit=10&search=${encodeURIComponent('codex-real-file')}&owner=${encodeURIComponent(
      admin.email
    )}&mimeType=${encodeURIComponent('text/plain')}&minSize=1&maxSize=${uploadedSize + 1024}`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const adminFilteredFilesBody = await readJson<{
    success?: boolean;
    files?: UploadedFileRecord[];
    pagination?: { total?: number };
  }>(adminFilteredFilesResponse);
  recordSmoke(
    summary,
    'admin files API filters by owner mime and size',
    adminFilteredFilesResponse.ok &&
      Boolean(
        adminFilteredFilesBody.files?.some(
          (entry) =>
            entry.id === fileId &&
            entry.mimeType === 'text/plain' &&
            entry.uploadedByEmail === admin.email
        )
      ),
    {
      status: adminFilteredFilesResponse.status,
      fileId,
      total: adminFilteredFilesBody.pagination?.total,
    }
  );

  const invalidFileFilterResponse = await fetch(
    `${appUrl}/api/admin/files?minSize=100&maxSize=10`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  recordSmoke(
    summary,
    'admin files API rejects invalid size range',
    invalidFileFilterResponse.status === 400,
    { status: invalidFileFilterResponse.status }
  );

  const adminDownloadResponse = await fetch(`${appUrl}/api/admin/files/${fileId}?download=true`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const adminDownloaded = await adminDownloadResponse.text();
  recordSmoke(
    summary,
    'admin files API downloads user file',
    adminDownloadResponse.ok && adminDownloaded === fileContent,
    {
      status: adminDownloadResponse.status,
      fileId,
      contentLength: adminDownloaded.length,
    }
  );

  const regularGetResponse = await fetch(`${appUrl}/api/files/${fileId}`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  recordSmoke(summary, 'file API enforces user ownership', regularGetResponse.status === 404, {
    status: regularGetResponse.status,
    fileId,
  });

  const downloadResponse = await fetch(`${appUrl}/api/files/${fileId}?download=true`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const downloaded = await downloadResponse.text();
  recordSmoke(
    summary,
    'file download returns uploaded bytes',
    downloadResponse.ok && downloaded === fileContent,
    {
      status: downloadResponse.status,
      fileId,
      contentLength: downloaded.length,
    }
  );

  const deleteResponse = await fetch(`${appUrl}/api/admin/files/${fileId}`, {
    method: 'DELETE',
    headers: jsonHeaders(appUrl, admin.cookie),
  });
  recordSmoke(summary, 'admin files API deletes user file', deleteResponse.ok, {
    status: deleteResponse.status,
    fileId,
  });

  const afterDeleteResponse = await fetch(`${appUrl}/api/files/${fileId}`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  recordSmoke(summary, 'file is unavailable after delete', afterDeleteResponse.status === 404, {
    status: afterDeleteResponse.status,
    fileId,
  });

  return fileId!;
}

async function runNotificationSmoke(
  summary: TestSummary,
  appUrl: string,
  regular: SignedInUser,
  admin: SignedInUser
): Promise<void> {
  const systemDefaultsPayload = {
    general: {
      siteName: `Ploykit Notification ${Date.now()}`,
      supportEmail: 'support@example.com',
      defaultLocale: 'en',
      timezone: 'UTC',
    },
    security: {
      requireEmailVerification: true,
      sessionMaxAgeDays: 45,
      passwordMinLength: 10,
    },
    email: {
      provider: 'log',
      fromEmail: 'noreply@example.com',
      fromName: 'Ploykit Notification',
      passwordResetDelivery: 'log',
    },
    notifications: {
      inAppEnabled: false,
      emailEnabled: false,
      webhookEnabled: false,
      digestFrequency: 'weekly',
    },
  };
  const defaultsUpdateResponse = await fetch(`${appUrl}/api/admin/settings`, {
    method: 'PUT',
    headers: jsonHeaders(appUrl, admin.cookie),
    body: JSON.stringify(systemDefaultsPayload),
  });
  recordSmoke(
    summary,
    'system notification defaults can be configured by admin settings',
    defaultsUpdateResponse.ok,
    { status: defaultsUpdateResponse.status }
  );

  const defaultsUser = await createRegularUser(appUrl, '127.0.0.105');
  const defaultsPreferencesResponse = await fetch(`${appUrl}/api/notifications/preferences`, {
    headers: authHeaders(defaultsUser.cookie),
    cache: 'no-store',
  });
  const defaultsPreferencesBody = await readJson<{
    preferences?: {
      emailEnabled?: boolean;
      inAppEnabled?: boolean;
      weeklyReportEnabled?: boolean;
      dailyDigestEnabled?: boolean;
    };
  }>(defaultsPreferencesResponse);
  recordSmoke(
    summary,
    'notification preferences inherit system defaults before user override',
    defaultsPreferencesResponse.ok &&
      defaultsPreferencesBody.preferences?.emailEnabled === false &&
      defaultsPreferencesBody.preferences?.inAppEnabled === false &&
      defaultsPreferencesBody.preferences?.weeklyReportEnabled === true &&
      defaultsPreferencesBody.preferences?.dailyDigestEnabled === false,
    {
      status: defaultsPreferencesResponse.status,
      emailEnabled: defaultsPreferencesBody.preferences?.emailEnabled,
      inAppEnabled: defaultsPreferencesBody.preferences?.inAppEnabled,
      weeklyReportEnabled: defaultsPreferencesBody.preferences?.weeklyReportEnabled,
    }
  );

  const skippedNotificationResponse = await fetch(`${appUrl}/api/notifications/test`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, defaultsUser.cookie),
    body: JSON.stringify({}),
  });
  const skippedNotificationBody = await readJson<{
    success?: boolean;
    queued?: boolean;
    notification?: unknown;
  }>(skippedNotificationResponse);
  recordSmoke(
    summary,
    'system notification defaults can skip in-app test notifications',
    skippedNotificationResponse.ok &&
      skippedNotificationBody.success === true &&
      skippedNotificationBody.queued === false &&
      skippedNotificationBody.notification === null,
    {
      status: skippedNotificationResponse.status,
      queued: skippedNotificationBody.queued,
    }
  );

  const preferencesPageResponse = await fetch(`${appUrl}/en/settings/notifications`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const preferencesPageHtml = await preferencesPageResponse.text();
  recordSmoke(
    summary,
    'user notification preferences page renders as account setting',
    preferencesPageResponse.ok && preferencesPageHtml.includes('Notification Preferences'),
    {
      status: preferencesPageResponse.status,
      hasTitle: preferencesPageHtml.includes('Notification Preferences'),
    }
  );

  const unreadResponse = await fetch(`${appUrl}/api/notifications/unread`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const unreadBody = await readJson<{ success?: boolean; notifications?: unknown[] }>(
    unreadResponse
  );
  recordSmoke(
    summary,
    'notifications unread API responds for authenticated user',
    unreadResponse.ok && unreadBody.success === true && Array.isArray(unreadBody.notifications),
    { status: unreadResponse.status, count: unreadBody.notifications?.length ?? 0 }
  );

  const preferencesResponse = await fetch(`${appUrl}/api/notifications/preferences`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const preferencesBody = await readJson<{ preferences?: { emailEnabled?: boolean } }>(
    preferencesResponse
  );
  recordSmoke(
    summary,
    'notification preferences GET returns defaults',
    preferencesResponse.ok && typeof preferencesBody.preferences?.emailEnabled === 'boolean',
    { status: preferencesResponse.status, emailEnabled: preferencesBody.preferences?.emailEnabled }
  );

  const updateResponse = await fetch(`${appUrl}/api/notifications/preferences`, {
    method: 'PUT',
    headers: jsonHeaders(appUrl, regular.cookie),
    body: JSON.stringify({
      emailEnabled: false,
      emailAddress: regular.email,
      webhookEnabled: false,
      inAppEnabled: true,
      notifyOnUsageWarning: true,
      notifyOnUsageCritical: true,
      notifyOnUsageExceeded: true,
      notifyOnTrialEvents: true,
      notifyOnSubscriptionEvents: true,
      notifyOnPaymentEvents: true,
      dailyDigestEnabled: false,
      weeklyReportEnabled: true,
    }),
  });
  const updateBody = await readJson<{
    preferences?: { emailEnabled?: boolean; inAppEnabled?: boolean; weeklyReportEnabled?: boolean };
  }>(updateResponse);
  recordSmoke(
    summary,
    'notification preferences PUT persists settings',
    updateResponse.ok &&
      updateBody.preferences?.emailEnabled === false &&
      updateBody.preferences.inAppEnabled === true &&
      updateBody.preferences.weeklyReportEnabled === true,
    {
      status: updateResponse.status,
      emailEnabled: updateBody.preferences?.emailEnabled,
      inAppEnabled: updateBody.preferences?.inAppEnabled,
      weeklyReportEnabled: updateBody.preferences?.weeklyReportEnabled,
    }
  );

  const testNotificationResponse = await fetch(`${appUrl}/api/notifications/test`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, regular.cookie),
    body: JSON.stringify({}),
  });
  recordSmoke(
    summary,
    'test notification endpoint accepts authenticated request',
    testNotificationResponse.ok,
    {
      status: testNotificationResponse.status,
    }
  );

  const historyResponse = await fetch(`${appUrl}/api/notifications/history?limit=10`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const historyBody = await readJson<{
    success?: boolean;
    history?: NotificationSmokeRecord[];
  }>(historyResponse);
  const testNotification = historyBody.history?.find(
    (notification) => notification.type === 'notification.test' && notification.id
  );
  recordSmoke(
    summary,
    'notification history API returns real notifications',
    historyResponse.ok &&
      historyBody.success === true &&
      Array.isArray(historyBody.history) &&
      Boolean(testNotification?.id),
    {
      status: historyResponse.status,
      count: historyBody.history?.length ?? 0,
    }
  );

  const markReadResponse = testNotification?.id
    ? await fetch(`${appUrl}/api/notifications/${testNotification.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(appUrl, regular.cookie),
      })
    : null;
  const markReadBody = markReadResponse
    ? await readJson<{ success?: boolean; notification?: NotificationSmokeRecord }>(
        markReadResponse
      )
    : null;
  recordSmoke(
    summary,
    'notification mark-read endpoint marks one notification read',
    Boolean(
      markReadResponse?.ok &&
      markReadBody?.success === true &&
      markReadBody.notification?.id === testNotification?.id &&
      typeof markReadBody.notification?.readAt === 'string'
    ),
    {
      status: markReadResponse?.status,
      notificationId: testNotification?.id,
      readAt: markReadBody?.notification?.readAt,
    }
  );

  const readAllSeedResponse = await fetch(`${appUrl}/api/notifications/test`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, regular.cookie),
    body: JSON.stringify({}),
  });
  const readAllSeedBody = await readJson<{
    success?: boolean;
    notification?: NotificationSmokeRecord | null;
  }>(readAllSeedResponse);
  const readAllResponse = await fetch(`${appUrl}/api/notifications/read-all`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, regular.cookie),
  });
  const readAllBody = await readJson<{ success?: boolean; updated?: number }>(readAllResponse);
  const readAllHistoryResponse = await fetch(`${appUrl}/api/notifications/history?limit=20`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const readAllHistoryBody = await readJson<{
    success?: boolean;
    history?: NotificationSmokeRecord[];
  }>(readAllHistoryResponse);
  const readAllSeedAfter = readAllHistoryBody.history?.find(
    (notification) => notification.id === readAllSeedBody.notification?.id
  );
  recordSmoke(
    summary,
    'notification read-all endpoint marks unread in-app notifications read',
    readAllSeedResponse.ok &&
      Boolean(readAllSeedBody.notification?.id) &&
      readAllResponse.ok &&
      readAllBody.success === true &&
      typeof readAllBody.updated === 'number' &&
      readAllBody.updated >= 1 &&
      typeof readAllSeedAfter?.readAt === 'string',
    {
      seedStatus: readAllSeedResponse.status,
      status: readAllResponse.status,
      updated: readAllBody.updated,
      seedNotificationId: readAllSeedBody.notification?.id,
      seedReadAt: readAllSeedAfter?.readAt,
    }
  );

  const deleteSeedResponse = await fetch(`${appUrl}/api/notifications/test`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, regular.cookie),
    body: JSON.stringify({}),
  });
  const deleteSeedBody = await readJson<{
    success?: boolean;
    notification?: NotificationSmokeRecord | null;
  }>(deleteSeedResponse);
  const deleteResponse = deleteSeedBody.notification?.id
    ? await fetch(`${appUrl}/api/notifications/${deleteSeedBody.notification.id}`, {
        method: 'DELETE',
        headers: jsonHeaders(appUrl, regular.cookie),
      })
    : null;
  const deleteBody = deleteResponse
    ? await readJson<{ success?: boolean; deleted?: boolean }>(deleteResponse)
    : null;
  const deleteHistoryResponse = await fetch(`${appUrl}/api/notifications/history?limit=20`, {
    headers: authHeaders(regular.cookie),
    cache: 'no-store',
  });
  const deleteHistoryBody = await readJson<{
    success?: boolean;
    history?: NotificationSmokeRecord[];
  }>(deleteHistoryResponse);
  recordSmoke(
    summary,
    'notification delete endpoint removes one notification',
    deleteSeedResponse.ok &&
      Boolean(deleteSeedBody.notification?.id) &&
      Boolean(deleteResponse?.ok) &&
      deleteBody?.success === true &&
      deleteBody.deleted === true &&
      !deleteHistoryBody.history?.some(
        (notification) => notification.id === deleteSeedBody.notification?.id
      ),
    {
      seedStatus: deleteSeedResponse.status,
      status: deleteResponse?.status,
      notificationId: deleteSeedBody.notification?.id,
    }
  );

  const ownershipSeedResponse = await fetch(`${appUrl}/api/notifications/test`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, regular.cookie),
    body: JSON.stringify({}),
  });
  const ownershipSeedBody = await readJson<{
    success?: boolean;
    notification?: NotificationSmokeRecord | null;
  }>(ownershipSeedResponse);
  const adminDeleteResponse = ownershipSeedBody.notification?.id
    ? await fetch(`${appUrl}/api/notifications/${ownershipSeedBody.notification.id}`, {
        method: 'DELETE',
        headers: jsonHeaders(appUrl, admin.cookie),
      })
    : null;
  const ownerCleanupResponse = ownershipSeedBody.notification?.id
    ? await fetch(`${appUrl}/api/notifications/${ownershipSeedBody.notification.id}`, {
        method: 'DELETE',
        headers: jsonHeaders(appUrl, regular.cookie),
      })
    : null;
  recordSmoke(
    summary,
    'notification delete endpoint enforces user ownership',
    ownershipSeedResponse.ok &&
      Boolean(ownershipSeedBody.notification?.id) &&
      adminDeleteResponse?.status === 404 &&
      Boolean(ownerCleanupResponse?.ok),
    {
      seedStatus: ownershipSeedResponse.status,
      adminDeleteStatus: adminDeleteResponse?.status,
      ownerCleanupStatus: ownerCleanupResponse?.status,
      notificationId: ownershipSeedBody.notification?.id,
    }
  );
}

async function runAdminEntitlementSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser,
  target: SignedInUser & { userId: string }
): Promise<EntitlementAdminSmokeState> {
  const plansResponse = await fetch(`${appUrl}/api/admin/entitlements/plans`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const plansBody = await readJson<{
    success?: boolean;
    data?: Array<{ id: string; slug: string; name: string }>;
  }>(plansResponse);
  const proPlan = plansBody.data?.find((plan) => plan.slug === 'pro') ?? plansBody.data?.[0];

  recordSmoke(
    summary,
    'admin entitlement plans list available for change plan',
    plansResponse.ok && Boolean(proPlan?.id),
    {
      status: plansResponse.status,
      targetPlanId: proPlan?.id,
      targetPlanSlug: proPlan?.slug,
    }
  );

  const changeResponse = await fetch(`${appUrl}/api/admin/entitlements/${target.userId}`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, admin.cookie),
    body: JSON.stringify({
      planId: proPlan!.id,
      status: 'active',
      notes: 'Codex real smoke change plan',
    }),
  });
  const changeBody = await readJson<{ success?: boolean; data?: { planId?: string } }>(
    changeResponse
  );
  recordSmoke(
    summary,
    'admin entitlement change plan endpoint updates user plan',
    changeResponse.ok && changeBody.success === true && changeBody.data?.planId === proPlan!.id,
    {
      status: changeResponse.status,
      success: changeBody.success,
      returnedPlanId: changeBody.data?.planId,
      expectedPlanId: proPlan!.id,
    }
  );

  const listAfterChangeResponse = await fetch(
    `${appUrl}/api/admin/entitlements/users?search=${encodeURIComponent(target.email)}&limit=5`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const listAfterChangeBody = await readJson<{
    success?: boolean;
    data?: {
      entitlements?: Array<{
        id: string;
        userId: string;
        status: string;
        plan?: { id: string; slug: string };
      }>;
    };
  }>(listAfterChangeResponse);
  const changedEntitlement = listAfterChangeBody.data?.entitlements?.find(
    (entitlement) => entitlement.userId === target.userId
  );
  recordSmoke(
    summary,
    'admin entitlement list reflects changed plan',
    listAfterChangeResponse.ok &&
      changedEntitlement?.status === 'active' &&
      changedEntitlement.plan?.id === proPlan!.id,
    {
      status: listAfterChangeResponse.status,
      userId: changedEntitlement?.userId,
      planId: changedEntitlement?.plan?.id,
      planSlug: changedEntitlement?.plan?.slug,
      entitlementStatus: changedEntitlement?.status,
    }
  );

  const cancelResponse = await fetch(`${appUrl}/api/admin/entitlements/${target.userId}`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, admin.cookie),
    body: JSON.stringify({
      entitlementId: changedEntitlement!.id,
      planId: proPlan!.id,
      status: 'cancelled',
      notes: 'Codex real smoke cancel subscription',
    }),
  });
  const cancelBody = await readJson<{
    success?: boolean;
    data?: { id?: string; status?: string; cancelledAt?: string };
  }>(cancelResponse);
  recordSmoke(
    summary,
    'admin entitlement cancel endpoint cancels subscription',
    cancelResponse.ok &&
      cancelBody.success === true &&
      cancelBody.data?.id === changedEntitlement!.id &&
      cancelBody.data?.status === 'cancelled',
    {
      status: cancelResponse.status,
      success: cancelBody.success,
      entitlementId: cancelBody.data?.id,
      returnedStatus: cancelBody.data?.status,
    }
  );

  const reactivateResponse = await fetch(`${appUrl}/api/admin/entitlements/${target.userId}`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, admin.cookie),
    body: JSON.stringify({
      entitlementId: changedEntitlement!.id,
      status: 'reactivate',
      notes: 'Codex real smoke reactivate subscription',
    }),
  });
  const reactivateBody = await readJson<{
    success?: boolean;
    data?: { id?: string; status?: string; cancelledAt?: string | null };
  }>(reactivateResponse);
  recordSmoke(
    summary,
    'admin entitlement reactivate endpoint restores subscription',
    reactivateResponse.ok &&
      reactivateBody.success === true &&
      reactivateBody.data?.id === changedEntitlement!.id &&
      reactivateBody.data?.status === 'active',
    {
      status: reactivateResponse.status,
      success: reactivateBody.success,
      entitlementId: reactivateBody.data?.id,
      returnedStatus: reactivateBody.data?.status,
      cancelledAt: reactivateBody.data?.cancelledAt,
    }
  );

  const listAfterReactivateResponse = await fetch(
    `${appUrl}/api/admin/entitlements/users?search=${encodeURIComponent(target.email)}&limit=5`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const listAfterReactivateBody = await readJson<{
    success?: boolean;
    data?: {
      entitlements?: Array<{
        id: string;
        userId: string;
        status: string;
        plan?: { id: string; slug: string };
      }>;
    };
  }>(listAfterReactivateResponse);
  const reactivatedEntitlement = listAfterReactivateBody.data?.entitlements?.find(
    (entitlement) => entitlement.id === changedEntitlement!.id
  );
  recordSmoke(
    summary,
    'admin entitlement list reflects reactivated subscription',
    listAfterReactivateResponse.ok &&
      reactivatedEntitlement?.status === 'active' &&
      reactivatedEntitlement.plan?.id === proPlan!.id,
    {
      status: listAfterReactivateResponse.status,
      userId: reactivatedEntitlement?.userId,
      entitlementId: reactivatedEntitlement?.id,
      planId: reactivatedEntitlement?.plan?.id,
      entitlementStatus: reactivatedEntitlement?.status,
    }
  );

  return {
    userId: target.userId,
    entitlementId: changedEntitlement!.id,
    targetPlanId: proPlan!.id,
    finalStatus: 'active',
  };
}

async function runAdminSurfaceSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser,
  target: SignedInUser & { userId: string }
): Promise<OutboxReplaySmokeState & WebhookRetryDetailSmokeState> {
  const devConsoleResponse = await fetch(`${appUrl}/api/admin/plugins/dev`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const devConsoleBody = await readJson<{ success?: boolean; data?: { plugins?: unknown[] } }>(
    devConsoleResponse
  );
  recordSmoke(
    summary,
    'plugin dev console API returns diagnostics',
    devConsoleResponse.ok && devConsoleBody.success === true && Boolean(devConsoleBody.data),
    {
      status: devConsoleResponse.status,
      pluginCount: devConsoleBody.data?.plugins?.length ?? null,
    }
  );

  const adminNotificationSettingsResponse = await fetch(
    `${appUrl}/en/admin/settings/notifications`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
      redirect: 'manual',
    }
  );
  recordSmoke(
    summary,
    'admin notification settings route redirects to user preferences',
    [307, 308].includes(adminNotificationSettingsResponse.status) &&
      adminNotificationSettingsResponse.headers
        .get('location')
        ?.includes('/en/settings/notifications') === true,
    {
      status: adminNotificationSettingsResponse.status,
      location: adminNotificationSettingsResponse.headers.get('location'),
    }
  );

  const userUpdateResponse = await fetch(`${appUrl}/api/admin/users/${target.userId}`, {
    method: 'PUT',
    headers: jsonHeaders(appUrl, admin.cookie),
    body: JSON.stringify({
      name: 'Codex Updated User',
    }),
  });
  const userUpdateBody = await readJson<{
    success?: boolean;
    user?: { id?: string; name?: string };
  }>(userUpdateResponse);
  recordSmoke(
    summary,
    'admin user update API accepts PUT used by hook',
    userUpdateResponse.ok &&
      userUpdateBody.success === true &&
      userUpdateBody.user?.id === target.userId &&
      userUpdateBody.user.name === 'Codex Updated User',
    {
      status: userUpdateResponse.status,
      userId: userUpdateBody.user?.id,
      name: userUpdateBody.user?.name,
    }
  );

  const userDetailPageResponse = await fetch(`${appUrl}/en/admin/users/${target.userId}`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const userDetailPageHtml = await userDetailPageResponse.text();
  const hasResetPasswordAction = />\s*Reset Password\s*</.test(userDetailPageHtml);
  const hasSuspendAction = />\s*Suspend\s*</.test(userDetailPageHtml);
  const hasRemoveAction = />\s*Remove\s*</.test(userDetailPageHtml);
  recordSmoke(
    summary,
    'admin user detail page avoids unwired user actions',
    userDetailPageResponse.ok &&
      userDetailPageHtml.includes('Edit in Users List') &&
      userDetailPageHtml.includes('Manage Roles') &&
      !hasResetPasswordAction &&
      !hasSuspendAction &&
      !hasRemoveAction,
    {
      status: userDetailPageResponse.status,
      hasEditNavigation: userDetailPageHtml.includes('Edit in Users List'),
      hasManageRolesNavigation: userDetailPageHtml.includes('Manage Roles'),
      hasResetPasswordAction,
      hasSuspendAction,
      hasRemoveAction,
    }
  );

  const roleSlug = `codex_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const roleCreateResponse = await fetch(`${appUrl}/api/admin/roles`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, admin.cookie),
    body: JSON.stringify({
      name: 'Codex Test Role',
      slug: roleSlug,
      description: 'Created by Codex real smoke',
      permissions: [],
      isDefault: false,
    }),
  });
  const roleCreateBody = await readJson<{
    success?: boolean;
    role?: { id?: string; slug?: string; name?: string };
  }>(roleCreateResponse);
  const roleId = roleCreateBody.role?.id ?? '';
  recordSmoke(
    summary,
    'admin role create API accepts role dialog payload',
    roleCreateResponse.ok && roleCreateBody.success === true && Boolean(roleId),
    {
      status: roleCreateResponse.status,
      roleId,
      slug: roleCreateBody.role?.slug,
    }
  );

  const roleUpdateResponse = await fetch(`${appUrl}/api/admin/roles/${roleId}`, {
    method: 'PUT',
    headers: jsonHeaders(appUrl, admin.cookie),
    body: JSON.stringify({
      name: 'Codex Updated Role',
      slug: roleSlug,
      description: 'Updated by Codex real smoke',
      isDefault: false,
    }),
  });
  const roleUpdateBody = await readJson<{
    success?: boolean;
    data?: { id?: string; name?: string; slug?: string };
  }>(roleUpdateResponse);
  recordSmoke(
    summary,
    'admin role update API accepts PUT used by hook',
    roleUpdateResponse.ok &&
      roleUpdateBody.success === true &&
      roleUpdateBody.data?.id === roleId &&
      roleUpdateBody.data.name === 'Codex Updated Role',
    {
      status: roleUpdateResponse.status,
      roleId: roleUpdateBody.data?.id,
      name: roleUpdateBody.data?.name,
    }
  );

  const rolesListResponse = await fetch(`${appUrl}/api/admin/roles?limit=100`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const rolesListBody = await readJsonSafely<AdminRolesResponse>(rolesListResponse);
  const currentUserRoleId = rolesListBody?.roles?.find((role) => role.slug === 'user')?.id;
  recordSmoke(
    summary,
    'admin role assignment list exposes built-in user role',
    rolesListResponse.ok && Boolean(currentUserRoleId),
    {
      status: rolesListResponse.status,
      roleId: currentUserRoleId,
      roleCount: rolesListBody?.roles?.length,
    }
  );

  const revokeRoleResponse = currentUserRoleId
    ? await fetch(`${appUrl}/api/admin/roles/${currentUserRoleId}/revoke`, {
        method: 'POST',
        headers: jsonHeaders(appUrl, admin.cookie),
        body: JSON.stringify({ userId: target.userId }),
      })
    : null;
  const revokeRoleBody = revokeRoleResponse
    ? await readJsonSafely<{ success?: boolean }>(revokeRoleResponse)
    : null;
  recordSmoke(
    summary,
    'admin role revoke endpoint removes a user assignment',
    revokeRoleResponse?.ok === true && revokeRoleBody?.success === true,
    {
      status: revokeRoleResponse?.status,
      userId: target.userId,
      roleId: currentUserRoleId,
    }
  );

  const assignRoleResponse = currentUserRoleId
    ? await fetch(`${appUrl}/api/admin/roles/${currentUserRoleId}/assign`, {
        method: 'POST',
        headers: jsonHeaders(appUrl, admin.cookie),
        body: JSON.stringify({ userId: target.userId }),
      })
    : null;
  const assignRoleBody = assignRoleResponse
    ? await readJsonSafely<{ id?: string; userId?: string; roleId?: string }>(assignRoleResponse)
    : null;
  recordSmoke(
    summary,
    'admin role assign endpoint restores a user assignment',
    assignRoleResponse?.status === 201 &&
      assignRoleBody?.userId === target.userId &&
      assignRoleBody?.roleId === currentUserRoleId,
    {
      status: assignRoleResponse?.status,
      assignmentId: assignRoleBody?.id,
      userId: assignRoleBody?.userId,
      roleId: assignRoleBody?.roleId,
    }
  );

  const roleDeleteResponse = await fetch(`${appUrl}/api/admin/roles/${roleId}`, {
    method: 'DELETE',
    headers: jsonHeaders(appUrl, admin.cookie),
  });
  recordSmoke(summary, 'admin role delete API removes smoke role', roleDeleteResponse.ok, {
    status: roleDeleteResponse.status,
    roleId,
  });

  const auditStatsResponse = await fetch(`${appUrl}/api/admin/audit-logs/stats`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const auditStatsBody = await readJsonSafely<Record<string, unknown>>(auditStatsResponse);
  recordSmoke(
    summary,
    'audit log stats API is admin-protected and reachable',
    auditStatsResponse.ok,
    {
      status: auditStatsResponse.status,
      keys: auditStatsBody ? Object.keys(auditStatsBody).slice(0, 8) : [],
    }
  );

  const quickStatusStartedAt = Date.now();
  const quickStatusResponse = await fetch(`${appUrl}/api/admin/dashboard/system-status`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const quickStatusElapsedMs = Date.now() - quickStatusStartedAt;
  type SystemStatusSmokeService = {
    name?: string;
    latency?: string;
    status?: string;
    statusCode?: string;
    details?: Record<string, unknown> & {
      authenticated?: boolean;
      catalogPoliciesChecked?: number;
      mode?: string;
    };
  };
  const quickStatusBody = await readJson<{
    success?: boolean;
    data?: SystemStatusSmokeService[];
  }>(quickStatusResponse);
  const quickRuntimeStatus = quickStatusBody.data?.find(
    (service) => service.name === 'Runtime Reconcile'
  );
  const quickStatusNames = new Set((quickStatusBody.data ?? []).map((service) => service.name));
  recordSmoke(
    summary,
    'admin dashboard system status quick mode responds without full reconcile',
    quickStatusResponse.ok &&
      quickStatusBody.success === true &&
      quickRuntimeStatus?.latency === 'background' &&
      quickRuntimeStatus.details?.mode === 'quick' &&
      quickStatusElapsedMs < 2_000,
    {
      status: quickStatusResponse.status,
      elapsedMs: quickStatusElapsedMs,
      runtimeLatency: quickRuntimeStatus?.latency,
      runtimeMode: quickRuntimeStatus?.details?.mode,
    }
  );
  const authStatus = quickStatusBody.data?.find((service) => service.name === 'Authentication');
  const apiGatewayStatus = quickStatusBody.data?.find((service) => service.name === 'API Gateway');
  recordSmoke(
    summary,
    'admin dashboard system status exposes real platform probes',
    quickStatusResponse.ok &&
      quickStatusNames.has('Authentication') &&
      quickStatusNames.has('API Gateway') &&
      quickStatusNames.has('Outbox Store') &&
      quickStatusNames.has('Webhook Receipts') &&
      quickStatusNames.has('File Storage Metadata') &&
      quickStatusNames.has('Plugin Registry') &&
      authStatus?.details?.authenticated === true &&
      typeof apiGatewayStatus?.details?.catalogPoliciesChecked === 'number' &&
      apiGatewayStatus.details.catalogPoliciesChecked >= 5,
    {
      status: quickStatusResponse.status,
      serviceNames: [...quickStatusNames],
      authDetails: authStatus?.details,
      apiGatewayDetails: apiGatewayStatus?.details,
    }
  );

  const fullStatusResponse = await fetch(`${appUrl}/api/admin/dashboard/system-status?mode=full`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const fullStatusBody = await readJson<{
    success?: boolean;
    data?: SystemStatusSmokeService[];
  }>(fullStatusResponse);
  const fullRuntimeStatus = fullStatusBody.data?.find(
    (service) => service.name === 'Runtime Reconcile'
  );
  recordSmoke(
    summary,
    'admin dashboard system status full mode runs runtime reconcile',
    fullStatusResponse.ok &&
      fullStatusBody.success === true &&
      fullRuntimeStatus?.details?.mode === 'full',
    {
      status: fullStatusResponse.status,
      runtimeStatus: fullRuntimeStatus?.status,
      runtimeMode: fullRuntimeStatus?.details?.mode,
    }
  );

  const operationsPageResponse = await fetch(`${appUrl}/zh/admin/operations`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
    redirect: 'manual',
  });
  const operationsPageHtml = await operationsPageResponse.text();
  const operationsPageHasTitle =
    operationsPageHtml.includes('Operations Center') || operationsPageHtml.includes('运维中心');
  recordSmoke(
    summary,
    'admin operations page renders operations center',
    operationsPageResponse.ok && operationsPageHasTitle,
    {
      status: operationsPageResponse.status,
      hasTitle: operationsPageHasTitle,
      hasEnglishTitle: operationsPageHtml.includes('Operations Center'),
      hasChineseTitle: operationsPageHtml.includes('运维中心'),
    }
  );

  const outboxDeadLettersResponse = await fetch(`${appUrl}/api/admin/outbox/dead-letters`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const outboxDeadLettersBody = await readJson<{
    success?: boolean;
    stats?: { total?: number; pending?: number; failed?: number };
    entries?: unknown[];
  }>(outboxDeadLettersResponse);
  recordSmoke(
    summary,
    'admin operations outbox dead letters API returns stats and entries',
    outboxDeadLettersResponse.ok &&
      outboxDeadLettersBody.success === true &&
      Boolean(outboxDeadLettersBody.stats) &&
      Array.isArray(outboxDeadLettersBody.entries),
    {
      status: outboxDeadLettersResponse.status,
      total: outboxDeadLettersBody.stats?.total,
      failed: outboxDeadLettersBody.stats?.failed,
      entryCount: outboxDeadLettersBody.entries?.length ?? null,
    }
  );

  const outboxEntryId = `codex_outbox_${Date.now()}`;
  const sqlClient = postgres(getDockerDatabaseUrl(), { max: 1 });
  try {
    await sqlClient`
      insert into event_outbox (
        id,
        event,
        payload,
        metadata,
        status,
        attempts,
        max_attempts,
        error,
        next_attempt_at,
        created_at,
        updated_at
      )
      values (
        ${outboxEntryId},
        'codex.smoke.dead_letter',
        ${sqlClient.json({ smoke: true })},
        ${sqlClient.json({
          emitterId: 'codex-smoke',
          eventId: outboxEntryId,
          correlationId: outboxEntryId,
          timestamp: new Date().toISOString(),
        })},
        'failed',
        3,
        3,
        'Codex smoke forced dead letter',
        now(),
        now(),
        now()
      )
      on conflict (id) do nothing
    `;
  } finally {
    await sqlClient.end({ timeout: 5 });
  }

  const replayResponse = await fetch(
    `${appUrl}/api/admin/outbox/dead-letters/${outboxEntryId}/replay`,
    {
      method: 'POST',
      headers: jsonHeaders(appUrl, admin.cookie),
    }
  );
  const replayBody = await readJsonSafely<{
    success?: boolean;
    replayed?: boolean;
    stats?: { pending?: number; failed?: number };
  }>(replayResponse);
  recordSmoke(
    summary,
    'admin outbox dead letter replay endpoint resets failed entry',
    replayResponse.ok && replayBody?.success === true && replayBody.replayed === true,
    {
      status: replayResponse.status,
      replayed: replayBody?.replayed,
      pending: replayBody?.stats?.pending,
      failed: replayBody?.stats?.failed,
    }
  );

  const replayAuditResponse = await fetch(
    `${appUrl}/api/admin/audit-logs?action=outbox.dead_letter.replay&resource=event_outbox&limit=5`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const replayAuditBody = await readJsonSafely<{
    success?: boolean;
    logs?: Array<{ action?: string; resource?: string; resourceId?: string }>;
  }>(replayAuditResponse);
  recordSmoke(
    summary,
    'admin outbox dead letter replay writes audit log',
    replayAuditResponse.ok &&
      replayAuditBody?.success === true &&
      Array.isArray(replayAuditBody.logs) &&
      replayAuditBody.logs.some(
        (log) =>
          log.action === 'outbox.dead_letter.replay' &&
          log.resource === 'event_outbox' &&
          log.resourceId === outboxEntryId
      ),
    {
      status: replayAuditResponse.status,
      entryId: outboxEntryId,
      count: replayAuditBody?.logs?.length,
    }
  );

  const webhookRetryListResponse = await fetch(`${appUrl}/api/admin/webhooks/retry?limit=10`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const webhookRetryListBody = await readJson<{
    success?: boolean;
    receipts?: unknown[];
    options?: { limit?: number };
  }>(webhookRetryListResponse);
  recordSmoke(
    summary,
    'admin operations webhook retry list API returns retryable receipts',
    webhookRetryListResponse.ok &&
      webhookRetryListBody.success === true &&
      Array.isArray(webhookRetryListBody.receipts) &&
      webhookRetryListBody.options?.limit === 10,
    {
      status: webhookRetryListResponse.status,
      receiptCount: webhookRetryListBody.receipts?.length ?? null,
      limit: webhookRetryListBody.options?.limit,
    }
  );

  const webhookReceiptId = crypto.randomUUID();
  const webhookEventId = `evt_codex_retry_${Date.now()}`;
  const webhookSqlClient = postgres(getDockerDatabaseUrl(), { max: 1 });
  try {
    await webhookSqlClient`
      insert into webhook_logs (
        id,
        provider,
        event_id,
        event_type,
        payload,
        headers,
        status,
        retry_count,
        error,
        created_at,
        updated_at
      )
      values (
        ${webhookReceiptId},
        'custom',
        ${webhookEventId},
        'codex.retry.detail',
        ${webhookSqlClient.json({ id: webhookEventId, type: 'codex.retry.detail' })},
        ${webhookSqlClient.json({})},
        'failed',
        0,
        'Codex smoke retry detail',
        now(),
        now()
      )
    `;
  } finally {
    await webhookSqlClient.end({ timeout: 5 });
  }

  const webhookDetailResponse = await fetch(
    `${appUrl}/api/admin/webhooks/retry/${webhookReceiptId}`,
    {
      headers: authHeaders(admin.cookie),
      cache: 'no-store',
    }
  );
  const webhookDetailBody = await readJsonSafely<{
    success?: boolean;
    receipt?: { id?: string; status?: string; eventId?: string | null };
    retries?: unknown[];
  }>(webhookDetailResponse);
  recordSmoke(
    summary,
    'admin webhook retry detail API returns receipt and retry history',
    webhookDetailResponse.ok &&
      webhookDetailBody?.success === true &&
      webhookDetailBody.receipt?.id === webhookReceiptId &&
      webhookDetailBody.receipt?.eventId === webhookEventId &&
      Array.isArray(webhookDetailBody.retries),
    {
      status: webhookDetailResponse.status,
      receiptStatus: webhookDetailBody?.receipt?.status,
      retryCount: webhookDetailBody?.retries?.length,
    }
  );

  const singleRetryResponse = await fetch(
    `${appUrl}/api/admin/webhooks/retry/${webhookReceiptId}`,
    {
      method: 'POST',
      headers: jsonHeaders(appUrl, admin.cookie),
    }
  );
  const singleRetryBody = await readJsonSafely<{
    success?: boolean;
    result?: { webhookLogId?: string; attempt?: number; success?: boolean; error?: string };
    receipt?: { id?: string; status?: string; retryCount?: number };
    retries?: unknown[];
  }>(singleRetryResponse);
  recordSmoke(
    summary,
    'admin webhook retry detail API retries one receipt',
    singleRetryResponse.ok &&
      singleRetryBody?.success === true &&
      singleRetryBody.result?.webhookLogId === webhookReceiptId &&
      singleRetryBody.result?.attempt === 1 &&
      singleRetryBody.receipt?.retryCount === 1 &&
      Array.isArray(singleRetryBody.retries) &&
      singleRetryBody.retries.length >= 1,
    {
      status: singleRetryResponse.status,
      resultSuccess: singleRetryBody?.result?.success,
      receiptStatus: singleRetryBody?.receipt?.status,
      retryCount: singleRetryBody?.receipt?.retryCount,
      retryHistoryCount: singleRetryBody?.retries?.length,
    }
  );

  return {
    entryId: outboxEntryId,
    receiptId: webhookReceiptId,
  };
}

async function runWebhookAndBillingSecuritySmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser
): Promise<WebhookSmokeState> {
  const billingProductsResponse = await fetch(`${appUrl}/api/billing/products`, {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  recordSmoke(
    summary,
    'production proxy blocks billing demo products API',
    billingProductsResponse.status === 404,
    { status: billingProductsResponse.status }
  );

  const stripeWebhookHealthResponse = await fetch(`${appUrl}/api/webhooks/stripe`, {
    cache: 'no-store',
  });
  const stripeHealth = await readJsonSafely<Record<string, unknown>>(stripeWebhookHealthResponse);
  recordSmoke(summary, 'stripe webhook health endpoint responds', stripeWebhookHealthResponse.ok, {
    status: stripeWebhookHealthResponse.status,
    hasAdapter: stripeHealth?.hasAdapter,
  });

  const stripeMissingSignatureResponse = await fetch(`${appUrl}/api/webhooks/stripe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'evt_codex_missing_signature', type: 'customer.created' }),
  });
  const stripeMissingSignatureBody = await readJsonSafely<Record<string, unknown>>(
    stripeMissingSignatureResponse
  );
  recordSmoke(
    summary,
    'stripe webhook rejects missing signature',
    stripeMissingSignatureResponse.status === 400,
    {
      status: stripeMissingSignatureResponse.status,
      code: stripeMissingSignatureBody?.code,
    }
  );

  const signedStripeEventId = `evt_codex_signed_${Date.now()}`;
  const signedStripePayload = JSON.stringify({
    id: signedStripeEventId,
    object: 'event',
    api_version: '2024-11-20.acacia',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'customer.created',
    data: {
      object: {
        id: `cus_codex_${Date.now()}`,
        object: 'customer',
        metadata: {},
      },
    },
  });
  const signedStripeResponse = await fetch(`${appUrl}/api/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': createStripeSignature(signedStripePayload),
    },
    body: signedStripePayload,
  });
  const signedStripeBody = await readJsonSafely<{
    received?: boolean;
    processed?: boolean;
    queuedForRetry?: boolean;
  }>(signedStripeResponse);
  recordSmoke(
    summary,
    'stripe webhook accepts a valid signed test event',
    signedStripeResponse.ok &&
      signedStripeBody?.received === true &&
      signedStripeBody.processed === true,
    {
      status: signedStripeResponse.status,
      eventId: signedStripeEventId,
      received: signedStripeBody?.received,
      processed: signedStripeBody?.processed,
      queuedForRetry: signedStripeBody?.queuedForRetry,
    }
  );

  const duplicateStripeResponse = await fetch(`${appUrl}/api/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'stripe-signature': createStripeSignature(signedStripePayload),
    },
    body: signedStripePayload,
  });
  const duplicateStripeBody = await readJsonSafely<{ duplicate?: boolean; received?: boolean }>(
    duplicateStripeResponse
  );
  recordSmoke(
    summary,
    'stripe webhook duplicate signed event is idempotent',
    duplicateStripeResponse.ok &&
      duplicateStripeBody?.received === true &&
      duplicateStripeBody.duplicate === true,
    {
      status: duplicateStripeResponse.status,
      eventId: signedStripeEventId,
      duplicate: duplicateStripeBody?.duplicate,
    }
  );

  const pluginWebhookMissingResponse = await fetch(
    `${appUrl}/api/plugins/${SAMPLE_PLUGIN_ID}/webhooks/missing`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'evt_codex_missing_plugin_webhook' }),
    }
  );
  const pluginWebhookMissingBody = await readJsonSafely<{
    code?: string;
    error?: { code?: string };
  }>(pluginWebhookMissingResponse);
  recordSmoke(
    summary,
    'plugin webhook runtime returns explicit missing route error',
    pluginWebhookMissingResponse.status === 404 &&
      (pluginWebhookMissingBody?.code === 'PLUGIN_WEBHOOK_ROUTE_NOT_FOUND' ||
        pluginWebhookMissingBody?.error?.code === 'PLUGIN_WEBHOOK_ROUTE_NOT_FOUND'),
    {
      status: pluginWebhookMissingResponse.status,
      code: pluginWebhookMissingBody?.code ?? pluginWebhookMissingBody?.error?.code,
    }
  );

  const retryGuestResponse = await fetch(`${appUrl}/api/admin/webhooks/retry`, {
    method: 'POST',
    headers: jsonHeaders(appUrl),
    body: JSON.stringify({ limit: 1 }),
  });
  recordSmoke(summary, 'admin webhook retry rejects guests', retryGuestResponse.status === 401, {
    status: retryGuestResponse.status,
  });

  const retryAdminResponse = await fetch(`${appUrl}/api/admin/webhooks/retry`, {
    method: 'POST',
    headers: jsonHeaders(appUrl, admin.cookie),
    body: JSON.stringify({ limit: 5, maxAttempts: 3 }),
  });
  const retryAdminBody = await readJson<{
    processed?: number;
    succeeded?: number;
    failed?: number;
  }>(retryAdminResponse);
  recordSmoke(summary, 'admin webhook retry endpoint processes queue', retryAdminResponse.ok, {
    status: retryAdminResponse.status,
    processed: retryAdminBody.processed,
    succeeded: retryAdminBody.succeeded,
    failed: retryAdminBody.failed,
  });

  return { signedStripeEventId };
}

async function runPluginLifecycleSmoke(
  summary: TestSummary,
  appUrl: string,
  admin: SignedInUser,
  databaseUrl: string
): Promise<void> {
  await postAdminAction(appUrl, admin.cookie, 'disable');
  const disabled = await getSamplePluginState(appUrl, admin.cookie);
  recordSmoke(summary, 'plugin disable API marks plugin disabled', disabled.enabled === false, {
    plugin: disabled,
  });

  const disabledApiResponse = await fetch(samplePluginNotesUrl(appUrl), {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  const disabledApiBody = await readJsonSafely<{ code?: string; error?: { code?: string } }>(
    disabledApiResponse
  );
  recordSmoke(
    summary,
    'disabled plugin API is blocked',
    disabledApiResponse.status === 403 &&
      (disabledApiBody?.code === 'PLUGIN_DISABLED' ||
        disabledApiBody?.error?.code === 'PLUGIN_DISABLED'),
    {
      status: disabledApiResponse.status,
      code: disabledApiBody?.code ?? disabledApiBody?.error?.code,
    }
  );

  const disabledPageResponse = await fetch(`${appUrl}/zh/plugins/${SAMPLE_PLUGIN_ID}`, {
    headers: authHeaders(admin.cookie),
    redirect: 'manual',
    cache: 'no-store',
  });
  recordSmoke(
    summary,
    'disabled plugin page is not rendered',
    disabledPageResponse.status === 404,
    {
      status: disabledPageResponse.status,
    }
  );

  await deleteAdminPlugin(appUrl, admin.cookie);
  const uninstalled = await getSamplePluginState(appUrl, admin.cookie);
  recordSmoke(
    summary,
    'plugin uninstall API removes installation',
    uninstalled.installed === false && uninstalled.enabled === undefined,
    { plugin: uninstalled }
  );
  await assertPluginUninstallCleanup(summary, databaseUrl);

  await postAdminAction(appUrl, admin.cookie, 'install');
  const installed = await getSamplePluginState(appUrl, admin.cookie);
  recordSmoke(
    summary,
    'plugin reinstall restores installed disabled state',
    installed.installed === true && installed.enabled === false,
    { plugin: installed }
  );

  const bindingResponse = await ensureSampleInternalServiceBinding(appUrl, admin.cookie);
  recordSmoke(
    summary,
    'plugin reinstall recreates required internal service binding',
    bindingResponse.ok,
    {
      status: bindingResponse.status,
    }
  );

  await postAdminAction(appUrl, admin.cookie, 'enable');
  const reenabled = await getSamplePluginState(appUrl, admin.cookie);
  recordSmoke(
    summary,
    'plugin re-enable restores runtime availability',
    reenabled.installed === true && reenabled.enabled === true,
    { plugin: reenabled }
  );

  const reenabledApiResponse = await fetch(samplePluginNotesUrl(appUrl), {
    headers: authHeaders(admin.cookie),
    cache: 'no-store',
  });
  recordSmoke(summary, 'plugin API works after reinstall and enable', reenabledApiResponse.ok, {
    status: reenabledApiResponse.status,
  });
}

async function runSmokeTests(
  summary: TestSummary,
  appUrl: string,
  databaseUrl: string
): Promise<{ adminCookie: string }> {
  await runPublicAndAuthSmoke(summary, appUrl);
  const identity = await runAdminAndUserSmoke(summary, appUrl);
  const passwordReset = await runPasswordResetSmoke(summary, appUrl, databaseUrl);
  await runProfileSmoke(summary, appUrl, identity.regular);
  const passwordlessUser = await runPasswordCapabilitySmoke(
    summary,
    appUrl,
    databaseUrl,
    identity.regular
  );
  await runUserBillingSmoke(summary, appUrl, {
    ...identity.regular,
    userId: identity.regularUserId,
  });
  await runAdminPlanManagementSmoke(summary, appUrl, identity.admin);
  await runAdminAnalyticsSmoke(summary, appUrl, identity.admin);
  await runAdminDashboardSmoke(summary, appUrl, identity.admin);
  await runAdminUsageSmoke(summary, appUrl, identity.admin, {
    ...identity.regular,
    userId: identity.regularUserId,
  });
  await runAdminAuditLogSmoke(summary, appUrl, {
    ...identity.admin,
    userId: identity.adminUserId,
  });
  await runAdminSystemSettingsSmoke(summary, appUrl, identity.admin);
  const notes = await runPluginRuntimeSmoke(summary, appUrl, identity.admin, identity.regular);
  await runCapabilityDemoHostSurfaceSmoke(summary, appUrl, identity.admin);
  await runCapabilityDemoRuntimeSmoke(summary, appUrl, identity.admin, {
    ...identity.regular,
    userId: identity.regularUserId,
  });
  const deletedFileId = await runFileStorageSmoke(
    summary,
    appUrl,
    { ...identity.admin, userId: identity.adminUserId },
    identity.regular
  );
  const entitlementAdmin = await runAdminEntitlementSmoke(summary, appUrl, identity.admin, {
    ...identity.regular,
    userId: identity.regularUserId,
  });

  await runNotificationSmoke(summary, appUrl, identity.regular, identity.admin);
  await runAdminSurfaceSmoke(summary, appUrl, identity.admin, {
    ...identity.regular,
    userId: identity.regularUserId,
  });
  const webhook = await runWebhookAndBillingSecuritySmoke(summary, appUrl, identity.admin);
  await assertDatabaseState(summary, databaseUrl, {
    ...identity,
    passwordReset,
    passwordlessUser,
    entitlementAdmin,
    ...notes,
    deletedFileId,
    ...webhook,
  });
  await runPluginLifecycleSmoke(summary, appUrl, identity.admin, databaseUrl);

  return {
    adminCookie: identity.admin.cookie,
  };
}

async function assertDatabaseState(
  summary: TestSummary,
  databaseUrl: string,
  state: {
    adminUserId: string;
    regularUserId: string;
    passwordReset: PasswordResetSmokeState;
    passwordlessUser: PasswordlessUserSmokeState;
    entitlementAdmin: EntitlementAdminSmokeState;
    adminNoteId: string;
    regularNoteId: string;
    deletedFileId: string;
    signedStripeEventId: string;
  }
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const installations = await sql<{ enabled: boolean }[]>`
      select enabled
      from plugin_installations
      where plugin_id = ${SAMPLE_PLUGIN_ID}
      limit 1
    `;
    recordSmoke(
      summary,
      'DB plugin installation assertion',
      installations.length === 1 && installations[0]?.enabled === true,
      { rows: installations.length, enabled: installations[0]?.enabled }
    );

    const adminRecords = state.adminNoteId
      ? await sql<{ id: string; user_id: string | null }[]>`
          select id
               , user_id
          from plugin_records
          where plugin_id = ${SAMPLE_PLUGIN_ID}
            and collection_name = 'sample_internal_notes'
            and id = ${state.adminNoteId}
            and user_id = ${state.adminUserId}
          limit 1
        `
      : [];
    recordSmoke(summary, 'DB admin plugin record assertion', adminRecords.length === 1, {
      noteId: state.adminNoteId,
      userId: adminRecords[0]?.user_id,
      rows: adminRecords.length,
    });

    const regularRecords = state.regularNoteId
      ? await sql<{ id: string; user_id: string | null }[]>`
          select id
               , user_id
          from plugin_records
          where plugin_id = ${SAMPLE_PLUGIN_ID}
            and collection_name = 'sample_internal_notes'
            and id = ${state.regularNoteId}
            and user_id = ${state.regularUserId}
          limit 1
        `
      : [];
    recordSmoke(summary, 'DB regular plugin record assertion', regularRecords.length === 1, {
      noteId: state.regularNoteId,
      userId: regularRecords[0]?.user_id,
      rows: regularRecords.length,
    });

    const crossUserLeakRows = await sql<{ count: number }[]>`
      select count(*)::int as count
      from plugin_records
      where plugin_id = ${SAMPLE_PLUGIN_ID}
        and collection_name = 'sample_internal_notes'
        and (
          (id = ${state.adminNoteId} and user_id = ${state.regularUserId})
          or (id = ${state.regularNoteId} and user_id = ${state.adminUserId})
        )
    `;
    recordSmoke(
      summary,
      'DB plugin records stay isolated by user id',
      Number(crossUserLeakRows[0]?.count ?? 0) === 0,
      { rows: Number(crossUserLeakRows[0]?.count ?? 0) }
    );

    const deletedFiles = await sql<{ count: number }[]>`
      select count(*)::int as count
      from files
      where id = ${state.deletedFileId}
    `;
    recordSmoke(
      summary,
      'DB file metadata removed after delete',
      Number(deletedFiles[0]?.count ?? 0) === 0,
      { fileId: state.deletedFileId, rows: Number(deletedFiles[0]?.count ?? 0) }
    );

    const adminUsageMetrics = await sql<
      { storage_bytes: string | null; active_file_bytes: string | null }[]
    >`
      select
        ue.usage_metrics->>'platform.storageBytes' as storage_bytes,
        (
          select coalesce(sum(f.size), 0)::text
          from files f
          where f.user_id = ${state.adminUserId}
            and f.delete_status = 'active'
        ) as active_file_bytes
      from user_entitlements ue
      where ue.user_id = ${state.adminUserId}
        and ue.status = 'active'
      order by ue.created_at desc
      limit 1
    `;
    const storageBytes =
      adminUsageMetrics[0]?.storage_bytes !== null &&
      adminUsageMetrics[0]?.storage_bytes !== undefined
        ? Number(adminUsageMetrics[0].storage_bytes)
        : null;
    const activeFileBytes =
      adminUsageMetrics[0]?.active_file_bytes !== null &&
      adminUsageMetrics[0]?.active_file_bytes !== undefined
        ? Number(adminUsageMetrics[0].active_file_bytes)
        : null;
    recordSmoke(
      summary,
      'DB storage usage metric synced after file cleanup',
      storageBytes === activeFileBytes,
      {
        userId: state.adminUserId,
        storageBytes,
        activeFileBytes,
      }
    );

    const remainingPasswordResetTokens = await sql<{ count: number }[]>`
      select count(*)::int as count
      from verification
      where value = ${state.passwordReset.userId}
        and identifier like 'reset-password:%'
    `;
    recordSmoke(
      summary,
      'DB password reset token removed after use',
      Number(remainingPasswordResetTokens[0]?.count ?? 0) === 0,
      {
        userId: state.passwordReset.userId,
        email: state.passwordReset.email,
        rows: Number(remainingPasswordResetTokens[0]?.count ?? 0),
      }
    );

    const entitlementRows = await sql<
      {
        id: string;
        plan_id: string;
        status: string;
        notes: string | null;
        cancelled_at: string | null;
      }[]
    >`
      select id
           , plan_id
           , status
           , notes
           , cancelled_at
      from user_entitlements
      where user_id = ${state.entitlementAdmin.userId}
      order by updated_at desc
      limit 1
    `;
    recordSmoke(
      summary,
      'DB admin entitlement change cancel and reactivate assertion',
      entitlementRows.length === 1 &&
        entitlementRows[0]?.id === state.entitlementAdmin.entitlementId &&
        entitlementRows[0]?.plan_id === state.entitlementAdmin.targetPlanId &&
        entitlementRows[0]?.status === state.entitlementAdmin.finalStatus &&
        entitlementRows[0]?.cancelled_at === null,
      {
        userId: state.entitlementAdmin.userId,
        entitlementId: entitlementRows[0]?.id,
        rows: entitlementRows.length,
        planId: entitlementRows[0]?.plan_id,
        status: entitlementRows[0]?.status,
        cancelledAt: entitlementRows[0]?.cancelled_at,
        notes: entitlementRows[0]?.notes,
      }
    );

    const passwordlessCredentialRows = await sql<{ count: number; has_password: boolean }[]>`
      select count(*)::int as count
           , bool_or(password is not null) as has_password
      from account
      where "userId" = ${state.passwordlessUser.userId}
        and "providerId" = 'credential'
    `;
    recordSmoke(
      summary,
      'DB passwordless user gained credential account',
      Number(passwordlessCredentialRows[0]?.count ?? 0) === 1 &&
        passwordlessCredentialRows[0]?.has_password === true,
      {
        userId: state.passwordlessUser.userId,
        email: state.passwordlessUser.email,
        rows: Number(passwordlessCredentialRows[0]?.count ?? 0),
        hasPassword: passwordlessCredentialRows[0]?.has_password,
      }
    );

    const stripeWebhookLogs = await sql<
      {
        status: string;
        retry_count: number | null;
        internal_events: string[] | null;
      }[]
    >`
      select status
           , retry_count
           , internal_events
      from webhook_logs
      where provider = 'stripe'
        and event_id = ${state.signedStripeEventId}
      order by created_at desc
      limit 1
    `;
    recordSmoke(
      summary,
      'DB signed stripe webhook receipt assertion',
      stripeWebhookLogs.length === 1 && stripeWebhookLogs[0]?.status === 'processed',
      {
        eventId: state.signedStripeEventId,
        rows: stripeWebhookLogs.length,
        status: stripeWebhookLogs[0]?.status,
        retryCount: stripeWebhookLogs[0]?.retry_count,
        internalEvents: stripeWebhookLogs[0]?.internal_events ?? [],
      }
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function assertPluginUninstallCleanup(
  summary: TestSummary,
  databaseUrl: string
): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const rows = await sql<
      {
        installations: number;
        collections: number;
        records: number;
        job_runs: number;
        config_rows: number;
        secret_rows: number;
      }[]
    >`
      select
        (select count(*)::int from plugin_installations where plugin_id = ${SAMPLE_PLUGIN_ID}) as installations,
        (select count(*)::int from plugin_collections where plugin_id = ${SAMPLE_PLUGIN_ID}) as collections,
        (select count(*)::int from plugin_records where plugin_id = ${SAMPLE_PLUGIN_ID}) as records,
        (select count(*)::int from plugin_job_runs where plugin_id = ${SAMPLE_PLUGIN_ID}) as job_runs,
        (select count(*)::int from plugin_config where plugin_id = ${SAMPLE_PLUGIN_ID}) as config_rows,
        (select count(*)::int from plugin_secrets where plugin_id = ${SAMPLE_PLUGIN_ID}) as secret_rows
    `;
    const counts = rows[0];
    const total =
      Number(counts?.installations ?? 0) +
      Number(counts?.collections ?? 0) +
      Number(counts?.records ?? 0) +
      Number(counts?.job_runs ?? 0) +
      Number(counts?.config_rows ?? 0) +
      Number(counts?.secret_rows ?? 0);

    recordSmoke(summary, 'DB plugin uninstall cleanup assertion', total === 0, {
      installations: counts?.installations ?? 0,
      collections: counts?.collections ?? 0,
      records: counts?.records ?? 0,
      jobRuns: counts?.job_runs ?? 0,
      configRows: counts?.config_rows ?? 0,
      secretRows: counts?.secret_rows ?? 0,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function runPlaywright(
  summary: TestSummary,
  appUrl: string,
  env: NodeJS.ProcessEnv,
  adminCookie: string
) {
  await runCommandStep(
    summary,
    'playwright install chromium',
    'npx',
    ['playwright', 'install', 'chromium'],
    env
  );

  await runCommandStep(
    summary,
    'playwright human tests',
    'npx',
    ['playwright', 'test', ...(summary.options.headed ? ['--headed'] : [])],
    {
      ...env,
      PLAYWRIGHT_BASE_URL: appUrl,
      PLAYWRIGHT_SKIP_WEBSERVER: '1',
      PLAYWRIGHT_ADMIN_COOKIE: adminCookie,
    }
  );

  await runCommandStep(summary, 'admin e2e coverage check', 'npm', ['run', 'test:admin:coverage'], {
    ...env,
    PLAYWRIGHT_BASE_URL: appUrl,
    PLAYWRIGHT_SKIP_WEBSERVER: '1',
    PLAYWRIGHT_ADMIN_COOKIE: adminCookie,
  });
}

async function runSetup(summary: TestSummary, env: NodeJS.ProcessEnv, options: RealTestOptions) {
  if (options.resetDb) {
    await runCommandStep(summary, 'docker db reset', 'docker', ['compose', 'down', '-v'], env);
  }

  await runCommandStep(summary, 'docker db up', 'docker', ['compose', 'up', '-d', 'db'], env);
  await runCommandStep(summary, 'migration structure verify', 'npm', ['run', 'db:verify'], env);
  await runCommandStep(summary, 'docker db wait', 'npm', ['run', 'db:docker:wait'], env);
  await runCommandStep(summary, 'database migrate', 'npm', ['run', 'db:migrate'], env);
  await runCommandStep(summary, 'seed tool site', 'npm', ['run', 'seed:tool-site'], env);
  await runCommandStep(summary, 'runtime reconcile', 'npm', ['run', 'runtime:check'], env);
  await runCommandStep(summary, 'plugin contract check', 'npm', ['run', 'plugins:check'], env);

  if (options.skipBuild) {
    summary.steps.push({ name: 'production build', status: 'skipped' });
    return;
  }

  await runCommandStep(summary, 'production build', 'npm', ['run', 'build'], env);
}

function writeSummary(summary: TestSummary): void {
  summary.finishedAt = new Date().toISOString();
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.stack || error.message : String(error);
}

async function main(): Promise<void> {
  const options = parseOptions();
  const appUrl = `http://${options.host}:${options.port}`;
  const env = createTestEnv(appUrl);
  const databaseUrl = getDockerDatabaseUrl(env);

  assertLocalDatabaseUrl(databaseUrl);
  resetResultDir();

  const summary: TestSummary = {
    status: 'failed',
    startedAt: new Date().toISOString(),
    appUrl,
    databaseUrl: maskDatabaseUrl(databaseUrl),
    options,
    steps: [],
    smoke: [],
  };

  let server: ChildProcess | null = null;

  try {
    console.log(`Using Docker database: ${maskDatabaseUrl(databaseUrl)}`);
    console.log(`Using app URL: ${appUrl}`);

    await runSetup(summary, env, options);

    if (options.prepareOnly) {
      summary.status = 'passed';
      return;
    }

    server = startServer(summary, appUrl, env);
    await waitForServer(appUrl, server);
    const smokeContext = await runSmokeTests(summary, appUrl, databaseUrl);

    if (options.playwright) {
      await runPlaywright(summary, appUrl, env, smokeContext.adminCookie);
    }

    summary.status = 'passed';
  } catch (error) {
    summary.error = serializeError(error);
    throw error;
  } finally {
    if (!options.keepServer) {
      await stopServer(server);
    }

    writeSummary(summary);
    console.log(`Wrote real test summary to ${SUMMARY_PATH}`);
  }
}

main().catch((error) => {
  console.error(serializeError(error));
  process.exitCode = 1;
});
