import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_BASE_URL = 'http://localhost:3000';
const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'host-smoke',
  checkedAt.replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'smoke.json');
const latestPath = path.resolve(process.cwd(), '.runtime', 'host-smoke', 'latest.json');

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const baseUrl = (readArg('--base-url') ?? process.env.HOST_SMOKE_BASE_URL ?? DEFAULT_BASE_URL)
  .replace(/\/$/, '');

const checks = [];

function formBody(values) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    params.set(key, value);
  }
  return params;
}

async function request(path, options = {}) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${baseUrl}${path}`, options);
    const body = await response.text();
    return {
      ok: true,
      status: response.status,
      body,
      headers: response.headers,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: '',
      headers: new Headers(),
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function sameOriginHeaders(path) {
  return {
    origin: baseUrl,
    referer: `${baseUrl}${path}`,
  };
}

async function checkPage(id, path, options = {}) {
  const response = await request(path, {
    headers: options.cookie ? { cookie: options.cookie } : undefined,
  });
  const contentOk = options.contains ? response.body.includes(options.contains) : true;
  checks.push({
    id,
    path,
    status: response.status,
    ok: response.ok && response.status === 200 && contentOk,
    durationMs: response.durationMs,
    error: response.error,
  });
}

async function checkPublicToolApi() {
  const response = await request('/api/modules/public-tools/format-json', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...sameOriginHeaders('/zh/demo'),
    },
    body: JSON.stringify({ source: '{"smoke":true}' }),
  });
  checks.push({
    id: 'public-tool-api',
    path: '/api/modules/public-tools/format-json',
    status: response.status,
    ok: response.ok && response.status === 200 && response.body.includes('"ok":true'),
    durationMs: response.durationMs,
    error: response.error,
  });
}

async function login() {
  const response = await request('/api/auth/login', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...sameOriginHeaders('/zh/login'),
    },
    body: formBody({
      email: 'admin@example.com',
      password: 'Admin@123456',
      next: '/zh/dashboard',
    }),
  });
  const cookie = response.headers.get('set-cookie') ?? '';
  checks.push({
    id: 'auth-login',
    path: '/api/auth/login',
    status: response.status,
    ok: response.ok && (response.status === 302 || response.status === 303) && cookie.length > 0,
    durationMs: response.durationMs,
    error: response.error,
  });
  return cookie.split(';')[0];
}

async function main() {
  await checkPage('site-home', '/zh', { contains: 'PloyKit' });
  await checkPage('auth-login-page', '/zh/login', { contains: '登录' });
  await checkPage('public-demo-page', '/zh/demo', { contains: 'Capability Demo' });
  await checkPublicToolApi();

  const cookie = await login();
  await checkPage('dashboard-billing', '/zh/dashboard/billing', { cookie, contains: '账单' });
  await checkPage('dashboard-tasks', '/zh/dashboard/tasks', { cookie, contains: '导出公开工具数据' });
  await checkPage('admin-modules', '/zh/admin/modules', { cookie, contains: 'public-tools-demo' });
  await checkPage('admin-users', '/zh/admin/users', { cookie, contains: 'admin@example.com' });
  await checkPage('admin-webhooks', '/zh/admin/webhooks', { cookie, contains: 'Outbox' });

  const result = {
    ok: checks.every((check) => check.ok),
    baseUrl,
    checkedAt,
    checks,
    artifacts: {
      report: reportPath,
      latest: latestPath,
    },
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(latestPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
  fs.copyFileSync(reportPath, latestPath);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
