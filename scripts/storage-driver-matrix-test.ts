/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type SuiteStatus = 'passed' | 'failed';

interface StorageSuite {
  id: string;
  title: string;
  covers: string[];
  files: string[];
}

interface SuiteResult {
  id: string;
  title: string;
  status: SuiteStatus;
  durationMs: number;
  exitCode: number | null;
  command: string;
  covers: string[];
  log: {
    stdout: string;
    stderr: string;
  };
}

interface StorageDriverSummary {
  status: SuiteStatus;
  generatedAt: string;
  suites: SuiteResult[];
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'storage-driver-matrix');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', '存储Driver矩阵测试报告.md');
const VITEST_CLI_PATH = resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');

const SUITES: StorageSuite[] = [
  {
    id: 'local-file-service',
    title: 'local driver through file service',
    covers: [
      'upload writes blob before metadata and compensates on DB failures',
      'download URL remains scoped to the user file API',
      'delete marks metadata pending before deleting blobs',
      'pending delete cleanup retries failed storage deletes',
      'provider field records the active blob store driver',
    ],
    files: [
      'src/lib/services/storage/__tests__/upload-policy.test.ts',
      'src/lib/services/storage/__tests__/file-storage-service.test.ts',
    ],
  },
  {
    id: 's3-compatible-adapter',
    title: 's3/r2-compatible adapter',
    covers: [
      'put/get/exists/delete against a real local S3-compatible HTTP endpoint',
      'SigV4 Authorization headers are emitted for object operations',
      'presigned GET/PUT URLs include scoped path, algorithm, signed headers, expiry, and signature',
      'path traversal keys are rejected before network requests',
    ],
    files: ['src/lib/services/storage/adapters/__tests__/s3-compatible-blob-store.test.ts'],
  },
  {
    id: 'storage-runtime-init',
    title: 'storage runtime initialization',
    covers: [
      'local driver registers local BlobStore',
      's3 driver registers S3-compatible BlobStore with bucket and endpoint status',
      'r2 driver registers S3-compatible BlobStore with auto region fallback',
      'missing object storage credentials fail fast with actionable errors',
    ],
    files: ['src/lib/services/storage/__tests__/init-server.test.ts'],
  },
  {
    id: 'plugin-file-boundaries',
    title: 'plugin file signed URL and cleanup boundaries',
    covers: [
      'plugin file signed URLs are scoped by file, operation, expiry, and workspace/user context',
      'expired or wrong-operation signed URLs are rejected',
      'temporary plugin files expire through cleanup and delete blobs',
      'cleanup records failures without deleting metadata prematurely',
    ],
    files: [
      'src/lib/plugin-runtime/files/__tests__/plugin-file-signing.test.ts',
      'src/lib/plugin-runtime/files/__tests__/plugin-file-cleanup.test.ts',
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

async function runSuite(suite: StorageSuite): Promise<SuiteResult> {
  const args = [VITEST_CLI_PATH, 'run', '--testTimeout=30000', ...suite.files];
  const command = [process.execPath, ...args];
  const start = Date.now();

  console.log(`\nRunning ${suite.title}`);
  console.log(`node ${args.join(' ')}`);

  const result = await new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
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
  });

  return {
    id: suite.id,
    title: suite.title,
    status: result.exitCode === 0 ? 'passed' : 'failed',
    durationMs: Date.now() - start,
    exitCode: result.exitCode,
    command: command.join(' '),
    covers: suite.covers,
    log: {
      stdout: result.stdout,
      stderr: result.stderr,
    },
  };
}

function writeLogs(results: SuiteResult[]): SuiteResult[] {
  mkdirSync(RESULT_DIR, { recursive: true });

  return results.map((result) => {
    const stdoutPath = resolve(RESULT_DIR, `${result.id}.out.log`);
    const stderrPath = resolve(RESULT_DIR, `${result.id}.err.log`);
    writeFileSync(stdoutPath, result.log.stdout, 'utf8');
    writeFileSync(stderrPath, result.log.stderr, 'utf8');
    return {
      ...result,
      log: {
        stdout: stdoutPath,
        stderr: stderrPath,
      },
    };
  });
}

function formatStatus(status: SuiteStatus): string {
  return status === 'passed' ? '通过' : '失败';
}

function writeReport(summary: StorageDriverSummary): void {
  const suiteSections = summary.suites
    .map((suite) =>
      [
        `### ${suite.title}`,
        '',
        `- 状态：${formatStatus(suite.status)}`,
        `- 耗时：${suite.durationMs} ms`,
        '- 覆盖重点：',
        ...suite.covers.map((cover) => `  - ${cover}`),
        '- 执行命令：',
        '',
        '```text',
        suite.command,
        '```',
      ].join('\n')
    )
    .join('\n\n');

  writeFileSync(
    REPORT_PATH,
    [
      '# 存储 Driver 矩阵测试报告',
      '',
      `生成时间：${summary.generatedAt}`,
      '',
      '## 结论',
      '',
      `状态：${formatStatus(summary.status)}`,
      '',
      '本报告验收 P1-04：宿主提供 local、S3-compatible、R2-compatible 三类文件存储 driver 边界。S3/R2 通过同一个兼容 adapter 覆盖 put/get/exists/delete、签名 URL、初始化配置和路径安全；本地没有真实云账号时，使用本地 HTTP S3-compatible fake server 做协议级请求验收。上线前如果启用真实 S3/R2 bucket，还需要补一轮真实云端凭据验收。',
      '',
      '## 覆盖套件',
      '',
      suiteSections,
      '',
      '## 证据文件',
      '',
      '- `test-results/storage-driver-matrix/summary.json`',
      '- `test-results/storage-driver-matrix/*.out.log`',
      '- `test-results/storage-driver-matrix/*.err.log`',
      '',
    ].join('\n'),
    'utf8'
  );
}

async function main(): Promise<void> {
  const results: SuiteResult[] = [];
  for (const suite of SUITES) {
    results.push(await runSuite(suite));
  }

  const summary: StorageDriverSummary = {
    status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
    generatedAt: new Date().toISOString(),
    suites: writeLogs(results),
  };

  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeReport(summary);

  console.log(`\nWrote ${SUMMARY_PATH}`);
  console.log(`Wrote ${REPORT_PATH}`);

  if (summary.status !== 'passed') {
    process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
