/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type SuiteStatus = 'passed' | 'failed';

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

interface PluginScaleSummary {
  status: SuiteStatus;
  generatedAt: string;
  syntheticPlugins: number;
  publicAliases: number;
  assets: number;
  suites: SuiteResult[];
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'plugin-scale-matrix');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', '插件规模矩阵测试报告.md');
const VITEST_CLI_PATH = resolve(process.cwd(), 'node_modules', 'vitest', 'vitest.mjs');
const SYNTHETIC_PLUGIN_COUNT = 24;
const PUBLIC_ALIASES_PER_PLUGIN = 3;
const ASSETS_PER_PLUGIN = 2;

const SUITES = [
  {
    id: 'synthetic-plugin-scale',
    title: 'synthetic plugin scale matrix',
    covers: [
      '24 个合成插件同时注册到 runtime registry',
      '72 个 public alias sitemap entries 稳定生成并去重',
      '公开 alias resolver 能在多插件中命中正确插件和 route',
      '跨插件 public alias 冲突被全局检测阻断',
      '24 个 header:extra slot 聚合渲染并保持优先级顺序',
      'route-scoped slot 只能挂到插件自己声明的 page/tool/alias',
      '48 个声明资产通过宿主 asset gateway 路径、缓存和读取边界',
    ],
    files: ['src/lib/plugin-runtime/__tests__/synthetic-plugin-scale.test.ts'],
  },
] as const;

function cleanSpawnEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([key, value]) => key.length > 0 && !key.includes('=') && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  ) as NodeJS.ProcessEnv;
}

async function runSuite(suite: (typeof SUITES)[number]): Promise<SuiteResult> {
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
    covers: [...suite.covers],
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

function writeReport(summary: PluginScaleSummary): void {
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
      '# 插件规模矩阵测试报告',
      '',
      `生成时间：${summary.generatedAt}`,
      '',
      '## 结论',
      '',
      `状态：${formatStatus(summary.status)}`,
      '',
      `本报告验收 P1-05：宿主在多插件、多 public routes、多 sitemap entries、多 slots、多 assets 同时存在时的平台边界。当前 synthetic matrix 使用 ${summary.syntheticPlugins} 个合成插件、${summary.publicAliases} 个公开别名、${summary.assets} 个声明资产，验证 runtime registry、public alias resolver、sitemap collector、slot manager、asset gateway 和跨插件 alias 冲突检测。`,
      '',
      '## 覆盖套件',
      '',
      suiteSections,
      '',
      '## 证据文件',
      '',
      '- `test-results/plugin-scale-matrix/summary.json`',
      '- `test-results/plugin-scale-matrix/*.out.log`',
      '- `test-results/plugin-scale-matrix/*.err.log`',
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

  const summary: PluginScaleSummary = {
    status: results.every((result) => result.status === 'passed') ? 'passed' : 'failed',
    generatedAt: new Date().toISOString(),
    syntheticPlugins: SYNTHETIC_PLUGIN_COUNT,
    publicAliases: SYNTHETIC_PLUGIN_COUNT * PUBLIC_ALIASES_PER_PLUGIN,
    assets: SYNTHETIC_PLUGIN_COUNT * ASSETS_PER_PLUGIN,
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
