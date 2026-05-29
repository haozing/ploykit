import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const required = process.argv.includes('--required');
const reuseLatest = process.argv.includes('--reuse-latest');
const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'drift-check',
  checkedAt.replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'drift-check.json');
const latestPath = path.resolve(process.cwd(), '.runtime', 'drift-check', 'latest.json');

function safeId(value) {
  return String(value).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
}

function parseJson(stdout) {
  const trimmed = String(stdout ?? '').trim();
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

function run(script, args = [], env = process.env) {
  const startedAt = Date.now();
  const result = spawnSync(npm, ['run', script, ...(args.length > 0 ? ['--', ...args] : [])], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  return {
    command: `npm run ${script}${args.length > 0 ? ` -- ${args.join(' ')}` : ''}`,
    ok: result.status === 0,
    status: result.status ?? 1,
    durationMs: Date.now() - startedAt,
    stdout,
    stderr,
    detail: parseJson(stdout),
    error: result.error?.message ?? (stderr.trim() || undefined),
  };
}

function readLatest(runtimeDir) {
  const reportPath = path.resolve(process.cwd(), '.runtime', runtimeDir, 'latest.json');
  if (!fs.existsSync(reportPath)) {
    return undefined;
  }
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    return undefined;
  }
}

function summarize(detail) {
  if (!detail || typeof detail !== 'object') {
    return undefined;
  }
  const summary = {};
  if (detail.mode) {
    summary.mode = detail.mode;
  }
  if (typeof detail.ok === 'boolean') {
    summary.ok = detail.ok;
  }
  if (typeof detail.success === 'boolean') {
    summary.success = detail.success;
  }
  if (Array.isArray(detail.diagnostics)) {
    summary.diagnostics = detail.diagnostics.length;
  }
  if (Array.isArray(detail.checks)) {
    summary.checks = detail.checks.length;
    summary.failedChecks = detail.checks
      .filter((check) => check && check.ok === false)
      .map((check) => check.id)
      .slice(0, 8);
    summary.warningChecks = detail.checks
      .filter((check) => check && check.severity === 'warning')
      .map((check) => check.id)
      .slice(0, 8);
  }
  if (detail.metrics && typeof detail.metrics === 'object') {
    summary.metrics = detail.metrics;
  }
  if (detail.status && typeof detail.status === 'object') {
    summary.status = detail.status;
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function isDiagnostic(item) {
  return item && typeof item === 'object' && typeof item.message === 'string';
}

function normalizeDiagnostic(step, diagnostic, index) {
  const code = typeof diagnostic.code === 'string' ? diagnostic.code : `${step.id}:${index}`;
  const severity = diagnostic.severity === 'warning' ? 'warning' : 'error';
  return {
    id: `${safeId(step.id)}:${safeId(code)}`,
    source: step.id,
    title: step.title,
    domain: step.domain,
    severity,
    blocking: severity === 'error',
    code,
    path: typeof diagnostic.path === 'string' ? diagnostic.path : step.path ?? step.id,
    message: diagnostic.message,
    expected: diagnostic.expected,
    actual: diagnostic.actual,
    fix: diagnostic.fix,
  };
}

function normalizeChecks(step, detail) {
  if (!detail || !Array.isArray(detail.checks)) {
    return [];
  }
  return detail.checks.flatMap((check, index) => {
    if (!check || typeof check !== 'object') {
      return [];
    }
    const severity = check.ok === false ? 'error' : check.severity === 'warning' ? 'warning' : 'warning';
    const ok = check.ok === true;
    const shouldReport = !ok || severity === 'warning';
    if (!shouldReport) {
      return [];
    }
    const id = typeof check.id === 'string' ? check.id : `${step.id}:${index}`;
    return [
      {
        id: `${safeId(step.id)}:${safeId(id)}`,
        source: step.id,
        title: step.title,
        domain: step.domain,
        severity,
        blocking: severity === 'error' && ok === false,
        code: id,
        path: typeof check.path === 'string' ? check.path : step.path ?? step.id,
        message:
          typeof check.error === 'string'
            ? check.error
            : typeof check.detail === 'string'
              ? check.detail
              : ok
                ? `${id} passed`
                : `${id} failed`,
        expected: check.expected,
        actual: check.actual ?? check.detail,
        fix: check.fix,
      },
    ];
  });
}

function normalizeStepFindings(step) {
  const detail = step.detail;
  const diagnostics = Array.isArray(detail?.diagnostics)
    ? detail.diagnostics.filter(isDiagnostic).map((diagnostic, index) => normalizeDiagnostic(step, diagnostic, index))
    : [];
  const checks = normalizeChecks(step, detail);
  const findings = [...diagnostics, ...checks];
  if (step.ok === false && !findings.some((finding) => finding.blocking)) {
    return [
      ...findings,
      {
        id: `${safeId(step.id)}:command-failed`,
        source: step.id,
        title: step.title,
        domain: step.domain,
        severity: 'error',
        blocking: true,
        code: 'DRIFT_CHECK_COMMAND_FAILED',
        path: step.path ?? step.id,
        message: step.error || `${step.title} failed.`,
        fix: `Run ${step.command} and inspect the stderr/stdout logs.`,
      },
    ];
  }
  return findings;
}

function summarizeFindings(findings) {
  const summary = {
    total: findings.length,
    blocking: findings.filter((finding) => finding.blocking).length,
    errors: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    domains: [...new Set(findings.map((finding) => finding.domain))].sort(),
  };
  return summary;
}

function writeMarkdown(report, filePath) {
  function markdownCell(value) {
    return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  }

  const lines = [
    '# PloyKit Drift Check',
    '',
    `- checkedAt: ${report.checkedAt}`,
    `- required: ${report.required}`,
    `- ok: ${report.ok}`,
    `- warningsAreBlocking: ${report.policy.warningBlocks}`,
    `- outputDir: ${report.outputDir}`,
    '',
    '## Steps',
    '',
    '| Step | Status | Command | Summary |',
    '| --- | --- | --- | --- |',
  ];

  for (const step of report.steps) {
    const summary = step.summary ? Object.entries(step.summary)
      .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
      .join('; ') : '';
    lines.push(
      `| ${markdownCell(step.title)} | ${step.ok ? 'passed' : 'failed'} | ${markdownCell(step.command)} | ${markdownCell(summary)} |`
    );
  }

  lines.push('', '## Findings', '', '| Domain | Severity | Path | Message | Fix |', '| --- | --- | --- | --- | --- |');
  for (const finding of report.findings) {
    lines.push(
      `| ${markdownCell(finding.domain)} | ${finding.severity} | ${markdownCell(finding.path)} | ${markdownCell(finding.message)} | ${markdownCell(finding.fix ?? '')} |`
    );
  }

  lines.push('', '## Artifacts', '');
  for (const [name, artifact] of Object.entries(report.artifacts)) {
    lines.push(`- ${name}: ${artifact ?? 'not found'}`);
  }

  fs.writeFileSync(filePath, `${lines.join('\n')}\n`);
}

const steps = [
  {
    id: 'module-map',
    title: 'Module map and doctor',
    domain: 'module-map',
    command: 'modules:check',
    args: [],
    required: true,
  },
  {
    id: 'catalog',
    title: 'Catalog doctor',
    domain: 'catalog',
    command: 'catalog:doctor',
    args: [],
    required: true,
  },
  {
    id: 'runtime-check',
    title: 'Runtime checks',
    domain: 'runtime',
    command: 'runtime:check',
    args: [],
    required: true,
  },
  {
    id: 'runtime-stores',
    title: 'Runtime store schema verify',
    domain: 'runtime-store',
    command: 'runtime:stores:verify',
    args: ['--no-apply'],
    required: true,
  },
  {
    id: 'data-v2',
    title: 'Data v2 database verify',
    domain: 'data-v2',
    command: 'data:verify-db',
    args: [],
    required: true,
  },
  {
    id: 'data-safety',
    title: 'Data safety matrix',
    domain: 'security',
    command: 'host:data-safety',
    args: [...(required ? ['--required'] : [])],
    required: true,
    latestDir: 'data-safety',
  },
  {
    id: 'provider-matrix',
    title: 'Provider matrix',
    domain: 'providers',
    command: 'host:provider-matrix',
    args: [...(required ? ['--required'] : [])],
    required: true,
    latestDir: 'provider-matrix',
  },
];

const env = {
  ...process.env,
};

fs.mkdirSync(outputDir, { recursive: true });

const results = steps.map((step) => {
  const latest = reuseLatest && step.latestDir ? readLatest(step.latestDir) : undefined;
  if (latest) {
    const latestOk = latest.ok !== false && (!required || latest.required === true);
    return {
      ...step,
      run: {
        command: `latest ${step.latestDir}`,
        ok: latestOk,
        status: latestOk ? 0 : 1,
        durationMs: 0,
        stdout: '',
        stderr: '',
        detail: latest,
        error:
          latest.ok === false
            ? `${step.latestDir} latest evidence is not passing.`
            : required && latest.required !== true
              ? `${step.latestDir} latest evidence was not generated with --required.`
              : undefined,
      },
    };
  }
  const executed = run(step.command, step.args, env);
  return {
    ...step,
    run: executed,
  };
});

const findings = results.flatMap((step) => normalizeStepFindings({
  ...step,
  ok: step.run.ok,
  command: step.run.command,
  detail: step.run.detail,
  error: step.run.error,
  path: step.id,
}));

const stepSummaries = results.map((step) => ({
  id: step.id,
  title: step.title,
  domain: step.domain,
  command: step.run.command,
  ok: step.run.ok,
  severity: step.run.ok ? 'pass' : 'error',
  durationMs: step.run.durationMs,
  summary: summarize(step.run.detail),
  error: step.run.ok ? undefined : step.run.error,
  stdoutLog: path.join(outputDir, `${safeId(step.id)}.stdout.log`),
  stderrLog: path.join(outputDir, `${safeId(step.id)}.stderr.log`),
}));

for (const step of results) {
  fs.writeFileSync(path.join(outputDir, `${safeId(step.id)}.stdout.log`), step.run.stdout);
  fs.writeFileSync(path.join(outputDir, `${safeId(step.id)}.stderr.log`), step.run.stderr);
}

const report = {
  ok: findings.every((finding) => finding.blocking !== true),
  required,
  checkedAt,
  mode: 'unified-drift-check',
  policy: {
    warningBlocks: false,
    errorBlocks: true,
  },
  steps: stepSummaries,
  findings,
  summary: summarizeFindings(findings),
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);
writeMarkdown(report, path.join(outputDir, 'drift-check.md'));

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
