/* eslint-disable no-console */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  apiRoutePatternMatches,
  getApiRouteCatalogEntry,
  isApiStateChangingMethod,
  resolveApiRoutePolicy,
  type ApiAccessClass,
  type ApiHttpMethod,
  type ApiMutationProtection,
  type ApiRouteMethodPolicy,
} from '../src/lib/security/api-route-catalog';
import {
  discoverAppApiRoutes,
  validateApiRouteCatalog,
  type DiscoveredApiRoute,
} from '../src/lib/security/api-route-catalog-check.server';

type EvidenceDimension = 'catalog' | 'access' | 'mutation' | 'runtime' | 'route';

interface EvidenceSource {
  id: string;
  dimension: EvidenceDimension;
  label: string;
  source: string;
  appliesTo(input: EvidenceInput): boolean;
}

interface EvidenceInput {
  route: DiscoveredApiRoute;
  method: ApiHttpMethod;
  policy: ApiRouteMethodPolicy;
}

interface MethodCoverage {
  routePath: string;
  filePath: string;
  method: ApiHttpMethod;
  catalogId: string | null;
  access: ApiAccessClass | null;
  mutationProtection: ApiMutationProtection | null;
  guard: string | null;
  stateChanging: boolean;
  evidence: Array<Pick<EvidenceSource, 'id' | 'dimension' | 'label' | 'source'>>;
  issues: string[];
}

interface CoverageReport {
  generatedAt: string;
  valid: boolean;
  routesScanned: number;
  methodsScanned: number;
  stateChangingMethods: number;
  uncoveredStateChangingMethods: number;
  catalogIssues: string[];
  coverageIssues: string[];
  methods: MethodCoverage[];
}

const OUTPUT_DIR = path.join(process.cwd(), 'test-results', 'api-security');
const JSON_OUTPUT = path.join(OUTPUT_DIR, 'coverage.json');
const MARKDOWN_OUTPUT = path.join(process.cwd(), 'docs', 'API安全边界覆盖报告.md');

function routeMatches(routePath: string, pattern: string): boolean {
  return apiRoutePatternMatches(pattern, routePath);
}

function protectionIncludes(
  protection: ApiMutationProtection,
  value: 'csrf-origin' | 'rate-limit' | 'webhook-signature' | 'plugin-contract'
): boolean {
  return protection.includes(value);
}

const EVIDENCE_SOURCES: EvidenceSource[] = [
  {
    id: 'catalog-unit-all-routes',
    dimension: 'catalog',
    label: 'API route catalog unit test covers every discovered route handler.',
    source: 'src/lib/security/__tests__/api-route-catalog.test.ts',
    appliesTo: () => true,
  },
  {
    id: 'runtime-security-reconcile',
    dimension: 'runtime',
    label: 'runtime:check scans app API routes, catalog policies, and mutation guards.',
    source: 'src/lib/runtime/checks/security-check.server.ts',
    appliesTo: () => true,
  },
  {
    id: 'catalog-guard-source-scan',
    dimension: 'catalog',
    label:
      'Catalog checker validates withAdminGuard/withAuth source references for declared protected routes.',
    source: 'src/lib/security/api-route-catalog-check.server.ts',
    appliesTo: () => true,
  },
  {
    id: 'admin-guard-tests',
    dimension: 'access',
    label: 'Admin access guard rejects guests and non-admin users.',
    source: 'src/lib/middleware/__tests__/admin-guard.test.ts; scripts/codex-real-test.ts',
    appliesTo: ({ policy }) => policy.access === 'admin',
  },
  {
    id: 'authenticated-guard-tests',
    dimension: 'access',
    label:
      'Authenticated access guard rejects guests and preserves current-user ownership boundaries.',
    source: 'scripts/codex-real-test.ts; src/lib/middleware/__tests__',
    appliesTo: ({ policy }) => policy.access === 'authenticated',
  },
  {
    id: 'public-mutation-tests',
    dimension: 'access',
    label:
      'Public mutation routes still go through payload validation, rate limit, and origin checks.',
    source:
      'scripts/codex-real-test.ts; src/lib/security/__tests__/api-security-middleware.test.ts',
    appliesTo: ({ policy }) => policy.access === 'public',
  },
  {
    id: 'provider-auth-tests',
    dimension: 'access',
    label:
      'Better Auth owns provider routes and is exercised by registration/login/password reset smoke tests.',
    source: 'scripts/codex-real-test.ts; src/lib/auth/**/__tests__',
    appliesTo: ({ policy }) => policy.access === 'auth-provider',
  },
  {
    id: 'debug-guard-tests',
    dimension: 'access',
    label: 'Debug routes are production-blocked by the global API middleware and debug guard.',
    source:
      'src/lib/middleware/debug-guard.ts; src/lib/security/__tests__/api-security-middleware.test.ts',
    appliesTo: ({ policy }) => policy.access === 'debug',
  },
  {
    id: 'debug-api-route-source',
    dimension: 'route',
    label:
      'Debug API routes are explicitly cataloged and production-blocked by the global API middleware.',
    source: 'src/lib/security/api-route-catalog.ts; src/lib/middleware/debug-guard.ts',
    appliesTo: ({ route }) => routeMatches(route.routePath, '/api/debug/**'),
  },
  {
    id: 'webhook-access-tests',
    dimension: 'access',
    label:
      'Webhook routes are anonymous but require provider/plugin signature or runtime contract verification.',
    source:
      'scripts/codex-real-test.ts; src/lib/plugin-runtime/capabilities/__tests__/capability-context.test.ts',
    appliesTo: ({ policy }) => policy.access === 'webhook',
  },
  {
    id: 'plugin-gateway-access-tests',
    dimension: 'access',
    label:
      'Plugin gateway routes resolve plugin contract auth, permissions, installation state, and machine auth before dispatch.',
    source: 'scripts/codex-real-test.ts; src/lib/plugin-runtime/**/__tests__',
    appliesTo: ({ policy }) => policy.access === 'plugin-gateway',
  },
  {
    id: 'csrf-origin-tests',
    dimension: 'mutation',
    label:
      'Browser-origin mutation guard rejects unsafe cross-origin POST/PUT/PATCH/DELETE requests.',
    source:
      'src/lib/middleware/__tests__/origin-guard.test.ts; src/lib/middleware/__tests__/csrf-guard.test.ts',
    appliesTo: ({ policy }) => protectionIncludes(policy.mutationProtection, 'csrf-origin'),
  },
  {
    id: 'global-api-security-middleware-tests',
    dimension: 'mutation',
    label:
      'Global API security middleware applies route catalog, origin, service-token, and mutation policy decisions.',
    source: 'src/lib/security/__tests__/api-security-middleware.test.ts; src/middleware.test.ts',
    appliesTo: ({ policy }) =>
      protectionIncludes(policy.mutationProtection, 'csrf-origin') ||
      protectionIncludes(policy.mutationProtection, 'plugin-contract') ||
      protectionIncludes(policy.mutationProtection, 'rate-limit'),
  },
  {
    id: 'rate-limit-tests',
    dimension: 'mutation',
    label:
      'Rate limit middleware and plugin rate limit buckets are covered, including plugin/key/route scoped buckets.',
    source:
      'src/lib/security/__tests__/api-rate-limit-middleware.test.ts; src/lib/plugin-runtime/capabilities/__tests__/platform-capabilities.test.ts',
    appliesTo: ({ policy }) => protectionIncludes(policy.mutationProtection, 'rate-limit'),
  },
  {
    id: 'webhook-signature-tests',
    dimension: 'mutation',
    label:
      'Webhook signature and receipt flows reject missing signatures and accept valid signed events.',
    source:
      'scripts/codex-real-test.ts; src/lib/plugin-runtime/capabilities/__tests__/capability-context.test.ts',
    appliesTo: ({ policy }) => protectionIncludes(policy.mutationProtection, 'webhook-signature'),
  },
  {
    id: 'plugin-contract-tests',
    dimension: 'mutation',
    label:
      'Plugin contract routes enforce route declarations, installation state, permissions, signed file transfer, and API key scopes.',
    source: 'scripts/codex-real-test.ts; src/lib/plugin-runtime/**/__tests__',
    appliesTo: ({ policy }) => protectionIncludes(policy.mutationProtection, 'plugin-contract'),
  },
  {
    id: 'provider-managed-tests',
    dimension: 'mutation',
    label:
      'Provider-managed mutation routes are delegated to Better Auth or equivalent provider handlers and smoke-tested end to end.',
    source: 'scripts/codex-real-test.ts; src/lib/auth/**/__tests__',
    appliesTo: ({ policy }) => policy.mutationProtection.startsWith('provider-managed'),
  },
  {
    id: 'admin-api-real-smoke',
    dimension: 'route',
    label: 'Admin APIs are exercised by real smoke and admin browser surface tests.',
    source: 'scripts/codex-real-test.ts; tests/e2e/admin-*.spec.ts',
    appliesTo: ({ route, policy }) =>
      policy.access === 'admin' || routeMatches(route.routePath, '/api/admin/**'),
  },
  {
    id: 'user-api-real-smoke',
    dimension: 'route',
    label:
      'User APIs are exercised by profile, password, billing, notification, and dashboard smoke paths.',
    source: 'scripts/codex-real-test.ts; tests/e2e/billing-history.spec.ts',
    appliesTo: ({ route }) =>
      routeMatches(route.routePath, '/api/user/**') ||
      routeMatches(route.routePath, '/api/notifications/**'),
  },
  {
    id: 'file-api-real-smoke',
    dimension: 'route',
    label:
      'File APIs are exercised by upload/download/delete, signed plugin file transfer, ownership, and admin file smoke tests.',
    source: 'scripts/codex-real-test.ts; tests/e2e/admin-files.spec.ts',
    appliesTo: ({ route }) =>
      routeMatches(route.routePath, '/api/files') ||
      routeMatches(route.routePath, '/api/files/[id]') ||
      routeMatches(route.routePath, '/api/plugin-files/[id]/[operation]'),
  },
  {
    id: 'plugin-api-real-smoke',
    dimension: 'route',
    label:
      'Plugin APIs are exercised by plugin lifecycle, capability-demo runtime, API key, webhook, and disabled-plugin smoke tests.',
    source: 'scripts/codex-real-test.ts; plugins/capability-demo/tests/plugin.test.ts',
    appliesTo: ({ route }) =>
      routeMatches(route.routePath, '/api/plugins') ||
      routeMatches(route.routePath, '/api/plugins/[...slug]') ||
      routeMatches(route.routePath, '/api/plugins/[pluginId]/webhooks/**') ||
      routeMatches(route.routePath, '/api/plugin-runs/**') ||
      routeMatches(route.routePath, '/api/plugin-files/[id]/[operation]'),
  },
  {
    id: 'billing-api-real-smoke',
    dimension: 'route',
    label:
      'Billing and plan APIs are exercised by plan CRUD, checkout/portal guards, orders, credits, and Stripe webhook smoke paths.',
    source: 'scripts/codex-real-test.ts; src/lib/stripe/**/__tests__',
    appliesTo: ({ route }) =>
      routeMatches(route.routePath, '/api/billing/**') ||
      routeMatches(route.routePath, '/api/checkout/create') ||
      routeMatches(route.routePath, '/api/plans') ||
      routeMatches(route.routePath, '/api/plans/[id]'),
  },
  {
    id: 'contact-api-real-smoke',
    dimension: 'route',
    label: 'Contact API validates public payloads and rejects invalid submissions.',
    source: 'scripts/codex-real-test.ts',
    appliesTo: ({ route }) => routeMatches(route.routePath, '/api/contact'),
  },
  {
    id: 'webhook-api-real-smoke',
    dimension: 'route',
    label:
      'Stripe and plugin webhook APIs are exercised for missing signature, valid signature, duplicate event, and missing plugin route.',
    source: 'scripts/codex-real-test.ts',
    appliesTo: ({ route }) =>
      routeMatches(route.routePath, '/api/webhooks/stripe') ||
      routeMatches(route.routePath, '/api/plugins/[pluginId]/webhooks/**'),
  },
  {
    id: 'auth-api-real-smoke',
    dimension: 'route',
    label:
      'Auth provider route is exercised by registration, login, password reset, password change, and session invalidation smoke paths.',
    source: 'scripts/codex-real-test.ts',
    appliesTo: ({ route }) => routeMatches(route.routePath, '/api/auth/[...all]'),
  },
];

function collectEvidence(input: EvidenceInput): MethodCoverage['evidence'] {
  return EVIDENCE_SOURCES.filter((source) => source.appliesTo(input)).map(
    ({ id, dimension, label, source }) => ({ id, dimension, label, source })
  );
}

function methodIssues(input: {
  method: ApiHttpMethod;
  policy: ApiRouteMethodPolicy | undefined;
  evidence: MethodCoverage['evidence'];
  stateChanging: boolean;
}): string[] {
  const issues: string[] = [];

  if (!input.policy) {
    return ['Missing API route catalog policy.'];
  }

  if (!input.stateChanging) {
    return issues;
  }

  if (input.policy.mutationProtection === 'none') {
    issues.push('State-changing method has no mutation protection.');
  }

  for (const requiredDimension of [
    'catalog',
    'access',
    'mutation',
    'route',
  ] satisfies EvidenceDimension[]) {
    if (!input.evidence.some((item) => item.dimension === requiredDimension)) {
      issues.push(`Missing ${requiredDimension} evidence source.`);
    }
  }

  return issues;
}

function buildCoverage(routes: DiscoveredApiRoute[]): CoverageReport {
  const catalogResult = validateApiRouteCatalog(routes);
  const methods: MethodCoverage[] = [];

  for (const route of routes) {
    for (const method of route.methods) {
      const policy = resolveApiRoutePolicy(route.routePath, method);
      const catalogEntry = getApiRouteCatalogEntry(route.routePath);
      const stateChanging = isApiStateChangingMethod(method);
      const evidence = policy ? collectEvidence({ route, method, policy }) : [];
      methods.push({
        routePath: route.routePath,
        filePath: path.relative(process.cwd(), route.filePath).replaceAll(path.sep, '/'),
        method,
        catalogId: catalogEntry?.id ?? null,
        access: policy?.access ?? null,
        mutationProtection: policy?.mutationProtection ?? null,
        guard: policy?.guard ?? null,
        stateChanging,
        evidence,
        issues: methodIssues({ method, policy, evidence, stateChanging }),
      });
    }
  }

  const coverageIssues = methods.flatMap((method) =>
    method.issues.map((issue) => `${method.method} ${method.routePath}: ${issue}`)
  );
  const stateChangingMethods = methods.filter((method) => method.stateChanging);

  return {
    generatedAt: new Date().toISOString(),
    valid: catalogResult.valid && coverageIssues.length === 0,
    routesScanned: catalogResult.routesScanned,
    methodsScanned: catalogResult.methodsScanned,
    stateChangingMethods: stateChangingMethods.length,
    uncoveredStateChangingMethods: stateChangingMethods.filter((method) => method.issues.length > 0)
      .length,
    catalogIssues: catalogResult.issues,
    coverageIssues,
    methods,
  };
}

function escapeMarkdown(value: unknown): string {
  return String(value ?? '')
    .replace(/\|/g, '/')
    .replace(/\n/g, '<br>');
}

function evidenceSummary(evidence: MethodCoverage['evidence']): string {
  return evidence
    .map((item) => `${item.dimension}:${item.id}`)
    .sort()
    .join('<br>');
}

function renderMarkdown(report: CoverageReport): string {
  const mutationMethods = report.methods.filter((method) => method.stateChanging);
  const rows = mutationMethods
    .map(
      (method) =>
        `| ${method.method} | ${method.routePath} | ${method.catalogId ?? ''} | ${method.access ?? ''} | ${method.mutationProtection ?? ''} | ${escapeMarkdown(method.guard)} | ${evidenceSummary(method.evidence)} | ${method.issues.length ? method.issues.map(escapeMarkdown).join('<br>') : '通过'} |`
    )
    .join('\n');

  const evidenceRows = EVIDENCE_SOURCES.map(
    (source) =>
      `| ${source.id} | ${source.dimension} | ${escapeMarkdown(source.label)} | ${escapeMarkdown(source.source)} |`
  ).join('\n');

  return `# API 安全边界覆盖报告

生成时间：${report.generatedAt}

## 总结

| 项目 | 结果 |
| --- | --- |
| 总状态 | ${report.valid ? '通过' : '失败'} |
| API route 文件数 | ${report.routesScanned} |
| HTTP method 数 | ${report.methodsScanned} |
| POST/PUT/PATCH/DELETE 数 | ${report.stateChangingMethods} |
| 未闭环 mutation 数 | ${report.uncoveredStateChangingMethods} |
| Catalog issue 数 | ${report.catalogIssues.length} |
| Coverage issue 数 | ${report.coverageIssues.length} |

## 判定规则

- 每个 \`POST/PUT/PATCH/DELETE\` 必须在 \`src/lib/security/api-route-catalog.ts\` 中解析到 policy。
- 每个状态变更方法的 \`mutationProtection\` 不能为 \`none\`。
- 每个状态变更方法必须同时具备 catalog、access、mutation、route 四类测试/校验证据来源。
- 本报告只验证宿主 API 安全边界覆盖；业务正确性仍由对应 smoke/e2e/unit 测试负责。

## Mutation 覆盖矩阵

| Method | Route | Catalog | Access | Mutation Protection | Guard | Evidence | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows}

## 证据源

| ID | 维度 | 说明 | 来源 |
| --- | --- | --- | --- |
${evidenceRows}

## Catalog Issues

${report.catalogIssues.length ? report.catalogIssues.map((issue) => `- ${issue}`).join('\n') : '- 无'}

## Coverage Issues

${report.coverageIssues.length ? report.coverageIssues.map((issue) => `- ${issue}`).join('\n') : '- 无'}
`;
}

async function main(): Promise<void> {
  const routes = await discoverAppApiRoutes();
  const report = buildCoverage(routes);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(JSON_OUTPUT, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(MARKDOWN_OUTPUT, renderMarkdown(report), 'utf8');

  console.log(
    `API security coverage: ${report.valid ? 'passed' : 'failed'}; routes=${report.routesScanned}; methods=${report.methodsScanned}; mutations=${report.stateChangingMethods}; uncovered=${report.uncoveredStateChangingMethods}`
  );
  console.log(`Wrote ${path.relative(process.cwd(), JSON_OUTPUT)}`);
  console.log(`Wrote ${path.relative(process.cwd(), MARKDOWN_OUTPUT)}`);

  if (!report.valid) {
    for (const issue of [...report.catalogIssues, ...report.coverageIssues]) {
      console.error(`- ${issue}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
