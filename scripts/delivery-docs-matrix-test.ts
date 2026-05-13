/* eslint-disable no-console */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Status = 'passed' | 'failed';

interface CheckResult {
  id: string;
  title: string;
  status: Status;
  detail: string;
  issues: string[];
}

interface DeliveryDocsSummary {
  status: Status;
  generatedAt: string;
  checks: CheckResult[];
}

const RESULT_DIR = resolve(process.cwd(), 'test-results', 'delivery-docs-matrix');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', '文档交付矩阵测试报告.md');

const PACKAGE_SCRIPTS = [
  'test:soak',
  'test:soak:build',
  'test:backup-restore',
  'test:security-audit',
  'test:chaos',
  'test:delivery-docs',
];

const REPORTS = [
  'docs/浏览器矩阵真实运行测试报告.md',
  'docs/Workspace资源边界矩阵测试报告.md',
  'docs/Stripe商业化Provider测试报告.md',
  'docs/存储Driver矩阵测试报告.md',
  'docs/插件规模矩阵测试报告.md',
  'docs/后台ActionSpec矩阵测试报告.md',
  'docs/可访问性矩阵测试报告.md',
  'docs/数据导出与审计矩阵测试报告.md',
  'docs/可观测性矩阵测试报告.md',
  'docs/升级迁移矩阵测试报告.md',
  'docs/并发容量矩阵测试报告.md',
  'docs/长时间Soak矩阵测试报告.md',
  'docs/备份恢复矩阵测试报告.md',
  'docs/安全审计矩阵测试报告.md',
  'docs/灾难混沌矩阵测试报告.md',
  'docs/文档交付矩阵测试报告.md',
];

function resetResultDir(): void {
  const expected = resolve(process.cwd(), 'test-results', 'delivery-docs-matrix');
  if (RESULT_DIR !== expected) {
    throw new Error(`Refusing to clear unexpected result directory: ${RESULT_DIR}`);
  }
  rmSync(RESULT_DIR, { recursive: true, force: true });
  mkdirSync(RESULT_DIR, { recursive: true });
}

function readText(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function checkPackageScripts(): CheckResult {
  const packageJson = JSON.parse(readText('package.json')) as { scripts?: Record<string, string> };
  const scripts = packageJson.scripts ?? {};
  const missing = PACKAGE_SCRIPTS.filter((script) => !scripts[script]);

  return {
    id: 'package-scripts',
    title: 'P2 固定脚本入口',
    status: missing.length === 0 ? 'passed' : 'failed',
    detail: `required=${PACKAGE_SCRIPTS.length}`,
    issues: missing.map((script) => `package.json missing script ${script}`),
  };
}

function checkReportFiles(): CheckResult {
  const selfReport = 'docs/文档交付矩阵测试报告.md';
  const missing = REPORTS.filter(
    (path) => path !== selfReport && !existsSync(resolve(process.cwd(), path))
  );
  return {
    id: 'report-files',
    title: '矩阵报告文件存在',
    status: missing.length === 0 ? 'passed' : 'failed',
    detail: `required=${REPORTS.length}`,
    issues: missing.map((path) => `missing ${path}`),
  };
}

function checkAcceptanceMatrix(): CheckResult {
  const matrix = readText('docs/正式可用验收测试矩阵.md');
  const required = [
    '`npm run test:soak:build`',
    '`npm run test:backup-restore`',
    '`npm run test:security-audit`',
    '`npm run test:chaos`',
    '`npm run test:delivery-docs`',
    '| P2-02 | 通过 |',
    '| P2-03 | 通过 |',
    '| P2-04 | 通过 |',
    '| P2-05 | 通过 |',
    '| P2-06 | 通过 |',
  ];
  const missing = required.filter((text) => !matrix.includes(text));

  return {
    id: 'acceptance-matrix',
    title: '正式验收矩阵引用最新 P2 入口',
    status: missing.length === 0 ? 'passed' : 'failed',
    detail: `required markers=${required.length}`,
    issues: missing.map((text) => `docs/正式可用验收测试矩阵.md missing ${text}`),
  };
}

function checkReadmeProviderClaims(): CheckResult {
  const readme = readText('README.md');
  const issues: string[] = [];
  const requiredTexts = [
    'S3/R2-compatible adapter',
    '真实云 bucket 启用前仍需云端 L4 验收',
    '密码重置邮件当前没有真实邮件 provider',
    '未配置 provider 时只能宣称“宿主边界可用，provider 能力未启用”',
    'test:security-audit',
    'test:delivery-docs',
  ];

  for (const text of requiredTexts) {
    if (!readme.includes(text)) {
      issues.push(`README.md missing "${text}"`);
    }
  }

  const staleClaims = ['s3`、`r2` 是配置预留，未注册可用 adapter'];
  for (const text of staleClaims) {
    if (readme.includes(text)) {
      issues.push(`README.md still contains stale claim "${text}"`);
    }
  }

  return {
    id: 'readme-provider-claims',
    title: 'README provider 声明与代码一致',
    status: issues.length === 0 ? 'passed' : 'failed',
    detail: `required markers=${requiredTexts.length}`,
    issues,
  };
}

function checkUtf8Docs(): CheckResult {
  const paths = ['README.md', 'docs/正式可用验收测试矩阵.md', ...REPORTS];
  const issues: string[] = [];
  for (const path of paths) {
    if (!existsSync(resolve(process.cwd(), path))) continue;
    const content = readText(path);
    if (content.includes('\uFFFD')) {
      issues.push(`${path} contains replacement character`);
    }
    if (/[姝㈠紡鍙閲㈡湰鐭╅樀]/.test(content)) {
      issues.push(`${path} contains typical mojibake glyphs`);
    }
  }

  return {
    id: 'utf8-docs',
    title: 'README 与报告 UTF-8 可读',
    status: issues.length === 0 ? 'passed' : 'failed',
    detail: `checked=${paths.length}`,
    issues,
  };
}

function writeReport(summary: DeliveryDocsSummary): void {
  const checkLines = summary.checks
    .map(
      (check) =>
        `- ${check.title}: ${check.status} (${check.detail})${
          check.issues.length > 0
            ? `\n  ${check.issues.map((issue) => `- ${issue}`).join('\n  ')}`
            : ''
        }`
    )
    .join('\n');

  writeFileSync(
    REPORT_PATH,
    `# 文档交付矩阵测试报告

更新时间：${summary.generatedAt}

## 结论

- 状态：${summary.status}
- 覆盖：README provider 声明、P2 npm 固定入口、正式验收矩阵命令与逐项记录、矩阵报告文件、UTF-8 可读性

## 检查项

${checkLines}

## 结果文件

- \`test-results/delivery-docs-matrix/summary.json\`
`,
    'utf8'
  );
}

function main(): void {
  resetResultDir();
  const checks = [
    checkPackageScripts(),
    checkReportFiles(),
    checkAcceptanceMatrix(),
    checkReadmeProviderClaims(),
    checkUtf8Docs(),
  ];
  const summary: DeliveryDocsSummary = {
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
    generatedAt: new Date().toISOString(),
    checks,
  };

  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeReport(summary);

  if (summary.status !== 'passed') {
    for (const check of checks) {
      for (const issue of check.issues) {
        console.error(`${check.id}: ${issue}`);
      }
    }
    process.exitCode = 1;
  }
}

main();
