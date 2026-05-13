/* eslint-disable no-console */

import { spawn } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

type Status = 'passed' | 'failed';

interface Suite {
  id: string;
  title: string;
  command: string[];
  covers: string[];
}

interface SuiteResult extends Suite {
  status: Status;
  durationMs: number;
  exitCode: number | null;
  stdoutLog: string;
  stderrLog: string;
}

interface WorkspaceScopeSummary {
  status: Status;
  generatedAt: string;
  suites: SuiteResult[];
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'workspace-scope-matrix');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', 'Workspace资源边界矩阵测试报告.md');
const VITEST_CLI_PATH = resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');

const SUITES: Suite[] = [
  {
    id: 'workspace-platform-capabilities',
    title: 'runs / apiKeys / connectors workspace role matrix',
    command: [
      'vitest',
      'run',
      '--testTimeout=30000',
      'src/lib/plugin-runtime/capabilities/__tests__/platform-capabilities.test.ts',
    ],
    covers: [
      'owner/admin/editor/viewer 均可读取 workspace user-visible runs',
      'owner/admin/editor 可创建 workspace runs，viewer 与非成员拒绝写入',
      'apiKeys 的 list/create 管理面只允许 owner/admin，editor/viewer 拒绝',
      'connectors 的 list/call 允许读角色，upsert/setStatus/delete 只允许 owner/admin',
      '非成员对 runs/connectors workspace read 被拒绝',
    ],
  },
  {
    id: 'workspace-files',
    title: 'files workspace role matrix',
    command: [
      'vitest',
      'run',
      '--testTimeout=30000',
      'src/lib/plugin-runtime/capabilities/__tests__/files-capability.test.ts',
    ],
    covers: [
      'owner/admin/editor/viewer 均可读取与下载 workspace files',
      'owner/admin/editor 可上传 workspace files',
      'viewer 上传拒绝，editor/viewer 删除/归档拒绝',
      'owner/admin 可删除 workspace files',
    ],
  },
  {
    id: 'workspace-artifacts',
    title: 'artifacts workspace role matrix',
    command: [
      'vitest',
      'run',
      '--testTimeout=30000',
      'src/lib/plugin-runtime/capabilities/__tests__/artifacts-capability.test.ts',
    ],
    covers: [
      'workspace artifacts 按 workspace scope 共享，不按创建者私有化',
      'owner/admin/editor/viewer 均可 read/list workspace artifacts',
      'owner/admin/editor 可写入/更新 workspace artifacts',
      'viewer 写入与删除拒绝，非成员读取拒绝',
    ],
  },
];

function cleanSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => key.length > 0 && !key.includes('=') && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  ) as NodeJS.ProcessEnv;
}

function commandFor(command: string[]) {
  const [name, ...args] = command;
  if (name === 'vitest') {
    return {
      file: process.execPath,
      args: [VITEST_CLI_PATH, ...args],
      display: command.join(' '),
    };
  }
  return {
    file: process.platform === 'win32' && name === 'npm' ? 'npm.cmd' : name,
    args,
    display: command.join(' '),
  };
}

async function runSuite(suite: Suite): Promise<SuiteResult> {
  const resolved = commandFor(suite.command);
  const started = Date.now();
  console.log(`\nRunning ${suite.title}`);
  console.log(resolved.display);

  const result = await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>(
    (resolvePromise, reject) => {
      const child = spawn(resolved.file, resolved.args, {
        cwd: process.cwd(),
        env: cleanSpawnEnv(process.env),
        shell: false,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => {
        stdout.push(chunk);
        process.stdout.write(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr.push(chunk);
        process.stderr.write(chunk);
      });
      child.on('error', reject);
      child.on('exit', (exitCode) =>
        resolvePromise({
          exitCode,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        })
      );
    }
  );

  return {
    ...suite,
    status: result.exitCode === 0 ? 'passed' : 'failed',
    durationMs: Date.now() - started,
    exitCode: result.exitCode,
    stdoutLog: result.stdout,
    stderrLog: result.stderr,
  };
}

function writeLogs(results: SuiteResult[]): SuiteResult[] {
  mkdirSync(RESULT_DIR, { recursive: true });

  return results.map((result) => {
    const stdoutPath = resolve(RESULT_DIR, `${result.id}.out.log`);
    const stderrPath = resolve(RESULT_DIR, `${result.id}.err.log`);
    writeFileSync(stdoutPath, result.stdoutLog, 'utf8');
    writeFileSync(stderrPath, result.stderrLog, 'utf8');
    return {
      ...result,
      stdoutLog: stdoutPath,
      stderrLog: stderrPath,
    };
  });
}

function writeReport(summary: WorkspaceScopeSummary): void {
  const rows = summary.suites
    .map(
      (suite) =>
        `| ${suite.title} | ${suite.status} | ${suite.durationMs} | \`${suite.command.join(' ')}\` | ${suite.covers.join('<br>')} |`
    )
    .join('\n');

  writeFileSync(
    REPORT_PATH,
    `# Workspace 资源边界矩阵测试报告

生成时间：${summary.generatedAt}

## 结论

状态：${summary.status === 'passed' ? '通过' : '失败'}

本报告验收 P1-02：同一 workspace 内，owner/admin/editor/viewer/非成员对 runs、files、artifacts、apiKeys、connectors 的资源边界一致。当前宿主角色模型只有 owner/admin/editor/viewer；文档中的 member 以“非成员/无 workspace role”负向用例覆盖。

## 覆盖套件

| 套件 | 状态 | 耗时 ms | 命令 | 覆盖重点 |
| ---- | ---- | ------: | ---- | -------- |
${rows}

## 资源文件

- \`test-results/workspace-scope-matrix/summary.json\`
- \`test-results/workspace-scope-matrix/*.out.log\`
- \`test-results/workspace-scope-matrix/*.err.log\`
`,
    'utf8'
  );
}

async function main(): Promise<void> {
  const results: SuiteResult[] = [];
  for (const suite of SUITES) {
    results.push(await runSuite(suite));
  }

  const summary: WorkspaceScopeSummary = {
    status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
    generatedAt: new Date().toISOString(),
    suites: writeLogs(results),
  };

  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeReport(summary);

  if (summary.status !== 'passed') {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
