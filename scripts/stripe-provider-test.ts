/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type SuiteStatus = 'passed' | 'failed';

interface ProviderSuite {
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

interface StripeProviderSummary {
  status: SuiteStatus;
  generatedAt: string;
  provider: 'stripe';
  mode: 'sdk-mock';
  suites: SuiteResult[];
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'stripe-provider');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', 'Stripe商业化Provider测试报告.md');
const VITEST_CLI_PATH = resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');

const SUITES: ProviderSuite[] = [
  {
    id: 'stripe-checkout-portal',
    title: 'Checkout and customer portal',
    covers: [
      'checkout session requires a real plan and validated Stripe price environment',
      'checkout metadata carries userId, planId, planSlug, planName, and billingPeriod',
      'customer portal requires an active Stripe-backed entitlement',
    ],
    files: ['src/lib/stripe/__tests__/checkout-service.test.ts'],
  },
  {
    id: 'stripe-event-transform',
    title: 'Webhook provider transform',
    covers: [
      'customer.subscription.created -> billing.subscription.created',
      'customer.subscription.updated -> billing.subscription.updated or plan_changed',
      'customer.subscription.deleted -> billing.subscription.cancelled',
      'invoice.paid and invoice.payment_succeeded -> subscription renewal or one-off invoice',
      'charge.refunded -> billing.order.refunded',
    ],
    files: ['src/lib/webhooks/providers/__tests__/stripe-adapter.test.ts'],
  },
  {
    id: 'stripe-business-handlers',
    title: 'Billing business handlers',
    covers: [
      'subscription update/change syncs entitlement and period snapshot',
      'subscription cancellation cancels entitlement and records a cancellation order',
      'renewal creates order, provider invoice, and credit reset',
      'one-off invoice creates a generic order and provider invoice',
      'refund creates refund order, marks original order, mirrors invoice status, and revokes credits',
    ],
    files: ['src/lib/webhooks/handlers/__tests__/subscription-handler.test.ts'],
  },
  {
    id: 'webhook-replay',
    title: 'Webhook receipt replay',
    covers: [
      'durable webhook receipts are moved through received -> processing -> processed',
      'duplicate processed receipts are skipped idempotently',
      'stale processing locks are retried',
      'failed receipts retry and eventually move to dead letter',
    ],
    files: ['src/lib/webhooks/__tests__/webhook-receipt-worker.test.ts'],
  },
];

function cleanSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => key.length > 0 && !key.includes('=') && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  ) as NodeJS.ProcessEnv;
}

async function runSuite(suite: ProviderSuite): Promise<SuiteResult> {
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

function writeReport(summary: StripeProviderSummary): void {
  const suiteRows = summary.suites
    .map(
      (suite) =>
        `| ${suite.title} | ${suite.status} | ${suite.durationMs} | ${suite.covers.join('<br>')} |`
    )
    .join('\n');

  writeFileSync(
    REPORT_PATH,
    `# Stripe 商业化 Provider 测试报告

生成时间：${summary.generatedAt}

## 结论

状态：${summary.status === 'passed' ? '通过' : '失败'}

本报告验收 P1-03 的平台边界：Stripe checkout、customer portal、订阅变更/取消、发票、退款、webhook receipt 重放。当前仓库没有配置真实 \`sk_test\` 和 webhook secret，因此本套件使用 SDK mock 和内部 handler mock 做等价 provider 验收；如果上线前启用真实 Stripe 账号，还需要用 Stripe CLI 或 test mode 账号补一轮真实网络验收。

## 覆盖套件

| 套件 | 状态 | 耗时 ms | 覆盖重点 |
| --- | --- | ---: | --- |
${suiteRows}

## 证据文件

- \`test-results/stripe-provider/summary.json\`
- \`test-results/stripe-provider/*.out.log\`
- \`test-results/stripe-provider/*.err.log\`
`,
    'utf8'
  );
}

async function main(): Promise<void> {
  const results: SuiteResult[] = [];
  for (const suite of SUITES) {
    results.push(await runSuite(suite));
  }

  const summary: StripeProviderSummary = {
    status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
    generatedAt: new Date().toISOString(),
    provider: 'stripe',
    mode: 'sdk-mock',
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
