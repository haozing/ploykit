/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type SuiteStatus = 'passed' | 'failed';

interface FailureSuite {
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

interface FailureSummary {
  status: SuiteStatus;
  generatedAt: string;
  suites: SuiteResult[];
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'p0-failure');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', 'P0负向与故障边界测试报告.md');

const SUITES: FailureSuite[] = [
  {
    id: 'commercial-credits-entitlements',
    title: '商业化、积分、权益边界',
    covers: [
      '商业路由缺少 plan/license 返回结构化 PLUGIN_PLAN_REQUIRED/PLUGIN_LICENSE_REQUIRED',
      '余额不足拒绝 metering/credits 消耗并释放幂等占用',
      'grantPlan 只允许 admin/system，redeemCode 未配置账本时返回 unavailable',
      'plan tier 与 feature entitlement 判断走真实 host service',
      'AI provider 未配置时不扣 usage/credits',
    ],
    files: [
      'src/lib/plugin-runtime/__tests__/plugin-runtime.test.ts',
      'src/lib/plugin-runtime/capabilities/__tests__/capability-context.test.ts',
      'src/lib/plugin-runtime/capabilities/__tests__/credits-capability.test.ts',
      'src/lib/plugin-runtime/capabilities/__tests__/ai-capability.test.ts',
      'src/lib/services/user/__tests__/user-entitlement-service.test.ts',
      'src/lib/services/billing/__tests__/digital-entitlement-service.test.ts',
    ],
  },
  {
    id: 'files-storage-assets',
    title: '文件、存储、资产边界',
    covers: [
      'MIME/扩展名/大小限制在写入 blob 前拒绝',
      '文件夹和路径穿越输入被清洗',
      '签名 URL 绑定文件、操作、过期时间并拒绝错用',
      '删除失败保留 pending metadata 等待 cleanup 重试',
      'workspace viewer 只读，上传/删除被拒绝',
    ],
    files: [
      'src/lib/services/storage/__tests__/upload-policy.test.ts',
      'src/lib/services/storage/__tests__/file-storage-service.test.ts',
      'src/lib/plugin-runtime/files/__tests__/plugin-file-signing.test.ts',
      'src/lib/plugin-runtime/files/__tests__/plugin-file-cleanup.test.ts',
      'src/lib/plugin-runtime/capabilities/__tests__/files-capability.test.ts',
    ],
  },
  {
    id: 'events-jobs-webhooks',
    title: 'Events、Jobs、Outbox、Webhooks 故障边界',
    covers: [
      'outbox handler 失败后重试并在上限后失败归档',
      'failed entry 可 replay 且重置 attempts',
      'job retry exhausted 后标记 failed，idempotency key 去重',
      'webhook processing lock 超时后可重试',
      'webhook 最终失败进入 dead letter',
      '插件 webhook handler 缺失、抛错、禁用、权限缺失均返回结构化错误',
    ],
    files: [
      'src/lib/bus/__tests__/outbox-transport.test.ts',
      'src/lib/bus/__tests__/event-bus.outbox.test.ts',
      'src/lib/jobs/__tests__/job-registry.test.ts',
      'src/lib/jobs/__tests__/core-jobs.test.ts',
      'src/lib/plugin-runtime/jobs/__tests__/plugin-job-runtime.test.ts',
      'src/lib/plugin-runtime/events/__tests__/plugin-event-runtime.test.ts',
      'src/lib/webhooks/__tests__/webhook-receipt-worker.test.ts',
      'src/lib/webhooks/__tests__/webhook-logger.test.ts',
      'src/lib/plugin-runtime/adapters/__tests__/webhook-adapter.test.ts',
    ],
  },
  {
    id: 'security-permission-failures',
    title: '权限、安全、API 边界负向',
    covers: [
      'admin guard 对普通用户返回结构化 403',
      'CSRF 与 Origin guard 拒绝缺失或跨站 mutation',
      'API error handler 统一结构化并脱敏',
      'API route catalog 覆盖所有 route handler',
      'API key 过期、吊销、跨插件、跨 route、跨 resource scope 均失败',
      'workspace read/invite role 边界一致',
    ],
    files: [
      'src/lib/middleware/__tests__/admin-guard.test.ts',
      'src/lib/middleware/__tests__/csrf-guard.test.ts',
      'src/lib/middleware/__tests__/origin-guard.test.ts',
      'src/lib/middleware/__tests__/api-error-handler.test.ts',
      'src/lib/security/__tests__/api-route-catalog.test.ts',
      'src/lib/plugin-runtime/capabilities/__tests__/platform-capabilities.test.ts',
    ],
  },
];

function commandFor(args: string[]) {
  const vitestBin = resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
  return {
    command: process.execPath,
    args: [vitestBin, ...args.slice(1)],
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

async function runSuite(suite: FailureSuite): Promise<SuiteResult> {
  const args = ['vitest', 'run', '--testTimeout=30000', ...suite.files];
  const command = commandFor(args);
  const start = Date.now();

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
    id: suite.id,
    title: suite.title,
    status: result.exitCode === 0 ? 'passed' : 'failed',
    durationMs: Date.now() - start,
    exitCode: result.exitCode,
    command: command.display,
    covers: suite.covers,
    log: {
      stdout: result.stdout,
      stderr: result.stderr,
    },
  };
}

function writeLogs(results: SuiteResult[]) {
  mkdirSync(RESULT_DIR, { recursive: true });

  for (const result of results) {
    writeFileSync(resolve(RESULT_DIR, `${result.id}.out.log`), result.log.stdout);
    writeFileSync(resolve(RESULT_DIR, `${result.id}.err.log`), result.log.stderr);
  }
}

function writeMarkdown(summary: FailureSummary) {
  const lines: string[] = [
    '# P0 负向与故障边界测试报告',
    '',
    `生成时间：${summary.generatedAt}`,
    '',
    '## 总结',
    '',
    `总体状态：${summary.status === 'passed' ? '通过' : '失败'}`,
    '',
    '| 套件 | 状态 | 耗时 | 覆盖重点 |',
    '| --- | --- | ---: | --- |',
  ];

  for (const suite of summary.suites) {
    lines.push(
      `| ${suite.title} | ${suite.status === 'passed' ? '通过' : '失败'} | ${suite.durationMs}ms | ${suite.covers.join('<br>')} |`
    );
  }

  lines.push('', '## 执行命令', '');
  for (const suite of summary.suites) {
    lines.push(`- ${suite.title}: \`${suite.command}\``);
  }

  lines.push(
    '',
    '## 判定',
    '',
    summary.status === 'passed'
      ? 'P0 负向与故障边界已形成固定验收入口，覆盖权限拒绝、商业化不足、余额不足、provider 未配置、文件存储失败、webhook/job/outbox 重试与死信等边界。'
      : '存在失败套件，不能判定 P0 负向与故障边界通过；请查看 test-results/p0-failure 下对应日志。'
  );

  writeFileSync(REPORT_PATH, `${lines.join('\n')}\n`);
}

async function main() {
  const results: SuiteResult[] = [];

  for (const suite of SUITES) {
    results.push(await runSuite(suite));
  }

  writeLogs(results);

  const summary: FailureSummary = {
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

  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  writeMarkdown(summary);

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
