import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const required = process.argv.includes('--required');
const includeBuild = required || process.argv.includes('--include-build');
const explicitManagedHost =
  process.argv.includes('--start-host') || process.argv.includes('--managed-host');
const disableManagedHost = process.argv.includes('--no-start-host');
const baseUrlArgIndex = process.argv.indexOf('--base-url');
const baseUrl =
  baseUrlArgIndex >= 0 ? process.argv[baseUrlArgIndex + 1] : process.env.HOST_SMOKE_BASE_URL;
const normalizedBaseUrl = baseUrl?.replace(/\/$/, '');
const shouldManageHost =
  Boolean(normalizedBaseUrl) &&
  !disableManagedHost &&
  (explicitManagedHost || required) &&
  isLocalBaseUrl(normalizedBaseUrl);
const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'rc-evidence',
  checkedAt.replace(/[:.]/g, '-')
);
let managedHost;

fs.mkdirSync(outputDir, { recursive: true });

function isLocalBaseUrl(value) {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function npmArgs(script, args = []) {
  return ['run', script, ...(args.length > 0 ? ['--', ...args] : [])];
}

function displayCommand(script, args = []) {
  return `npm run ${script}${args.length > 0 ? ` -- ${args.join(' ')}` : ''}`;
}

function safeId(id) {
  return id.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
}

function parseJsonFromStdout(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

function summarizeDetail(detail) {
  if (!detail || typeof detail !== 'object') {
    return undefined;
  }
  const summary = {};
  if ('ok' in detail) {
    summary.ok = detail.ok;
  }
  if ('required' in detail) {
    summary.required = detail.required;
  }
  if ('skipped' in detail) {
    summary.skipped = detail.skipped;
  }
  if (typeof detail.outputDir === 'string') {
    summary.outputDir = detail.outputDir;
  }
  if (Array.isArray(detail.checks)) {
    summary.checks = detail.checks.length;
    summary.failedChecks = detail.checks
      .filter((check) => check && check.ok === false)
      .map((check) => check.id)
      .slice(0, 8);
  }
  if (Array.isArray(detail.diagnostics)) {
    summary.diagnostics = detail.diagnostics.length;
  }
  if (detail.metrics && typeof detail.metrics === 'object') {
    summary.metrics = detail.metrics;
  }
  if (detail.drain && typeof detail.drain === 'object') {
    summary.drain = detail.drain;
  }
  if (detail.mode) {
    summary.mode = detail.mode;
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

async function waitForBaseUrl(url, timeoutMs = 120_000) {
  if (!url) {
    return;
  }
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status > 0 && response.status < 500) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Host base URL did not become ready at ${url}. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

async function waitForBaseUrlStep(id, title, url) {
  const startedAt = Date.now();
  try {
    await waitForBaseUrl(url);
    return {
      id,
      title,
      status: 'passed',
      ok: true,
      command: `wait for ${url}`,
      durationMs: Date.now() - startedAt,
      summary: { baseUrl: url },
    };
  } catch (error) {
    return {
      id,
      title,
      status: 'failed',
      ok: false,
      command: `wait for ${url}`,
      durationMs: Date.now() - startedAt,
      summary: { baseUrl: url },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function runStep(id, title, script, args = []) {
  const startedAt = Date.now();
  const commandArgs = npmArgs(script, args);
  const env = { ...process.env };
  if (normalizedBaseUrl) {
    env.HOST_SMOKE_BASE_URL = normalizedBaseUrl;
    env.PLOYKIT_HOST_URL = normalizedBaseUrl;
  }
  const result = spawnSync(npm, commandArgs, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  const stdoutLog = path.join(outputDir, `${safeId(id)}.stdout.log`);
  const stderrLog = path.join(outputDir, `${safeId(id)}.stderr.log`);
  fs.writeFileSync(stdoutLog, stdout);
  fs.writeFileSync(stderrLog, stderr);

  const detail = parseJsonFromStdout(stdout);
  const ok = result.status === 0;
  return {
    id,
    title,
    status: ok ? 'passed' : 'failed',
    ok,
    command: displayCommand(script, args),
    durationMs: Date.now() - startedAt,
    summary: summarizeDetail(detail),
    detail,
    stdoutLog,
    stderrLog,
    error: result.error?.message ?? (stderr.trim() || undefined),
  };
}

function skippedStep(id, title, reason, ok = true) {
  return {
    id,
    title,
    status: ok ? 'skipped' : 'blocked',
    ok,
    command: null,
    durationMs: 0,
    summary: { reason },
  };
}

async function probeBaseUrl(url) {
  try {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(2000),
    });
    return {
      ready: response.status > 0 && response.status < 500,
      responding: true,
      status: response.status,
    };
  } catch (error) {
    return {
      ready: false,
      responding: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function managedHostPreflightStep() {
  if (!shouldManageHost || !normalizedBaseUrl) {
    return undefined;
  }
  const startedAt = Date.now();
  const probe = await probeBaseUrl(normalizedBaseUrl);
  if (!probe.responding) {
    return {
      id: 'managed-host-preflight',
      title: 'Managed host preflight',
      status: 'passed',
      ok: true,
      command: `probe ${normalizedBaseUrl}`,
      durationMs: Date.now() - startedAt,
      summary: {
        baseUrl: normalizedBaseUrl,
        ready: false,
      },
    };
  }
  return {
    id: 'managed-host-preflight',
    title: 'Managed host preflight',
    status: 'failed',
    ok: false,
    command: `probe ${normalizedBaseUrl}`,
    durationMs: Date.now() - startedAt,
    summary: {
      baseUrl: normalizedBaseUrl,
      status: probe.status,
    },
    error:
      'Local base URL already responds before production build. Stop the existing local host, or pass --no-start-host when intentionally testing an externally managed server.',
  };
}

async function startManagedHostStep() {
  if (!shouldManageHost || !normalizedBaseUrl) {
    return undefined;
  }
  const startedAt = Date.now();
  const stdoutLog = path.join(outputDir, 'managed-host.stdout.log');
  const stderrLog = path.join(outputDir, 'managed-host.stderr.log');
  try {
    const hostUrl = new URL(normalizedBaseUrl);
    const stdoutFd = fs.openSync(stdoutLog, 'a');
    const stderrFd = fs.openSync(stderrLog, 'a');
    const env = {
      ...process.env,
      HOST_SMOKE_BASE_URL: normalizedBaseUrl,
      PLOYKIT_HOST_URL: normalizedBaseUrl,
      PORT: hostUrl.port || (hostUrl.protocol === 'https:' ? '443' : '3000'),
    };
    managedHost = {
      stdoutFd,
      stderrFd,
      child: spawn(npm, ['run', 'host:start'], {
        cwd: process.cwd(),
        env,
        shell: process.platform === 'win32',
        stdio: ['ignore', stdoutFd, stderrFd],
      }),
    };
    await waitForBaseUrl(normalizedBaseUrl);
    return {
      id: 'managed-host-start',
      title: 'Managed production host start',
      status: 'passed',
      ok: true,
      command: 'npm run host:start',
      durationMs: Date.now() - startedAt,
      summary: {
        baseUrl: normalizedBaseUrl,
        pid: managedHost.child.pid,
        stdoutLog,
        stderrLog,
      },
      stdoutLog,
      stderrLog,
    };
  } catch (error) {
    return {
      id: 'managed-host-start',
      title: 'Managed production host start',
      status: 'failed',
      ok: false,
      command: 'npm run host:start',
      durationMs: Date.now() - startedAt,
      summary: {
        baseUrl: normalizedBaseUrl,
      },
      stdoutLog,
      stderrLog,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function stopManagedHostStep() {
  if (!managedHost?.child) {
    return undefined;
  }
  const startedAt = Date.now();
  const pid = managedHost.child.pid;
  let ok = true;
  let error;
  try {
    if (process.platform === 'win32' && pid) {
      const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      ok = result.status === 0 || /not found/i.test(`${result.stdout}\n${result.stderr}`);
      error = ok ? undefined : result.stderr.trim() || result.stdout.trim();
    } else {
      managedHost.child.kill('SIGTERM');
    }
  } catch (stopError) {
    ok = false;
    error = stopError instanceof Error ? stopError.message : String(stopError);
  } finally {
    try {
      fs.closeSync(managedHost.stdoutFd);
    } catch {}
    try {
      fs.closeSync(managedHost.stderrFd);
    } catch {}
    managedHost = undefined;
  }
  return {
    id: 'managed-host-stop',
    title: 'Managed production host stop',
    status: ok ? 'passed' : 'failed',
    ok,
    command: pid ? `stop pid ${pid}` : 'stop managed host',
    durationMs: Date.now() - startedAt,
    summary: { pid },
    error,
  };
}

function advisoryStep(step, reason) {
  if (step.ok) {
    return step;
  }
  return {
    ...step,
    status: 'advisory',
    ok: true,
    advisory: true,
    originalOk: false,
    summary: {
      ...(step.summary ?? {}),
      advisoryReason: reason,
    },
  };
}

function latestRuntimeDir(name) {
  const parent = path.resolve(process.cwd(), '.runtime', name);
  if (!fs.existsSync(parent)) {
    return undefined;
  }
  const entries = fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      fullPath: path.join(parent, entry.name),
      mtimeMs: fs.statSync(path.join(parent, entry.name)).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return entries[0]?.fullPath;
}

function latestRuntimeArtifact(name) {
  const latestDir = latestRuntimeDir(name);
  if (latestDir) {
    return latestDir;
  }
  const latestPath = path.resolve(process.cwd(), '.runtime', name, 'latest.json');
  return fs.existsSync(latestPath) ? latestPath : undefined;
}

function markdownCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>');
}

function markdownSummary(step) {
  if (!step.summary) {
    return '';
  }
  return Object.entries(step.summary)
    .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join('; ');
}

function writeMarkdown(report, filePath) {
  const lines = [
    '# PloyKit RC Evidence',
    '',
    `- checkedAt: ${report.checkedAt}`,
    `- required: ${report.required}`,
    `- ok: ${report.ok}`,
    `- baseUrl: ${report.baseUrl ?? 'not provided'}`,
    `- outputDir: ${report.outputDir}`,
    '',
    '## Checks',
    '',
    '| Step | Status | Command | Duration | Summary |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const step of report.checks) {
    lines.push(
      `| ${markdownCell(step.title)} | ${markdownCell(step.status)} | ${markdownCell(
        step.command ?? '-'
      )} | ${Math.round(step.durationMs / 1000)}s | ${markdownCell(markdownSummary(step))} |`
    );
  }

  lines.push('', '## Artifacts', '');
  for (const [name, artifactPath] of Object.entries(report.artifacts)) {
    lines.push(`- ${name}: ${artifactPath ?? 'not found'}`);
  }

  lines.push('', '## Blockers', '');
  if (report.blockers.length === 0) {
    lines.push('No blockers recorded by this evidence run.');
  } else {
    for (const blocker of report.blockers) {
      lines.push(`- ${blocker.id}: ${blocker.reason}`);
    }
  }

  lines.push('');
  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

const checks = [];
let managedHostPreflightOk = true;

checks.push(runStep('typecheck', 'TypeScript typecheck', 'typecheck'));

const preflight = await managedHostPreflightStep();
if (preflight) {
  checks.push(preflight);
  managedHostPreflightOk = preflight.ok;
}

if (includeBuild && managedHostPreflightOk) {
  checks.push(runStep('host-build', 'Host production build', 'host:build'));
} else if (includeBuild) {
  checks.push(
    skippedStep(
      'host-build',
      'Host production build',
      'Skipped because the managed local host preflight failed; stop the existing local server before building.',
      false
    )
  );
} else {
  checks.push(
    skippedStep(
      'host-build',
      'Host production build',
      'Use --include-build when this evidence run should include a Next production build.'
    )
  );
}

checks.push(
  runStep(
    'runtime-store-postgres',
    'Runtime store Postgres evidence',
    'host:postgres-local-smoke',
    [...(required ? ['--no-docker'] : [])]
  )
);
checks.push(runStep('data-v2-migrate', 'Data v2 migration', 'data:migrate'));
checks.push(runStep('presentation-check', 'Product presentation check', 'presentation:check'));
checks.push(runStep('white-label-smoke', 'White-label presentation smoke', 'white-label:smoke'));

checks.push(
  runStep('provider-matrix', 'Provider matrix', 'host:provider-matrix', [
    ...(required ? ['--required'] : []),
  ])
);
checks.push(
  runStep('worker-soak', 'Worker soak smoke', 'host:worker-soak', [
    '--jobs',
    '3',
    '--limit',
    '3',
    '--concurrency',
    '2',
    ...(required ? ['--required'] : []),
  ])
);
checks.push(
  runStep('chaos-smoke', 'Queue chaos smoke', 'host:chaos-smoke', [
    ...(required ? ['--required'] : []),
  ])
);

const managedHostStart = managedHostPreflightOk
  ? await startManagedHostStep()
  : skippedStep(
      'managed-host-start',
      'Managed production host start',
      'Skipped because the managed local host preflight failed.',
      false
    );
if (managedHostStart) {
  checks.push(managedHostStart);
}

if (normalizedBaseUrl && (!shouldManageHost || managedHostStart?.ok)) {
  checks.push(
    await waitForBaseUrlStep('host-base-url-ready', 'Host base URL readiness', normalizedBaseUrl)
  );
} else if (normalizedBaseUrl) {
  checks.push(
    skippedStep(
      'host-base-url-ready',
      'Host base URL readiness',
      'Skipped because the managed production host did not start.',
      false
    )
  );
}
checks.push(
  runStep('web-shell-evidence', 'Web Shell evidence', 'host:web-shell-evidence', [
    ...(required ? ['--required'] : []),
  ])
);
checks.push(
  runStep('module-quality', 'Module-declared quality evidence', 'module:quality', [
    ...(required ? ['--required'] : []),
  ])
);
checks.push(
  runStep('worker-heartbeat-refresh', 'Worker heartbeat refresh', 'host:worker', ['--limit', '0'])
);
checks.push(
  runStep('host-config-doctor', 'Host config doctor', 'host:config-doctor', [
    ...(required ? ['--required'] : []),
  ])
);
checks.push(
  runStep('host-data-safety', 'Host data safety', 'host:data-safety', [
    ...(required ? ['--required'] : []),
  ])
);
checks.push(
  required
    ? runStep('drift-check', 'Unified drift check', 'drift:check', ['--reuse-latest', '--required'])
    : advisoryStep(
        runStep('drift-check', 'Unified drift check', 'drift:check', ['--reuse-latest']),
        'Non-required evidence records drift findings without blocking local RC evidence. Use --required for blocking production evidence.'
      )
);
checks.push(
  runStep('backup-restore', 'Backup/restore smoke', 'host:backup-restore-smoke', [
    ...(required ? ['--required'] : []),
  ])
);
checks.push(
  runStep(
    'postgres-physical-restore',
    'Postgres physical restore smoke',
    'host:postgres-physical-restore-smoke',
    [...(required ? ['--required'] : [])]
  )
);
checks.push(
  runStep('upgrade-migration', 'Upgrade migration smoke', 'host:upgrade-migration-smoke', [
    ...(required ? ['--required'] : []),
  ])
);
if (normalizedBaseUrl && (!shouldManageHost || managedHostStart?.ok)) {
  checks.push(
    runStep('host-product-smoke', 'Host product smoke', 'host:smoke', [
      '--base-url',
      normalizedBaseUrl,
    ])
  );
  checks.push(
    runStep(
      'dashboard-transition-smoke',
      'Dashboard transition smoke',
      'host:dashboard-transition-smoke',
      [
        ...(required ? ['--required'] : []),
        '--base-url',
        normalizedBaseUrl,
        '--repeat',
        '3',
        '--inject-anchor',
        '--max-p95-ms',
        '5000',
      ]
    )
  );
  checks.push(
    runStep('browser-matrix', 'Browser matrix', 'host:browser-matrix', [
      ...(required ? ['--required'] : []),
      '--base-url',
      normalizedBaseUrl,
    ])
  );
  checks.push(
    runStep('accessibility-smoke', 'Accessibility smoke', 'host:accessibility-smoke', [
      ...(required ? ['--required'] : []),
      '--base-url',
      normalizedBaseUrl,
    ])
  );
} else if (normalizedBaseUrl) {
  checks.push(
    skippedStep(
      'host-product-smoke',
      'Host product smoke',
      'Skipped because the managed production host did not start.',
      false
    )
  );
  checks.push(
    skippedStep(
      'browser-matrix',
      'Browser matrix',
      'Skipped because the managed production host did not start.',
      false
    )
  );
  checks.push(
    skippedStep(
      'dashboard-transition-smoke',
      'Dashboard transition smoke',
      'Skipped because the managed production host did not start.',
      false
    )
  );
  checks.push(
    skippedStep(
      'accessibility-smoke',
      'Accessibility smoke',
      'Skipped because the managed production host did not start.',
      false
    )
  );
} else {
  checks.push(
    skippedStep(
      'host-product-smoke',
      'Host product smoke',
      required
        ? 'Required evidence needs --base-url or HOST_SMOKE_BASE_URL.'
        : 'Skipped because --base-url/HOST_SMOKE_BASE_URL was not provided.',
      !required
    )
  );
  checks.push(
    skippedStep(
      'browser-matrix',
      'Browser matrix',
      required
        ? 'Required evidence needs --base-url or HOST_SMOKE_BASE_URL.'
        : 'Skipped because --base-url/HOST_SMOKE_BASE_URL was not provided.',
      !required
    )
  );
  checks.push(
    skippedStep(
      'dashboard-transition-smoke',
      'Dashboard transition smoke',
      required
        ? 'Required evidence needs --base-url or HOST_SMOKE_BASE_URL.'
        : 'Skipped because --base-url/HOST_SMOKE_BASE_URL was not provided.',
      !required
    )
  );
  checks.push(
    skippedStep(
      'accessibility-smoke',
      'Accessibility smoke',
      required
        ? 'Required evidence needs --base-url or HOST_SMOKE_BASE_URL.'
        : 'Skipped because --base-url/HOST_SMOKE_BASE_URL was not provided.',
      !required
    )
  );
}

checks.push(
  runStep(
    'release-rc-gate',
    'Release candidate gate',
    required ? 'release:maintainer-gate' : 'release:integration-gate'
  )
);

const managedHostStop = stopManagedHostStep();
if (managedHostStop) {
  checks.push(managedHostStop);
}

const blockers = checks
  .filter((check) => !check.ok)
  .map((check) => ({
    id: check.id,
    reason: check.error ?? check.summary?.reason ?? `${check.title} did not pass.`,
  }));

const report = {
  ok: checks.every((check) => check.ok),
  required,
  checkedAt,
  baseUrl: normalizedBaseUrl,
  outputDir,
  checks,
  blockers,
  artifacts: {
    webShell: latestRuntimeDir('web-shell'),
    hostProductSmoke: latestRuntimeDir('host-smoke'),
    dashboardTransitionSmoke: latestRuntimeDir('dashboard-transition-smoke'),
    browserMatrix: latestRuntimeDir('browser-matrix'),
    accessibilitySmoke: latestRuntimeDir('accessibility-smoke'),
    moduleQuality: latestRuntimeDir('module-quality'),
    dataSafety: latestRuntimeDir('data-safety'),
    driftCheck: latestRuntimeDir('drift-check'),
    runtimeStorePostgres: latestRuntimeDir('runtime-store-postgres'),
    providerMatrix: latestRuntimeDir('provider-matrix'),
    workerSoak: latestRuntimeDir('worker-soak'),
    billingReconcile: latestRuntimeDir('billing-reconcile'),
    aiRagLocal: latestRuntimeDir('ai-rag-local'),
    aiRagPolicy: latestRuntimeDir('ai-rag-policy'),
    backupRestore: latestRuntimeDir('backup-restore'),
    postgresPhysicalRestore: latestRuntimeDir('postgres-physical-restore'),
    upgradeMigration: latestRuntimeDir('upgrade-migration'),
    chaos: latestRuntimeDir('chaos'),
    productPresentation: fs.existsSync(
      path.resolve(process.cwd(), '.ploykit', 'generated', 'product-presentation.manifest.json')
    )
      ? path.resolve(process.cwd(), '.ploykit', 'generated', 'product-presentation.manifest.json')
      : undefined,
    whiteLabelSmoke: latestRuntimeArtifact('white-label-smoke'),
    rcEvidence: outputDir,
  },
};

const jsonPath = path.join(outputDir, 'evidence.json');
const markdownPath = path.join(outputDir, 'evidence.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
writeMarkdown(report, markdownPath);

const latestJsonPath = path.resolve(process.cwd(), '.runtime', 'rc-evidence', 'latest.json');
const latestMarkdownPath = path.resolve(process.cwd(), '.runtime', 'rc-evidence', 'latest.md');
fs.copyFileSync(jsonPath, latestJsonPath);
fs.copyFileSync(markdownPath, latestMarkdownPath);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
