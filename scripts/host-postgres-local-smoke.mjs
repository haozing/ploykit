import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const skipDocker = process.argv.includes('--no-docker');
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://ploykit:ploykit@127.0.0.1:55432/ploykit';
const checkedAt = new Date().toISOString();

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function redactDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = 'REDACTED';
    }
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:\s]+):([^@\s]+)@/, '://$1:REDACTED@');
  }
}

function parseJsonFromOutput(stdout) {
  const trimmed = stdout.trim();
  const objectStart = trimmed.indexOf('{');
  if (objectStart < 0) {
    return trimmed;
  }
  try {
    return JSON.parse(trimmed.slice(objectStart));
  } catch {
    return trimmed;
  }
}

function summarizeTap(stdout) {
  return {
    tests: Number(stdout.match(/# tests (\d+)/)?.[1] ?? 0),
    pass: Number(stdout.match(/# pass (\d+)/)?.[1] ?? 0),
    fail: Number(stdout.match(/# fail (\d+)/)?.[1] ?? 0),
    skipped: Number(stdout.match(/# skipped (\d+)/)?.[1] ?? 0),
  };
}

function run(command, args, options = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: options.env ?? process.env,
  });
  return {
    command: `${command} ${args.join(' ')}`,
    ok: result.status === 0,
    status: result.status ?? 1,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? result.error?.message ?? '',
  };
}

function checkFromRun(id, result, detail) {
  return {
    id,
    ok: result.ok,
    command: result.command,
    durationMs: result.durationMs,
    detail,
    error: result.ok ? undefined : result.stderr.trim() || result.stdout.trim(),
  };
}

function npmRun(script, extraArgs, env) {
  return run(npm, ['run', script, ...(extraArgs.length > 0 ? ['--', ...extraArgs] : [])], {
    capture: true,
    env,
  });
}

function waitForRuntimeStore(env) {
  let latest = null;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    latest = npmRun('runtime:stores:verify', [], env);
    if (latest.ok) {
      return { result: latest, attempts: attempt };
    }
    sleep(1000);
  }
  return { result: latest, attempts: 30 };
}

const smokeEnv = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  PLOYKIT_RUNTIME_STORE: 'postgres',
  PLOYKIT_HOST_URL: process.env.PLOYKIT_HOST_URL ?? 'http://localhost:3000',
  PLOYKIT_AUTH_PROVIDER: process.env.PLOYKIT_AUTH_PROVIDER ?? 'host',
};

const checks = [];

if (!skipDocker) {
  const dockerUp = run(docker, ['compose', 'up', '-d', 'postgres'], { capture: true });
  checks.push(
    checkFromRun('postgres-docker-up', dockerUp, {
      service: 'postgres',
      skipped: false,
    })
  );
}

if (skipDocker) {
  checks.push({
    id: 'postgres-docker-up',
    ok: true,
    command: 'skipped by --no-docker',
    durationMs: 0,
    detail: { service: 'postgres', skipped: true },
  });
}

const verify = waitForRuntimeStore(smokeEnv);
const verifyDetail = parseJsonFromOutput(verify.result?.stdout ?? '');
checks.push(
  checkFromRun('runtime-stores-verify', verify.result, {
    attempts: verify.attempts,
    result: verifyDetail,
  })
);

const runtimeStoreTests = npmRun('test:runtime-stores', [], smokeEnv);
checks.push(
  checkFromRun('runtime-stores-tests', runtimeStoreTests, summarizeTap(runtimeStoreTests.stdout))
);

const commercialTests = npmRun('test:commercial-postgres', [], smokeEnv);
checks.push(
  checkFromRun('commercial-postgres-tests', commercialTests, summarizeTap(commercialTests.stdout))
);

const runtimeCheck = npmRun('runtime:check', [], smokeEnv);
checks.push(
  checkFromRun('runtime-check-postgres', runtimeCheck, parseJsonFromOutput(runtimeCheck.stdout))
);

const finalVerify = npmRun('runtime:stores:verify', [], smokeEnv);
checks.push(
  checkFromRun(
    'runtime-stores-final-verify',
    finalVerify,
    parseJsonFromOutput(finalVerify.stdout)
  )
);

const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'runtime-store-postgres',
  checkedAt.replace(/[:.]/g, '-')
);
const latestPath = path.resolve(process.cwd(), '.runtime', 'runtime-store-postgres', 'latest.json');
const reportPath = path.join(outputDir, 'postgres-local-smoke.json');
const report = {
  ok: checks.every((check) => check.ok),
  required: true,
  profile: 'local-postgres',
  checkedAt,
  databaseUrl: redactDatabaseUrl(databaseUrl),
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
