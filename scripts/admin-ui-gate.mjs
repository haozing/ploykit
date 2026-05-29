#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const runtimeRoot = path.join(root, '.runtime', 'admin-ui-gate');
const timestamp = new Date().toISOString().replaceAll(':', '-');
const outputDir = path.join(runtimeRoot, timestamp);
const outputFile = path.join(outputDir, 'admin-ui-gate.json');
const latestFile = path.join(runtimeRoot, 'latest.json');

const scanRoots = [
  path.join(root, 'apps', 'host-next', 'components', 'admin'),
  path.join(root, 'apps', 'host-next', 'app', '[lang]', 'admin'),
];

const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const hardLegacyTokens = [
  {
    token: 'border-border',
    message: 'Admin 页面不能继续使用通用 border-border。',
    recommendation: '改用 border-admin-border、AdminPanel 或 Admin primitives。',
  },
  {
    token: 'bg-card',
    message: 'Admin 页面不能继续使用通用 bg-card。',
    recommendation: '改用 bg-admin-surface、AdminPanel 或语义化 Admin token。',
  },
  {
    token: 'table-toolbar-field',
    message: 'Admin 页面不能继续使用旧 table-toolbar-field。',
    recommendation: '改用 FilterBar 或 AdvancedFilterPanel。',
  },
];
const softLegacyTokens = [
  {
    token: 'text-muted-foreground',
    recommendation: '逐步改为 text-admin-muted、text-admin-subtle 或组件内语义样式。',
  },
  {
    token: 'bg-muted',
    recommendation: '逐步改为 bg-admin-muted、bg-admin-bg 或组件内语义样式。',
  },
];

const checks = [];
const pageFiles = [];

function toRelative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function countNeedle(source, needle) {
  if (!needle) return 0;
  let count = 0;
  let index = source.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = source.indexOf(needle, index + needle.length);
  }
  return count;
}

function lineForIndex(source, index) {
  if (index < 0) return undefined;
  return source.slice(0, index).split(/\r?\n/).length;
}

function pushCheck({ id, severity, file, line, message, evidence, recommendation }) {
  checks.push({
    id,
    severity,
    file,
    ...(line ? { line } : {}),
    message,
    ...(evidence ? { evidence } : {}),
    ...(recommendation ? { recommendation } : {}),
  });
}

function scanFile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const relativeFile = toRelative(file);
  pageFiles.push(relativeFile);

  for (const tokenRule of hardLegacyTokens) {
    let index = source.indexOf(tokenRule.token);
    while (index !== -1) {
      pushCheck({
        id: `legacy-token:${tokenRule.token}`,
        severity: 'error',
        file: relativeFile,
        line: lineForIndex(source, index),
        message: tokenRule.message,
        evidence: tokenRule.token,
        recommendation: tokenRule.recommendation,
      });
      index = source.indexOf(tokenRule.token, index + tokenRule.token.length);
    }
  }

  for (const tokenRule of softLegacyTokens) {
    const count = countNeedle(source, tokenRule.token);
    if (count > 0) {
      pushCheck({
        id: `legacy-token-soft:${tokenRule.token}`,
        severity: 'warning',
        file: relativeFile,
        line: lineForIndex(source, source.indexOf(tokenRule.token)),
        message: `仍有 ${count} 处通用 ${tokenRule.token}，后续视觉债继续收敛。`,
        evidence: `${tokenRule.token} x ${count}`,
        recommendation: tokenRule.recommendation,
      });
    }
  }

  const isPrimitiveFile = relativeFile.endsWith('AdminPrimitives.tsx');
  const dataTableCount = countNeedle(source, '<DataTable');
  const detailsCount = countNeedle(source, '<details');
  const hasLayeringPrimitive =
    source.includes('SegmentedWorkspace') ||
    source.includes('EvidenceSection') ||
    source.includes('DetailDrawer') ||
    source.includes('ActionQueue') ||
    source.includes('PageSynopsis');
  const hasActionFold = source.includes('MoreActionMenu') || source.includes('ActionPanel') || source.includes('DangerZone');

  if (dataTableCount > 5 && !hasLayeringPrimitive) {
    pushCheck({
      id: 'page-density:data-table-stack',
      severity: 'warning',
      file: relativeFile,
      message: `这个文件包含 ${dataTableCount} 个 DataTable，但没有明显的分层组件痕迹。`,
      evidence: `DataTable x ${dataTableCount}`,
      recommendation: '把低频明细移入 SegmentedWorkspace、EvidenceSection 或 DetailDrawer。',
    });
  }

  if (dataTableCount > 8 && !hasActionFold) {
    pushCheck({
      id: 'page-actions:table-actions-not-folded',
      severity: 'warning',
      file: relativeFile,
      message: `这个文件包含 ${dataTableCount} 个 DataTable，但没有动作折叠组件痕迹。`,
      evidence: `DataTable x ${dataTableCount}`,
      recommendation: '检查行内操作是否需要 MoreActionMenu，危险动作是否需要 DangerZone。',
    });
  }

  if (!isPrimitiveFile && detailsCount > 2) {
    pushCheck({
      id: 'page-layering:raw-details',
      severity: 'warning',
      file: relativeFile,
      line: lineForIndex(source, source.indexOf('<details')),
      message: `这个文件直接手写了 ${detailsCount} 个 <details>。`,
      evidence: `<details x ${detailsCount}`,
      recommendation: '优先复用 EvidenceSection、AdvancedFilterPanel 或 SegmentedWorkspace，让折叠样式和文案一致。',
    });
  }

  const hasDangerActionIsolation =
    source.includes('DangerZone') ||
    source.includes('MoreActionMenu') ||
    source.includes('ActionPanel') ||
    (source.includes('ConfirmSubmitButton') && source.includes('confirmation=')) ||
    relativeFile.endsWith('/error.tsx');

  const hasDangerAction =
    /<ConfirmSubmitButton[\s\S]{0,500}admin-danger/.test(source) ||
    /<(?:button|Button|Link|a)\b[\s\S]{0,500}admin-danger/.test(source);

  if (!isPrimitiveFile && hasDangerAction && !hasDangerActionIsolation) {
    pushCheck({
      id: 'page-actions:danger-zone',
      severity: 'warning',
      file: relativeFile,
      line: lineForIndex(source, source.indexOf('admin-danger')),
      message: '页面出现危险动作视觉，但没有使用 DangerZone。',
      evidence: 'admin-danger',
      recommendation: '把低频危险动作移入 DangerZone，或确认它是 row-level MoreActionMenu 中的隔离动作。',
    });
  }

  if (source.includes('TableToolbar')) {
    pushCheck({
      id: 'page-controls:table-toolbar',
      severity: 'warning',
      file: relativeFile,
      line: lineForIndex(source, source.indexOf('TableToolbar')),
      message: 'Admin 页面仍有 TableToolbar 痕迹。',
      evidence: 'TableToolbar',
      recommendation: '优先改为 Admin FilterBar 或 AdvancedFilterPanel。',
    });
  }
}

function checkAdminNavigationModel() {
  const shellFile = path.join(root, 'apps', 'host-next', 'components', 'ProductShell.tsx');
  const navFile = path.join(root, 'apps', 'host-next', 'lib', 'admin-console-nav.ts');
  if (!fs.existsSync(navFile)) {
    pushCheck({
      id: 'admin-nav:registry-missing',
      severity: 'error',
      file: toRelative(navFile),
      message: 'Admin 导航注册表缺失。',
      recommendation: '用 apps/host-next/lib/admin-console-nav.ts 作为 Admin 导航、分组和能力要求的单一来源。',
    });
    return;
  }
  const navSource = fs.readFileSync(navFile, 'utf8');
  if (!navSource.includes('business-operations') || !navSource.includes('technical-operations')) {
    pushCheck({
      id: 'admin-nav:audience-missing',
      severity: 'error',
      file: toRelative(navFile),
      message: 'Admin 导航缺少运营/运维受众分层。',
      recommendation: '为每个 Admin route 标注 business-operations 或 technical-operations。',
    });
  }
  if (!fs.existsSync(shellFile)) {
    return;
  }
  const shellSource = fs.readFileSync(shellFile, 'utf8');
  if (!shellSource.includes('getAdminNavItems')) {
    pushCheck({
      id: 'admin-nav:shell-not-using-registry',
      severity: 'error',
      file: toRelative(shellFile),
      message: 'ProductShell 没有从 Admin 导航注册表生成导航。',
      recommendation: '从 @host/lib/admin-console-nav 读取 getAdminNavItems/defaultAdminNavItems。',
    });
  }
  if (shellSource.includes('export const adminNav: readonly ProductNavItem[] = [')) {
    pushCheck({
      id: 'admin-nav:shell-hardcoded',
      severity: 'error',
      file: toRelative(shellFile),
      message: 'ProductShell 重新出现硬编码 Admin 导航数组。',
      recommendation: '把路由、分组、文案和 capability 放回 admin-console-nav.ts。',
    });
  }
}

const files = [...new Set(scanRoots.flatMap((dir) => walk(dir)))].sort((a, b) => a.localeCompare(b));
for (const file of files) {
  scanFile(file);
}
checkAdminNavigationModel();

const errorCount = checks.filter((check) => check.severity === 'error').length;
const warningCount = checks.filter((check) => check.severity === 'warning').length;
const infoCount = checks.filter((check) => check.severity === 'info').length;
const ok = errorCount === 0;

const report = {
  schemaVersion: 1,
  ok,
  checkedAt: new Date().toISOString(),
  outputDir: toRelative(outputDir),
  scanRoots: scanRoots.filter((dir) => fs.existsSync(dir)).map((dir) => toRelative(dir)),
  summary: {
    filesScanned: files.length,
    errors: errorCount,
    warnings: warningCount,
    info: infoCount,
  },
  checks,
  pageFiles,
  review: {
    source: 'docs/admin-operations.zh-CN.md',
    rule: 'Errors block visual baseline. Warnings are tracked in docs/admin-operations.zh-CN.md and reviewed during Admin UI passes.',
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
fs.mkdirSync(runtimeRoot, { recursive: true });
fs.copyFileSync(outputFile, latestFile);

console.log(JSON.stringify(report, null, 2));
process.exitCode = ok ? 0 : 1;
