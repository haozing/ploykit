/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Status = 'passed' | 'failed';

interface Suite {
  id: string;
  title: string;
  covers: string[];
  files: string[];
}

interface SuiteResult extends Suite {
  status: Status;
  durationMs: number;
  command: string;
  exitCode: number | null;
  log: {
    stdout: string;
    stderr: string;
  };
}

interface ChaosSummary {
  status: Status;
  generatedAt: string;
  suites: SuiteResult[];
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'chaos-matrix');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', '灾难混沌矩阵测试报告.md');

const SUITES: Suite[] = [
  {
    id: 'db-storage-provider-failures',
    title: 'DB、对象存储、provider 超时/未配置',
    covers: [
      'DB 短暂不可用时 runtime check 返回结构化 failed 与修复建议',
      'S3/R2 凭据缺失时 storage check fail fast，不静默退回 local',
      '文件删除失败保留 pending metadata 供 cleanup 重试',
      'AI provider 未配置时返回 unavailable 且不扣 usage/credits',
      'Connector 503/超时通过 retry/call log/audit 边界可观察',
    ],
    files: [
      'src/lib/runtime/checks/__tests__/chaos-runtime-checks.test.ts',
      'src/lib/services/storage/__tests__/init-server.test.ts',
      'src/lib/services/storage/__tests__/file-storage-service.test.ts',
      'src/lib/plugin-runtime/capabilities/__tests__/ai-capability.test.ts',
      'src/lib/plugin-runtime/capabilities/__tests__/platform-capabilities.test.ts',
    ],
  },
  {
    id: 'webhooks-jobs-outbox-recovery',
    title: 'webhook 重复投递、stale lock、outbox/job 恢复',
    covers: [
      'Webhook receipt stale processing lock 可重试，不会永久卡住',
      'Webhook 超过重试上限进入 dead letter 并记录 retry metadata',
      'Stripe/订单退款重复事件保持幂等，不重复写订单或扣回积分',
      'Outbox handler 持续失败后进入 failed，可 replay 重置 attempts',
      'Plugin job retry exhausted 后进入 dead letter，idempotency key 去重',
    ],
    files: [
      'src/lib/webhooks/__tests__/webhook-receipt-worker.test.ts',
      'src/lib/webhooks/__tests__/webhook-logger.test.ts',
      'src/lib/webhooks/handlers/__tests__/subscription-handler.test.ts',
      'src/lib/bus/__tests__/outbox-transport.test.ts',
      'src/lib/plugin-runtime/jobs/__tests__/plugin-job-runtime.test.ts',
    ],
  },
];

function resetResultDir(): void {
  const expected = resolve(process.cwd(), 'test-results', 'chaos-matrix');
  if (RESULT_DIR !== expected) {
    throw new Error(`Refusing to clear unexpected result directory: ${RESULT_DIR}`);
  }
  rmSync(RESULT_DIR, { recursive: true, force: true });
  mkdirSync(RESULT_DIR, { recursive: true });
}

function commandFor(args: string[]) {
  return {
    command: process.execPath,
    args: [resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs'), ...args.slice(1)],
    display: ['npx', ...args].join(' '),
  };
}

function cleanSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => key.length > 0 && !key.includes('=') && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  ) as NodeJS.ProcessEnv;
}

async function runSuite(suite: Suite): Promise<SuiteResult> {
  const args = ['vitest', 'run', '--testTimeout=30000', ...suite.files];
  const command = commandFor(args);
  const started = Date.now();

  console.log(`\nRunning ${suite.id}: ${suite.title}`);
  console.log(command.display);

  const result = await new Promise<{
    exitCode: number | null;
    stdout: string;
    stderr: string;
  }>((resolvePromise, reject) => {
    const child = spawn(command.command, command.args, {
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
    ...suite,
    status: result.exitCode === 0 ? 'passed' : 'failed',
    durationMs: Date.now() - started,
    command: command.display,
    exitCode: result.exitCode,
    log: {
      stdout: result.stdout,
      stderr: result.stderr,
    },
  };
}

function writeLogs(results: SuiteResult[]): void {
  for (const result of results) {
    writeFileSync(resolve(RESULT_DIR, `${result.id}.out.log`), result.log.stdout, 'utf8');
    writeFileSync(resolve(RESULT_DIR, `${result.id}.err.log`), result.log.stderr, 'utf8');
  }
}

function writeReport(summary: ChaosSummary): void {
  const rows = summary.suites
    .map(
      (suite) =>
        `| ${suite.title} | ${suite.status} | ${suite.durationMs} | ${suite.covers.join('<br>')} |`
    )
    .join('\n');
  const commands = summary.suites
    .map((suite) => `- ${suite.title}: \`${suite.command}\``)
    .join('\n');

  writeFileSync(
    REPORT_PATH,
    `# 灾难混沌矩阵测试报告

更新时间：${summary.generatedAt}

## 结论

- 状态：${summary.status}
- 覆盖：DB 短暂不可用、对象存储配置/删除失败、provider 未配置或超时、webhook 重复投递、outbox/job 重试与 dead letter

## 验收边界

本报告用于 P2-05 灾难/混沌验收。当前固定入口采用可重复的故障注入单测与服务级恢复测试，验证宿主在关键依赖失败时返回结构化错误、保留可恢复状态、记录可审计的 retry/dead-letter 信号。真实停库、云对象存储断网、第三方 provider 大面积故障仍建议在预发环境做演练。

## 套件

| 套件 | 状态 | 耗时 ms | 覆盖重点 |
| ---- | ---- | ------- | -------- |
${rows}

## 执行命令

${commands}

## 结果文件

- \`test-results/chaos-matrix/summary.json\`
- \`test-results/chaos-matrix/*.out.log\`
- \`test-results/chaos-matrix/*.err.log\`
`,
    'utf8'
  );
}

async function main(): Promise<void> {
  resetResultDir();
  const results: SuiteResult[] = [];

  for (const suite of SUITES) {
    results.push(await runSuite(suite));
  }

  writeLogs(results);

  const summary: ChaosSummary = {
    status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
    generatedAt: new Date().toISOString(),
    suites: results.map((result) => ({
      ...result,
      log: {
        stdout: resolve(RESULT_DIR, `${result.id}.out.log`),
        stderr: resolve(RESULT_DIR, `${result.id}.err.log`),
      },
    })),
  };

  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeReport(summary);

  if (summary.status !== 'passed') {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
