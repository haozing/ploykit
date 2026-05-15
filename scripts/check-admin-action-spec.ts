/* eslint-disable no-console */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ADMIN_ACTION_SPECS,
  COMMON_ADMIN_ACTIONS,
  type AdminActionDefinition,
  type AdminActionMatcher,
  type AdminApiMatcher,
} from '../tests/e2e/admin/admin-action-spec';
import { ADMIN_PAGES } from '../tests/e2e/admin/admin-page-catalog';
import type {
  AdminApiResponseSnapshot,
  AdminDisclosureProbe,
  AdminInteractiveSnapshot,
  AdminSurfaceReport,
} from '../tests/e2e/admin/admin-surface-report';

type CheckStatus = 'passed' | 'failed';

interface OwnedInteractive {
  pageId: string;
  role: string;
  name: string;
  ownerId: string;
  ownerScope: 'common' | 'page';
}

interface OwnedApiRoute {
  pageId: string;
  method: string;
  path: string;
  ownerId: string;
}

interface AdminActionSpecSummary {
  status: CheckStatus;
  generatedAt: string;
  catalogPages: number;
  surfaceReports: number;
  checkedReports: number;
  declaredPageSpecs: number;
  declaredPageActions: number;
  declaredCommonActions: number;
  declaredApiRoutes: number;
  ownedInteractives: number;
  ownedApiRoutes: number;
  errors: string[];
  warnings: string[];
  evidence: {
    surfaceDir: string;
    reportPath: string;
  };
}

const SURFACE_DIR = path.join(process.cwd(), 'test-results', 'admin-surface');
const RESULT_DIR = path.join(process.cwd(), 'test-results', 'admin-action-spec');
const SUMMARY_PATH = path.join(RESULT_DIR, 'summary.json');
const REPORT_PATH = path.join(process.cwd(), 'docs', '后台ActionSpec矩阵测试报告.zh-CN.md');

function normalizeName(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function normalizeApiPath(value: string): string {
  return value.split('?')[0] ?? value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matcherLabel(matcher: AdminActionMatcher): string {
  return `${matcher.role}:${matcher.name ?? `/${matcher.namePattern ?? ''}/`}`;
}

function apiMatcherLabel(matcher: AdminApiMatcher): string {
  return `${matcher.method}:${matcher.path ?? `/${matcher.pathPattern ?? ''}/`}`;
}

function matchesInteractive(
  matcher: AdminActionMatcher,
  interactive: AdminInteractiveSnapshot
): boolean {
  if (matcher.role !== interactive.role) {
    return false;
  }

  const name = normalizeName(interactive.name);
  if (matcher.name !== undefined) {
    return name === matcher.name;
  }

  if (matcher.namePattern !== undefined) {
    return new RegExp(matcher.namePattern).test(name);
  }

  return true;
}

function matchesApi(matcher: AdminApiMatcher, response: AdminApiResponseSnapshot): boolean {
  if (matcher.method.toUpperCase() !== response.method.toUpperCase()) {
    return false;
  }

  const apiPath = normalizeApiPath(response.path);
  if (matcher.path !== undefined) {
    return apiPath === matcher.path;
  }

  if (matcher.pathPattern !== undefined) {
    return new RegExp(matcher.pathPattern).test(apiPath);
  }

  return true;
}

function readSurfaceReports(): AdminSurfaceReport[] {
  if (!existsSync(SURFACE_DIR)) {
    return [];
  }

  return readdirSync(SURFACE_DIR)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => {
      const fullPath = path.join(SURFACE_DIR, fileName);
      return JSON.parse(readFileSync(fullPath, 'utf-8')) as AdminSurfaceReport;
    });
}

function isDesktopReport(report: AdminSurfaceReport): boolean {
  return report.viewport === 'desktop' || report.projectName.includes('desktop');
}

function uniqueInteractives(report: AdminSurfaceReport): AdminInteractiveSnapshot[] {
  const merged: AdminInteractiveSnapshot[] = [
    ...(report.interactives ?? []),
    ...(report.disclosureProbes ?? []).flatMap((probe: AdminDisclosureProbe) => probe.discovered),
  ];
  const byKey = new Map<string, AdminInteractiveSnapshot>();

  for (const item of merged) {
    if (!item.visible) {
      continue;
    }

    const normalized: AdminInteractiveSnapshot = {
      ...item,
      name: normalizeName(item.name),
    };
    byKey.set(`${normalized.role}:${normalized.name}`, normalized);
  }

  return [...byKey.values()].sort((left, right) =>
    `${left.role}:${left.name}`.localeCompare(`${right.role}:${right.name}`)
  );
}

function uniqueApiResponses(report: AdminSurfaceReport): AdminApiResponseSnapshot[] {
  const byKey = new Map<string, AdminApiResponseSnapshot>();

  for (const response of report.apiResponses ?? []) {
    const normalized: AdminApiResponseSnapshot = {
      ...response,
      method: response.method.toUpperCase(),
      path: normalizeApiPath(response.path),
    };
    byKey.set(`${normalized.method}:${normalized.path}`, normalized);
  }

  return [...byKey.values()].sort((left, right) =>
    `${left.method}:${left.path}`.localeCompare(`${right.method}:${right.path}`)
  );
}

function findInteractiveOwner(
  pageActions: readonly AdminActionDefinition[],
  interactive: AdminInteractiveSnapshot
): { action: AdminActionDefinition; scope: 'common' | 'page' } | undefined {
  for (const action of pageActions) {
    if (action.matchers.some((matcher) => matchesInteractive(matcher, interactive))) {
      return { action, scope: 'page' };
    }
  }

  for (const action of COMMON_ADMIN_ACTIONS) {
    if (action.matchers.some((matcher) => matchesInteractive(matcher, interactive))) {
      return { action, scope: 'common' };
    }
  }

  return undefined;
}

function findApiOwner(
  apiRoutes: readonly AdminApiMatcher[],
  response: AdminApiResponseSnapshot
): AdminApiMatcher | undefined {
  return apiRoutes.find((matcher) => matchesApi(matcher, response));
}

function validateSpecShape(errors: string[], warnings: string[]): void {
  const catalogPageIds = new Set(ADMIN_PAGES.map((page) => page.id));
  const seenPageIds = new Set<string>();

  for (const spec of ADMIN_ACTION_SPECS) {
    if (seenPageIds.has(spec.pageId)) {
      errors.push(`Duplicate admin action spec for page ${spec.pageId}`);
    }
    seenPageIds.add(spec.pageId);

    if (!catalogPageIds.has(spec.pageId)) {
      errors.push(`Action spec references unknown admin catalog page ${spec.pageId}`);
    }

    if (spec.actions.length === 0 && spec.apiRoutes.length === 0) {
      warnings.push(`Action spec ${spec.pageId} has no page-owned actions or API routes`);
    }

    const actionIds = new Set<string>();
    for (const action of spec.actions) {
      if (actionIds.has(action.id)) {
        errors.push(`Action spec ${spec.pageId} declares duplicate action id ${action.id}`);
      }
      actionIds.add(action.id);

      if (action.matchers.length === 0) {
        errors.push(`Action ${spec.pageId}.${action.id} has no interactive matcher`);
      }
    }

    const apiIds = new Set<string>();
    for (const route of spec.apiRoutes) {
      if (apiIds.has(route.id)) {
        errors.push(`Action spec ${spec.pageId} declares duplicate API route id ${route.id}`);
      }
      apiIds.add(route.id);

      if (!route.path && !route.pathPattern) {
        errors.push(`API route ${spec.pageId}.${route.id} has no path matcher`);
      }
    }
  }

  for (const page of ADMIN_PAGES) {
    if (!seenPageIds.has(page.id)) {
      errors.push(`Missing admin action spec for catalog page ${page.id}`);
    }
  }

  for (const action of COMMON_ADMIN_ACTIONS) {
    for (const matcher of action.matchers) {
      if (!matcher.name && !matcher.namePattern) {
        errors.push(`Common action ${action.id} has broad matcher ${matcherLabel(matcher)}`);
      }
    }
  }
}

function declaredMatcherUsage(
  checkedReports: readonly AdminSurfaceReport[],
  errors: string[],
  warnings: string[]
): void {
  const pageSpecs = new Map(ADMIN_ACTION_SPECS.map((spec) => [spec.pageId, spec]));
  const usedPageMatchers = new Set<string>();
  const usedCommonMatchers = new Set<string>();
  const usedApiMatchers = new Set<string>();

  for (const report of checkedReports) {
    const spec = pageSpecs.get(report.pageId);
    if (!spec) {
      continue;
    }

    for (const interactive of uniqueInteractives(report)) {
      for (const action of spec.actions) {
        for (const matcher of action.matchers) {
          if (matchesInteractive(matcher, interactive)) {
            usedPageMatchers.add(`${spec.pageId}:${action.id}:${matcherLabel(matcher)}`);
          }
        }
      }

      for (const action of COMMON_ADMIN_ACTIONS) {
        for (const matcher of action.matchers) {
          if (matchesInteractive(matcher, interactive)) {
            usedCommonMatchers.add(`${action.id}:${matcherLabel(matcher)}`);
          }
        }
      }
    }

    for (const response of uniqueApiResponses(report)) {
      for (const route of spec.apiRoutes) {
        if (matchesApi(route, response)) {
          usedApiMatchers.add(`${spec.pageId}:${route.id}:${apiMatcherLabel(route)}`);
        }
      }
    }
  }

  for (const spec of ADMIN_ACTION_SPECS) {
    const reportsForPage = checkedReports.filter((report) => report.pageId === spec.pageId);
    if (reportsForPage.length === 0) {
      continue;
    }

    for (const action of spec.actions) {
      const declaredMatcherCount = action.matchers.length;
      const usedMatcherCount = action.matchers.filter((matcher) =>
        usedPageMatchers.has(`${spec.pageId}:${action.id}:${matcherLabel(matcher)}`)
      ).length;

      if (declaredMatcherCount > 0 && usedMatcherCount === 0) {
        warnings.push(
          `No checked surface used action ${spec.pageId}.${action.id}; verify it is still reachable`
        );
      }
    }
  }

  const usedCommonActionIds = new Set(
    [...usedCommonMatchers].map((value) => value.split(':')[0]).filter(Boolean)
  );
  for (const action of COMMON_ADMIN_ACTIONS) {
    if (!usedCommonActionIds.has(action.id)) {
      warnings.push(`No checked surface used common admin action ${action.id}`);
    }
  }

  for (const spec of ADMIN_ACTION_SPECS) {
    const reportsForPage = checkedReports.filter((report) => report.pageId === spec.pageId);
    if (reportsForPage.length === 0) {
      continue;
    }

    for (const route of spec.apiRoutes) {
      if (!usedApiMatchers.has(`${spec.pageId}:${route.id}:${apiMatcherLabel(route)}`)) {
        warnings.push(
          `No checked surface called API matcher ${spec.pageId}.${route.id} ${apiMatcherLabel(
            route
          )}`
        );
      }
    }
  }

  if (usedPageMatchers.size === 0) {
    errors.push('No page-owned action matcher was exercised by checked admin surface reports');
  }
}

function writeReport(summary: AdminActionSpecSummary): void {
  const errorLines =
    summary.errors.length > 0 ? summary.errors.map((error) => `- ${error}`).join('\n') : '- 无';
  const warningLines =
    summary.warnings.length > 0
      ? summary.warnings.map((warning) => `- ${warning}`).join('\n')
      : '- 无';

  writeFileSync(
    REPORT_PATH,
    [
      '# 后台 Action Spec 矩阵测试报告',
      '',
      `生成时间：${summary.generatedAt}`,
      '',
      '## 结论',
      '',
      `状态：${summary.status === 'passed' ? '通过' : '失败'}`,
      '',
      `本报告验收 P1-06：后台页面的可见交互与后台 API 调用必须能归属到通用 chrome action 或页面自己的 Action Spec。脚本读取真实 Playwright surface crawler 产物，并用固定 spec 校验 ${summary.checkedReports} 份 desktop 报告、${summary.ownedInteractives} 个交互、${summary.ownedApiRoutes} 个 API route。`,
      '',
      '## 统计',
      '',
      `- 后台目录页面：${summary.catalogPages}`,
      `- surface 报告：${summary.surfaceReports}`,
      `- 本次检查报告：${summary.checkedReports}`,
      `- 页面 Action Spec：${summary.declaredPageSpecs}`,
      `- 页面 action：${summary.declaredPageActions}`,
      `- 通用 chrome action：${summary.declaredCommonActions}`,
      `- 声明 API route：${summary.declaredApiRoutes}`,
      '',
      '## 错误',
      '',
      errorLines,
      '',
      '## 警告',
      '',
      warningLines,
      '',
      '## 证据文件',
      '',
      '- `test-results/admin-action-spec/summary.json`',
      '- `test-results/admin-surface/*.json`',
      '',
    ].join('\n'),
    'utf8'
  );
}

function main(): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const reports = readSurfaceReports();
  const checkedReports = reports.filter(isDesktopReport);
  const pageSpecs = new Map(ADMIN_ACTION_SPECS.map((spec) => [spec.pageId, spec]));
  const ownedInteractives: OwnedInteractive[] = [];
  const ownedApiRoutes: OwnedApiRoute[] = [];

  validateSpecShape(errors, warnings);

  if (reports.length === 0) {
    errors.push(
      `No admin surface reports found under ${SURFACE_DIR}; run npm run test:admin:surface`
    );
  }

  if (checkedReports.length === 0) {
    errors.push('No desktop admin surface reports found for action spec checking');
  }

  for (const report of checkedReports) {
    const spec = pageSpecs.get(report.pageId);
    if (!spec) {
      errors.push(`No action spec found for surface report page ${report.pageId}`);
      continue;
    }

    for (const interactive of uniqueInteractives(report)) {
      const owner = findInteractiveOwner(spec.actions, interactive);
      if (!owner) {
        errors.push(
          `Unowned interactive on ${report.pageId}: ${interactive.role}:${normalizeName(
            interactive.name
          )}`
        );
        continue;
      }

      ownedInteractives.push({
        pageId: report.pageId,
        role: interactive.role,
        name: interactive.name,
        ownerId: owner.action.id,
        ownerScope: owner.scope,
      });
    }

    for (const response of uniqueApiResponses(report)) {
      const owner = findApiOwner(spec.apiRoutes, response);
      if (!owner) {
        errors.push(`Unowned admin API on ${report.pageId}: ${response.method} ${response.path}`);
        continue;
      }

      ownedApiRoutes.push({
        pageId: report.pageId,
        method: response.method,
        path: normalizeApiPath(response.path),
        ownerId: owner.id,
      });
    }
  }

  declaredMatcherUsage(checkedReports, errors, warnings);

  mkdirSync(RESULT_DIR, { recursive: true });

  const summary: AdminActionSpecSummary = {
    status: errors.length === 0 ? 'passed' : 'failed',
    generatedAt: new Date().toISOString(),
    catalogPages: ADMIN_PAGES.length,
    surfaceReports: reports.length,
    checkedReports: checkedReports.length,
    declaredPageSpecs: ADMIN_ACTION_SPECS.length,
    declaredPageActions: ADMIN_ACTION_SPECS.reduce((sum, spec) => sum + spec.actions.length, 0),
    declaredCommonActions: COMMON_ADMIN_ACTIONS.length,
    declaredApiRoutes: ADMIN_ACTION_SPECS.reduce((sum, spec) => sum + spec.apiRoutes.length, 0),
    ownedInteractives: ownedInteractives.length,
    ownedApiRoutes: ownedApiRoutes.length,
    errors,
    warnings,
    evidence: {
      surfaceDir: SURFACE_DIR,
      reportPath: REPORT_PATH,
    },
  };

  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  writeReport(summary);

  if (summary.status === 'failed') {
    console.error('Admin action spec check failed:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    console.error(`Wrote ${SUMMARY_PATH}`);
    console.error(`Wrote ${REPORT_PATH}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Admin action spec check passed for ${checkedReports.length} report(s), ${ownedInteractives.length} interactive(s), ${ownedApiRoutes.length} API route(s).`
  );
  if (warnings.length > 0) {
    console.log(`Warnings: ${warnings.length}`);
  }
  console.log(`Wrote ${SUMMARY_PATH}`);
  console.log(`Wrote ${REPORT_PATH}`);
}

main();
