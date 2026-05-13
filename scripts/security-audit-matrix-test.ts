/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSecurityHeaders } from '../src/lib/security/security-headers';

type Status = 'passed' | 'failed' | 'skipped';

interface StepResult {
  name: string;
  status: Status;
  command?: string;
  durationMs?: number;
  exitCode?: number | null;
  detail?: string;
  issues?: string[];
  error?: string;
}

interface SecurityAuditSummary {
  status: Status;
  startedAt: string;
  finishedAt?: string;
  steps: StepResult[];
  coverage: {
    secretScan: boolean;
    dependencyAudit: boolean;
    securityHeaders: boolean;
    apiCatalog: boolean;
    traversalAndEgressTests: boolean;
  };
  issues: string[];
  error?: string;
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'security-audit-matrix');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', '安全审计矩阵测试报告.md');

const SECRET_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'github-token', pattern: /\bghp_[A-Za-z0-9_]{36,}\b/g },
  { id: 'openai-api-key', pattern: /\bsk-[A-Za-z0-9]{32,}\b/g },
  { id: 'stripe-live-key', pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/g },
  { id: 'private-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
];

const SECRET_SCAN_EXCLUDE = [
  /^\.git\//,
  /^node_modules\//,
  /^\.next\//,
  /^test-results\//,
  /^coverage\//,
  /^\.data\//,
  /^package-lock\.json$/,
];

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function commandFor(name: string, args: string[]) {
  if (name === 'npx' && args[0] === 'vitest') {
    return {
      file: process.execPath,
      args: [resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs'), ...args.slice(1)],
      display: [name, ...args].join(' '),
    };
  }

  if (name === 'npm' && process.env.npm_execpath) {
    return {
      file: process.execPath,
      args: [process.env.npm_execpath, ...args],
      display: [name, ...args].join(' '),
    };
  }

  return {
    file: process.platform === 'win32' && (name === 'npm' || name === 'npx') ? `${name}.cmd` : name,
    args,
    display: [name, ...args].join(' '),
  };
}

async function runCommand(name: string, args: string[]): Promise<CommandResult> {
  const command = commandFor(name, args);
  console.log(`Running ${command.display}`);
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(command.file, command.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', reject);
    child.on('exit', (code) => {
      resolvePromise({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      });
    });
  });
}

async function runCommandStep(
  summary: SecurityAuditSummary,
  name: string,
  commandName: string,
  args: string[],
  options: { allowFailure?: boolean; parseIssues?: (result: CommandResult) => string[] } = {}
): Promise<CommandResult> {
  const started = Date.now();
  const command = commandFor(commandName, args);
  const step: StepResult = {
    name,
    status: 'failed',
    command: command.display,
  };
  summary.steps.push(step);

  const result = await runCommand(commandName, args);
  step.durationMs = Date.now() - started;
  step.exitCode = result.code;
  step.issues = options.parseIssues?.(result) ?? [];

  if (result.code === 0 || options.allowFailure) {
    step.status = step.issues.length === 0 ? 'passed' : 'failed';
  } else {
    step.status = 'failed';
    step.error = result.stderr || result.stdout;
  }

  if (step.status !== 'passed') {
    summary.issues.push(`${name}: ${step.error || step.issues?.join('; ') || 'failed'}`);
  }

  return result;
}

async function runFunctionStep(
  summary: SecurityAuditSummary,
  name: string,
  fn: () => Promise<string[]>
): Promise<void> {
  const started = Date.now();
  const step: StepResult = { name, status: 'failed' };
  summary.steps.push(step);

  try {
    const issues = await fn();
    step.durationMs = Date.now() - started;
    step.issues = issues;
    step.status = issues.length === 0 ? 'passed' : 'failed';
    if (issues.length > 0) {
      summary.issues.push(`${name}: ${issues.join('; ')}`);
    }
  } catch (error) {
    step.durationMs = Date.now() - started;
    step.error = error instanceof Error ? error.stack || error.message : String(error);
    summary.issues.push(`${name}: ${step.error}`);
    throw error;
  }
}

function resetResultDir(): void {
  const expected = resolve(process.cwd(), 'test-results', 'security-audit-matrix');
  if (RESULT_DIR !== expected) {
    throw new Error(`Refusing to clear unexpected result directory: ${RESULT_DIR}`);
  }
  rmSync(RESULT_DIR, { recursive: true, force: true });
  mkdirSync(RESULT_DIR, { recursive: true });
}

function parseGitFiles(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizePath)
    .filter((file) => !SECRET_SCAN_EXCLUDE.some((pattern) => pattern.test(file)));
}

async function scanSecrets(): Promise<string[]> {
  const result = await runCommand('git', ['ls-files']);
  if (result.code !== 0) {
    return [`git ls-files failed: ${result.stderr || result.stdout}`];
  }

  const issues: string[] = [];
  for (const file of parseGitFiles(result.stdout)) {
    let content: string;
    try {
      content = readFileSync(resolve(process.cwd(), file), 'utf8');
    } catch {
      continue;
    }

    for (const { id, pattern } of SECRET_PATTERNS) {
      pattern.lastIndex = 0;
      const matches = content.match(pattern);
      if (matches?.length) {
        issues.push(`${file}: ${id} (${matches.length})`);
      }
    }
  }
  return issues;
}

function checkSecurityHeaders(): string[] {
  const headers = getSecurityHeaders({ nodeEnv: 'production' });
  const csp = headers['Content-Security-Policy'] ?? '';
  const issues: string[] = [];

  if (headers['X-Content-Type-Options'] !== 'nosniff') {
    issues.push('Missing X-Content-Type-Options=nosniff');
  }
  if (headers['Referrer-Policy'] !== 'strict-origin-when-cross-origin') {
    issues.push('Missing strict Referrer-Policy');
  }
  if (headers['X-Frame-Options'] !== 'DENY') {
    issues.push('Missing X-Frame-Options=DENY');
  }
  if (!headers['Strict-Transport-Security']?.includes('max-age=31536000')) {
    issues.push('Missing production HSTS');
  }
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]) {
    if (!csp.includes(directive)) {
      issues.push(`CSP missing ${directive}`);
    }
  }
  if (!headers['Permissions-Policy']?.includes('camera=()')) {
    issues.push('Missing restrictive Permissions-Policy');
  }

  return issues;
}

function parseNpmAuditIssues(result: CommandResult): string[] {
  let payload: unknown;
  try {
    payload = JSON.parse(result.stdout) as unknown;
  } catch {
    return result.code === 0 ? [] : ['npm audit did not return parseable JSON'];
  }

  const metadata = (payload as { metadata?: { vulnerabilities?: Record<string, number> } })
    .metadata;
  const vulnerabilities = metadata?.vulnerabilities ?? {};
  const high = Number(vulnerabilities.high ?? 0);
  const critical = Number(vulnerabilities.critical ?? 0);
  const issues: string[] = [];
  if (critical > 0) issues.push(`${critical} critical production vulnerabilit(y/ies)`);
  if (high > 0) issues.push(`${high} high production vulnerabilit(y/ies)`);
  return issues;
}

function writeSummary(summary: SecurityAuditSummary): void {
  summary.finishedAt = new Date().toISOString();
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function writeReport(summary: SecurityAuditSummary): void {
  const rows = summary.steps
    .map(
      (step) =>
        `| ${step.name} | ${step.status} | ${step.durationMs ?? '-'} | ${step.command ?? '-'} | ${(step.issues ?? []).join('<br>') || step.error || '-'} |`
    )
    .join('\n');

  writeFileSync(
    REPORT_PATH,
    `# 安全审计矩阵测试报告

更新时间：${new Date().toISOString()}

## 结论

- 状态：${summary.status}
- 覆盖：secret 扫描、生产依赖 audit、CSP/security headers、API 安全目录、路径穿越与 SSRF/egress 测试

## 步骤

| 步骤 | 状态 | 耗时 ms | 命令 | 问题 |
| ---- | ---- | ------- | ---- | ---- |
${rows}

## 问题

${summary.issues.map((issue) => `- ${issue}`).join('\n') || '- 无'}

## 结果文件

- \`test-results/security-audit-matrix/summary.json\`
`,
    'utf8'
  );
}

async function main(): Promise<void> {
  const summary: SecurityAuditSummary = {
    status: 'failed',
    startedAt: new Date().toISOString(),
    steps: [],
    coverage: {
      secretScan: false,
      dependencyAudit: false,
      securityHeaders: false,
      apiCatalog: false,
      traversalAndEgressTests: false,
    },
    issues: [],
  };
  resetResultDir();

  try {
    await runFunctionStep(summary, 'high-confidence secret scan', scanSecrets);
    summary.coverage.secretScan = true;

    await runCommandStep(
      summary,
      'production dependency audit',
      'npm',
      ['audit', '--omit=dev', '--audit-level=high', '--json'],
      {
        allowFailure: true,
        parseIssues: parseNpmAuditIssues,
      }
    );
    summary.coverage.dependencyAudit = true;

    await runFunctionStep(summary, 'production security headers contract', async () =>
      checkSecurityHeaders()
    );
    summary.coverage.securityHeaders = true;

    await runCommandStep(summary, 'API security catalog report', 'npm', [
      'run',
      'api:security-report',
    ]);
    summary.coverage.apiCatalog = true;

    await runCommandStep(summary, 'path traversal and egress guard tests', 'npx', [
      'vitest',
      'run',
      'src/lib/services/storage/__tests__/file-storage-service.test.ts',
      'src/lib/plugin-runtime/capabilities/__tests__/artifacts-capability.test.ts',
      'src/lib/plugin-runtime/checks/__tests__/plugin-check.test.ts',
      'src/lib/security/__tests__/api-security-middleware.test.ts',
      'src/lib/security/__tests__/security-headers.test.ts',
      'src/lib/security/__tests__/csp-policy.test.ts',
    ]);
    summary.coverage.traversalAndEgressTests = true;

    summary.status = summary.issues.length === 0 ? 'passed' : 'failed';
    if (summary.status !== 'passed') {
      process.exitCode = 1;
    }
  } catch (error) {
    summary.status = 'failed';
    summary.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    writeSummary(summary);
    writeReport(summary);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
