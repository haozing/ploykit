import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const required = process.argv.includes('--required');
const includeBuild = required || process.argv.includes('--include-build');
const baseUrlArgIndex = process.argv.indexOf('--base-url');
const baseUrl =
  baseUrlArgIndex >= 0
    ? process.argv[baseUrlArgIndex + 1]
    : process.env.HOST_SMOKE_BASE_URL;
const normalizedBaseUrl = baseUrl?.replace(/\/$/, '');
const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'rc-evidence',
  checkedAt.replace(/[:.]/g, '-')
);

fs.mkdirSync(outputDir, { recursive: true });

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

checks.push(runStep('typecheck', 'TypeScript typecheck', 'typecheck'));

if (includeBuild) {
  checks.push(runStep('host-build', 'Host production build', 'host:build'));
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
if (normalizedBaseUrl) {
  checks.push(await waitForBaseUrlStep('host-base-url-ready', 'Host base URL readiness', normalizedBaseUrl));
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
  runStep('worker-heartbeat-refresh', 'Worker heartbeat refresh', 'host:worker', [
    '--limit',
    '0',
  ])
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
  runStep('drift-check', 'Unified drift check', 'drift:check', [
    '--reuse-latest',
    ...(required ? ['--required'] : []),
  ])
);
checks.push(
  runStep('backup-restore', 'Backup/restore smoke', 'host:backup-restore-smoke', [
    ...(required ? ['--required'] : []),
  ])
);
checks.push(
  runStep('upgrade-migration', 'Upgrade migration smoke', 'host:upgrade-migration-smoke', [
    ...(required ? ['--required'] : []),
  ])
);
if (normalizedBaseUrl) {
  checks.push(
    runStep('host-product-smoke', 'Host product smoke', 'host:smoke', [
      '--base-url',
      normalizedBaseUrl,
    ])
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
    browserMatrix: latestRuntimeDir('browser-matrix'),
    accessibilitySmoke: latestRuntimeDir('accessibility-smoke'),
    moduleQuality: latestRuntimeDir('module-quality'),
    dataSafety: latestRuntimeDir('data-safety'),
    driftCheck: latestRuntimeDir('drift-check'),
    providerMatrix: latestRuntimeDir('provider-matrix'),
    workerSoak: latestRuntimeDir('worker-soak'),
    billingReconcile: latestRuntimeDir('billing-reconcile'),
    aiRagLocal: latestRuntimeDir('ai-rag-local'),
    backupRestore: latestRuntimeDir('backup-restore'),
    upgradeMigration: latestRuntimeDir('upgrade-migration'),
    chaos: latestRuntimeDir('chaos'),
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
