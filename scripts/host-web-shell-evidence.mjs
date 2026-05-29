import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const required = process.argv.includes('--required');
const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'web-shell',
  checkedAt.replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'web-shell.json');
const latestPath = path.resolve(process.cwd(), '.runtime', 'web-shell', 'latest.json');

function summarizeTap(stdout) {
  return {
    tests: Number(stdout.match(/# tests (\d+)/)?.[1] ?? 0),
    pass: Number(stdout.match(/# pass (\d+)/)?.[1] ?? 0),
    fail: Number(stdout.match(/# fail (\d+)/)?.[1] ?? 0),
    skipped: Number(stdout.match(/# skipped (\d+)/)?.[1] ?? 0),
  };
}

function isolatedWebShellTestEnv(source) {
  const env = { ...source };

  // Web shell evidence is a hermetic host/runtime contract suite. RC evidence
  // may run with DATABASE_URL for Postgres checks, but these tests assert fixed
  // seed data and should not accumulate state in a shared persistent store.
  delete env.DATABASE_URL;
  delete env.POSTGRES_URL;
  delete env.PLOYKIT_RUNTIME_DATABASE_URL;
  delete env.PLOYKIT_RUNTIME_STORE;

  return env;
}

const startedAt = Date.now();
const result = spawnSync(npm, ['run', 'test:web-shell'], {
  cwd: process.cwd(),
  env: isolatedWebShellTestEnv(process.env),
  encoding: 'utf8',
  shell: process.platform === 'win32',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stdout = result.stdout ?? '';
const stderr = result.stderr ?? '';
const stdoutLog = path.join(outputDir, 'test-web-shell.stdout.log');
const stderrLog = path.join(outputDir, 'test-web-shell.stderr.log');
const summary = summarizeTap(stdout);
const ok = result.status === 0 && summary.fail === 0 && summary.tests > 0;
const report = {
  ok,
  required,
  checkedAt,
  command: 'npm run test:web-shell',
  durationMs: Date.now() - startedAt,
  summary,
  checks: [
    {
      id: 'test:web-shell',
      ok,
      detail: summary,
    },
  ],
  artifacts: {
    report: reportPath,
    latest: latestPath,
    stdoutLog,
    stderrLog,
  },
  error: ok ? undefined : stderr.trim() || stdout.trim(),
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(stdoutLog, stdout);
fs.writeFileSync(stderrLog, stderr);
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = ok ? 0 : 1;
