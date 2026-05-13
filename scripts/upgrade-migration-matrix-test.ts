/* eslint-disable no-console */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres, { type Sql } from 'postgres';
import { getDockerDatabaseUrl, loadDockerDbEnv, maskDatabaseUrl } from './docker-db-env';

type Status = 'passed' | 'failed' | 'skipped';

interface StepResult {
  name: string;
  status: Status;
  durationMs?: number;
  detail?: string;
  error?: string;
}

interface UpgradeMigrationOptions {
  prepare: boolean;
  fromTag: string;
  targetTag: string;
  databaseName: string;
}

interface UpgradeMigrationSummary {
  status: Status;
  startedAt: string;
  finishedAt?: string;
  sourceDatabaseUrl: string;
  testDatabaseUrl: string;
  options: UpgradeMigrationOptions;
  coverage: {
    oldVersionFixture: boolean;
    currentMigrations: boolean;
    dataRetention: boolean;
    permissionRetention: boolean;
    workspaceArtifactScope: boolean;
    newSchemaContract: boolean;
  };
  fixture?: Record<string, string>;
  checks?: Record<string, unknown>;
  steps: StepResult[];
  error?: string;
}

interface MigrationEntry {
  idx?: number;
  tag: string;
}

const FROM_TAG = '0022_digital_entitlements';
const TARGET_TAG = '0023_workspace_scope_consistency';
const RESULT_DIR = resolve(process.cwd(), 'test-results', 'upgrade-migration-matrix');
const SUMMARY_PATH = resolve(RESULT_DIR, 'summary.json');
const REPORT_PATH = resolve(process.cwd(), 'docs', '升级迁移矩阵测试报告.md');

function parseOptions(): UpgradeMigrationOptions {
  const args = new Set(process.argv.slice(2));
  const suffix = `${Date.now()}_${randomUUID().slice(0, 8)}`.replace(/-/g, '_');

  return {
    prepare: !args.has('--skip-prepare'),
    fromTag: FROM_TAG,
    targetTag: TARGET_TAG,
    databaseName: process.env.UPGRADE_MATRIX_DB || `ploykit_upgrade_matrix_${suffix}`,
  };
}

function resetResultDir(): void {
  const expectedRoot = resolve(process.cwd(), 'test-results', 'upgrade-migration-matrix');
  if (RESULT_DIR !== expectedRoot) {
    throw new Error(`Refusing to clear unexpected result directory: ${RESULT_DIR}`);
  }

  rmSync(RESULT_DIR, { recursive: true, force: true });
  mkdirSync(RESULT_DIR, { recursive: true });
}

function replaceDatabaseName(databaseUrl: string, databaseName: string): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function getMaintenanceDatabaseUrl(databaseUrl: string): string {
  return replaceDatabaseName(databaseUrl, 'postgres');
}

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function loadMigrationEntries(): MigrationEntry[] {
  const journalPath = resolve(process.cwd(), 'drizzle', 'migrations', 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: MigrationEntry[] };

  return [...journal.entries].sort((left, right) => (left.idx ?? 0) - (right.idx ?? 0));
}

function entriesThrough(entries: MigrationEntry[], tag: string): MigrationEntry[] {
  const index = entries.findIndex((entry) => entry.tag === tag);
  if (index === -1) {
    throw new Error(`Migration tag was not found in journal: ${tag}`);
  }

  return entries.slice(0, index + 1);
}

function entriesAfter(entries: MigrationEntry[], tag: string): MigrationEntry[] {
  const index = entries.findIndex((entry) => entry.tag === tag);
  if (index === -1) {
    throw new Error(`Migration tag was not found in journal: ${tag}`);
  }

  return entries.slice(index + 1);
}

function readMigrationStatements(tag: string): string[] {
  const filePath = resolve(process.cwd(), 'drizzle', 'migrations', `${tag}.sql`);
  if (!existsSync(filePath)) {
    throw new Error(`Migration file was not found: ${filePath}`);
  }

  return readFileSync(filePath, 'utf8')
    .split('--> statement-breakpoint')
    .map((statement) =>
      statement
        .split(/\r?\n/)
        .filter((line) => {
          const trimmed = line.trim();
          return trimmed.length > 0 && !trimmed.startsWith('--');
        })
        .join('\n')
        .trim()
    )
    .filter(Boolean);
}

async function runMigrationEntries(sql: Sql, entries: MigrationEntry[]): Promise<void> {
  for (const entry of entries) {
    for (const statement of readMigrationStatements(entry.tag)) {
      await sql.unsafe(statement);
    }
  }
}

async function runStep(
  summary: UpgradeMigrationSummary,
  name: string,
  action: () => Promise<string | void>
): Promise<void> {
  const started = Date.now();
  const step: StepResult = { name, status: 'failed' };
  summary.steps.push(step);
  console.log(`Running ${name}`);

  try {
    const detail = await action();
    step.status = 'passed';
    step.durationMs = Date.now() - started;
    if (detail) {
      step.detail = detail;
    }
  } catch (error) {
    step.durationMs = Date.now() - started;
    step.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  }
}

async function recreateTestDatabase(
  databaseUrl: string,
  databaseName: string,
  prepare: boolean
): Promise<void> {
  if (prepare) {
    // Keep this local and non-destructive: it only starts the existing docker DB service.
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync(
      process.platform === 'win32' ? 'docker.cmd' : 'docker',
      ['compose', 'up', '-d', 'db'],
      { cwd: process.cwd(), stdio: 'inherit', env: process.env }
    );

    if (result.status !== 0) {
      throw new Error(`docker compose up -d db failed with status ${result.status}`);
    }
  }

  const admin = postgres(getMaintenanceDatabaseUrl(databaseUrl), { max: 1 });
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quoteIdent(databaseName)} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${quoteIdent(databaseName)}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function seedOldVersionFixture(sql: Sql) {
  const fixture = {
    userId: `upgrade-user-${randomUUID()}`,
    otherUserId: `upgrade-other-${randomUUID()}`,
    roleId: randomUUID(),
    planId: randomUUID(),
    entitlementId: randomUUID(),
    orderId: randomUUID(),
    creditLogId: randomUUID(),
    usageId: randomUUID(),
    auditId: randomUUID(),
    workspaceId: `upgrade-ws-${randomUUID()}`,
    ownerMemberId: `upgrade-member-owner-${randomUUID()}`,
    viewerMemberId: `upgrade-member-viewer-${randomUUID()}`,
    connectorId: `upgrade-connector-${randomUUID()}`,
    runId: `upgrade-run-${randomUUID()}`,
    artifactOwnerId: `upgrade-artifact-owner-${randomUUID()}`,
    artifactViewerId: `upgrade-artifact-viewer-${randomUUID()}`,
    entitlementKey: `upgrade.license.${randomUUID()}`,
  };
  const now = new Date();

  await sql`
    insert into "user" ("id", "email", "emailVerified", "name", "createdAt", "updatedAt")
    values
      (${fixture.userId}, 'upgrade-owner@example.com', true, 'Upgrade Owner', ${now}, ${now}),
      (${fixture.otherUserId}, 'upgrade-viewer@example.com', true, 'Upgrade Viewer', ${now}, ${now})
  `;
  await sql`
    insert into roles (id, name, slug, description, permissions, is_default, created_at, updated_at)
    values (
      ${fixture.roleId},
      'Upgrade Admin',
      'upgrade-admin',
      'Upgrade migration matrix role',
      ${['admin:access:all', 'reliability:read:all']},
      false,
      ${now},
      ${now}
    )
  `;
  await sql`
    insert into user_roles (id, user_id, role_id, granted_by, granted_at)
    values (${randomUUID()}, ${fixture.userId}, ${fixture.roleId}, 'upgrade-matrix', ${now})
  `;
  await sql`
    insert into entitlement_plans (
      id,
      name,
      slug,
      features,
      limits,
      pricing,
      sort_order,
      is_active,
      is_default,
      is_popular,
      metadata,
      stripe,
      lang_jsonb,
      created_at,
      updated_at
    )
    values (
      ${fixture.planId},
      'Upgrade Plan',
      'upgrade-plan',
      ${sql.json({ 'upgrade.feature': true })},
      ${sql.json({ monthly: { 'upgrade.units': 100 }, yearly: { 'upgrade.units': 1200 } })},
      ${sql.json({ currency: 'USD', monthly: 9 })},
      99,
      true,
      false,
      true,
      ${sql.json({ source: 'upgrade-matrix' })},
      ${sql.json({ priceIdMonthly: 'price_upgrade_matrix' })},
      ${sql.json({ en: { name: 'Upgrade Plan' } })},
      ${now},
      ${now}
    )
  `;
  await sql`
    insert into user_entitlements (
      id,
      user_id,
      plan_id,
      status,
      billing_interval,
      start_date,
      current_period_start,
      current_period_end,
      quota_period_start,
      quota_period_end,
      usage_metrics,
      metadata,
      created_at,
      updated_at
    )
    values (
      ${fixture.entitlementId},
      ${fixture.userId},
      ${fixture.planId},
      'active',
      'monthly',
      ${now},
      ${now},
      ${now},
      ${now},
      ${now},
      ${sql.json({ 'upgrade.units': 7 })},
      ${sql.json({ source: 'upgrade-matrix' })},
      ${now},
      ${now}
    )
  `;
  await sql`
    insert into orders (
      id,
      user_id,
      order_type,
      provider,
      provider_order_id,
      amount,
      currency,
      status,
      plan_id,
      metadata,
      created_at,
      updated_at
    )
    values (
      ${fixture.orderId},
      ${fixture.userId},
      'one_time_purchase',
      'local',
      ${`upgrade-order-${fixture.orderId}`},
      9.00,
      'USD',
      'succeeded',
      ${fixture.planId},
      ${sql.json({ source: 'upgrade-matrix' })},
      ${now},
      ${now}
    )
  `;
  await sql`
    insert into credit_logs (
      id,
      user_id,
      log_type,
      change_amount,
      balance_after,
      reason,
      related_order_id,
      entitlement_id,
      metadata,
      created_at
    )
    values (
      ${fixture.creditLogId},
      ${fixture.userId},
      'grant',
      25,
      ${sql.json({ credits: 25 })},
      'upgrade migration matrix',
      ${fixture.orderId},
      ${fixture.entitlementId},
      ${sql.json({ source: 'upgrade-matrix' })},
      ${now}
    )
  `;
  await sql`
    insert into usage_history (
      id,
      idempotency_key,
      user_id,
      plugin_id,
      metric,
      value,
      unit,
      metadata,
      recorded_at
    )
    values (
      ${fixture.usageId},
      ${`upgrade-usage-${fixture.usageId}`},
      ${fixture.userId},
      'upgrade-plugin',
      'matrix.units',
      7,
      'count',
      ${sql.json({ source: 'upgrade-matrix' })},
      ${now}
    )
  `;
  await sql`
    insert into audit_logs (
      id,
      user_id,
      user_email,
      action,
      resource,
      resource_id,
      status,
      metadata,
      created_at
    )
    values (
      ${fixture.auditId},
      ${fixture.userId},
      'upgrade-owner@example.com',
      'upgrade.matrix.seed',
      'upgrade_matrix',
      ${fixture.workspaceId},
      'success',
      ${sql.json({ source: 'upgrade-matrix' })},
      ${now}
    )
  `;
  await sql`
    insert into workspaces (id, name, slug, owner_user_id, status, metadata, created_at, updated_at)
    values (
      ${fixture.workspaceId},
      'Upgrade Workspace',
      ${`upgrade-${fixture.workspaceId.slice(-8)}`},
      ${fixture.userId},
      'active',
      ${sql.json({ source: 'upgrade-matrix' })},
      ${now},
      ${now}
    )
  `;
  await sql`
    insert into workspace_members (
      id,
      workspace_id,
      user_id,
      role,
      status,
      email,
      joined_at,
      created_at,
      updated_at
    )
    values
      (
        ${fixture.ownerMemberId},
        ${fixture.workspaceId},
        ${fixture.userId},
        'owner',
        'active',
        'upgrade-owner@example.com',
        ${now},
        ${now},
        ${now}
      ),
      (
        ${fixture.viewerMemberId},
        ${fixture.workspaceId},
        ${fixture.otherUserId},
        'viewer',
        'active',
        'upgrade-viewer@example.com',
        ${now},
        ${now},
        ${now}
      )
  `;
  await sql`
    insert into plugin_connectors (
      id,
      plugin_id,
      name,
      type,
      scope_type,
      scope_id,
      base_url,
      auth_type,
      secret_name,
      status,
      timeout_ms,
      retry_count,
      auth,
      egress,
      retry,
      redaction,
      metadata,
      created_at,
      updated_at
    )
    values (
      ${fixture.connectorId},
      'upgrade-plugin',
      'upgrade-api',
      'http',
      'workspace',
      ${fixture.workspaceId},
      'https://example.com',
      'bearer',
      'UPGRADE_TOKEN',
      'active',
      30000,
      2,
      ${sql.json({ type: 'bearer', secretName: 'UPGRADE_TOKEN' })},
      ${sql.json({ allowedHosts: ['example.com'] })},
      ${sql.json({ count: 2 })},
      ${sql.json({ requestHeaders: ['authorization'] })},
      ${sql.json({ source: 'upgrade-matrix' })},
      ${now},
      ${now}
    )
  `;
  await sql`
    insert into plugin_runs (
      id,
      plugin_id,
      user_id,
      scope_type,
      scope_id,
      title,
      status,
      progress,
      idempotency_key,
      metadata,
      visibility,
      inputs,
      costs,
      retry,
      created_at,
      updated_at
    )
    values (
      ${fixture.runId},
      'upgrade-plugin',
      ${fixture.userId},
      'workspace',
      ${fixture.workspaceId},
      'Upgrade Migration Run',
      'succeeded',
      100,
      ${`upgrade-run-${fixture.runId}`},
      ${sql.json({ source: 'upgrade-matrix' })},
      'user',
      ${sql.json([{ name: 'input', value: 'kept' }])},
      ${sql.json([{ meter: 'matrix.units', value: 7 }])},
      ${sql.json({ attempts: 1 })},
      ${now},
      ${now}
    )
  `;
  await sql`
    insert into plugin_artifacts (
      id,
      plugin_id,
      user_id,
      scope_type,
      scope_id,
      path,
      content_type,
      content,
      metadata,
      version,
      size,
      hash,
      created_at,
      updated_at
    )
    values
      (
        ${fixture.artifactOwnerId},
        'upgrade-plugin',
        ${fixture.userId},
        'workspace',
        ${fixture.workspaceId},
        'shared/owner.md',
        'text/markdown',
        'owner content',
        ${sql.json({ source: 'upgrade-matrix', owner: true })},
        1,
        13,
        'hash-owner',
        ${now},
        ${now}
      ),
      (
        ${fixture.artifactViewerId},
        'upgrade-plugin',
        ${fixture.otherUserId},
        'workspace',
        ${fixture.workspaceId},
        'shared/viewer.md',
        'text/markdown',
        'viewer content',
        ${sql.json({ source: 'upgrade-matrix', viewer: true })},
        1,
        14,
        'hash-viewer',
        ${now},
        ${now}
      )
  `;
  await sql`
    insert into digital_entitlements (
      id,
      user_id,
      plugin_id,
      entitlement_key,
      order_id,
      status,
      source_type,
      metadata,
      granted_at,
      created_at,
      updated_at
    )
    values (
      ${randomUUID()},
      ${fixture.userId},
      'upgrade-plugin',
      ${fixture.entitlementKey},
      ${fixture.orderId},
      'active',
      'one_time_purchase',
      ${sql.json({ source: 'upgrade-matrix' })},
      ${now},
      ${now},
      ${now}
    )
  `;

  return fixture;
}

async function readUpgradeChecks(sql: Sql, fixture: Record<string, string>) {
  const [counts] = await sql<
    {
      users: string;
      roles: string;
      userRoles: string;
      entitlements: string;
      orders: string;
      creditLogs: string;
      usage: string;
      audit: string;
      workspaces: string;
      members: string;
      connectors: string;
      runs: string;
      artifacts: string;
      digitalEntitlements: string;
    }[]
  >`
    select
      (select count(*)::int from "user" where id in (${fixture.userId}, ${fixture.otherUserId})) as users,
      (select count(*)::int from roles where id = ${fixture.roleId}) as "roles",
      (select count(*)::int from user_roles where user_id = ${fixture.userId} and role_id = ${fixture.roleId}) as "userRoles",
      (select count(*)::int from user_entitlements where id = ${fixture.entitlementId}) as entitlements,
      (select count(*)::int from orders where id = ${fixture.orderId}) as orders,
      (select count(*)::int from credit_logs where id = ${fixture.creditLogId}) as "creditLogs",
      (select count(*)::int from usage_history where id = ${fixture.usageId} and unit = 'count' and metadata->>'source' = 'upgrade-matrix') as usage,
      (select count(*)::int from audit_logs where id = ${fixture.auditId}) as audit,
      (select count(*)::int from workspaces where id = ${fixture.workspaceId}) as workspaces,
      (select count(*)::int from workspace_members where workspace_id = ${fixture.workspaceId}) as members,
      (select count(*)::int from plugin_connectors where id = ${fixture.connectorId} and auth->>'type' = 'bearer') as connectors,
      (select count(*)::int from plugin_runs where id = ${fixture.runId} and visibility = 'user' and jsonb_array_length(inputs) = 1) as runs,
      (select count(*)::int from plugin_artifacts where id in (${fixture.artifactOwnerId}, ${fixture.artifactViewerId})) as artifacts,
      (select count(*)::int from digital_entitlements where user_id = ${fixture.userId} and entitlement_key = ${fixture.entitlementKey}) as "digitalEntitlements"
  `;
  const indexes = await sql<{ indexname: string; indexdef: string }[]>`
    select indexname, indexdef
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'plugin_artifacts'
      and indexname in (
        'plugin_artifacts_active_path_idx',
        'plugin_artifacts_active_workspace_path_idx',
        'plugin_artifacts_active_user_path_idx',
        'plugin_artifacts_workspace_scope_idx'
      )
    order by indexname
  `;
  const columns = await sql<{ columnName: string }[]>`
    select column_name as "columnName"
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'plugin_artifacts'
    order by ordinal_position
  `;
  let duplicatePathAttempt = 'not-run';
  try {
    await sql`
      insert into plugin_artifacts (
        id,
        plugin_id,
        user_id,
        scope_type,
        scope_id,
        path,
        content_type,
        content,
        metadata,
        version,
        size,
        hash
      )
      values (
        ${`duplicate-${randomUUID()}`},
        'upgrade-plugin',
        ${fixture.otherUserId},
        'workspace',
        ${fixture.workspaceId},
        'shared/owner.md',
        'text/markdown',
        'duplicate content',
        ${sql.json({ source: 'upgrade-matrix', duplicate: true })},
        1,
        17,
        'hash-duplicate'
      )
    `;
    duplicatePathAttempt = 'unexpectedly-inserted';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    duplicatePathAttempt = message.includes('plugin_artifacts_active_workspace_path_idx')
      ? 'blocked-by-workspace-path-index'
      : `unexpected-error: ${message}`;
  }

  return {
    counts: Object.fromEntries(
      Object.entries(counts ?? {}).map(([key, value]) => [key, Number(value)])
    ),
    indexes,
    columns: columns.map((row) => row.columnName),
    duplicatePathAttempt,
  };
}

function assertChecks(checks: Awaited<ReturnType<typeof readUpgradeChecks>>) {
  const expectedCounts: Record<string, number> = {
    users: 2,
    roles: 1,
    userRoles: 1,
    entitlements: 1,
    orders: 1,
    creditLogs: 1,
    usage: 1,
    audit: 1,
    workspaces: 1,
    members: 2,
    connectors: 1,
    runs: 1,
    artifacts: 2,
    digitalEntitlements: 1,
  };

  for (const [key, expected] of Object.entries(expectedCounts)) {
    if (checks.counts[key] !== expected) {
      throw new Error(
        `Upgrade check failed for ${key}: expected ${expected}, got ${checks.counts[key]}`
      );
    }
  }

  const indexNames = new Set(checks.indexes.map((index) => index.indexname));
  for (const name of [
    'plugin_artifacts_active_workspace_path_idx',
    'plugin_artifacts_active_user_path_idx',
    'plugin_artifacts_workspace_scope_idx',
  ]) {
    if (!indexNames.has(name)) {
      throw new Error(`Expected upgraded index was not found: ${name}`);
    }
  }
  if (indexNames.has('plugin_artifacts_active_path_idx')) {
    throw new Error('Legacy plugin_artifacts_active_path_idx should be replaced after upgrade.');
  }
  if (checks.duplicatePathAttempt !== 'blocked-by-workspace-path-index') {
    throw new Error(`Unexpected duplicate path result: ${checks.duplicatePathAttempt}`);
  }
}

function writeSummary(summary: UpgradeMigrationSummary): void {
  summary.finishedAt = new Date().toISOString();
  writeFileSync(SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function writeReport(summary: UpgradeMigrationSummary): void {
  const passedSteps = summary.steps.filter((step) => step.status === 'passed').length;
  const failedSteps = summary.steps.filter((step) => step.status === 'failed').length;
  const rows = summary.steps
    .map(
      (step) =>
        `| ${step.name} | ${step.status} | ${step.durationMs ?? '-'} | ${step.detail ?? '-'} |`
    )
    .join('\n');

  writeFileSync(
    REPORT_PATH,
    [
      '# 升级迁移矩阵测试报告',
      '',
      `更新时间：${new Date().toISOString()}`,
      '',
      '## 结论',
      '',
      `- 状态：${summary.status}`,
      `- 来源数据库：${summary.sourceDatabaseUrl}`,
      `- 临时测试库：${summary.testDatabaseUrl}`,
      `- 迁移范围：${summary.options.fromTag} -> ${summary.options.targetTag}`,
      `- 步骤：${passedSteps} passed / ${failedSteps} failed`,
      '',
      '## 验收边界',
      '',
      '本报告用于 P1-10 升级迁移验收。测试在临时 Postgres 数据库中先执行上一验收版本迁移，再植入旧版真实形态数据，随后执行当前剩余迁移并核对数据、权限、workspace scope 与新增 schema contract。不验证业务 provider 的真实外部行为。',
      '',
      '## 覆盖能力',
      '',
      `- 旧版本 fixture：${summary.coverage.oldVersionFixture ? 'covered' : 'missing'}`,
      `- 当前剩余迁移：${summary.coverage.currentMigrations ? 'covered' : 'missing'}`,
      `- 数据保留：${summary.coverage.dataRetention ? 'covered' : 'missing'}`,
      `- 权限与角色保留：${summary.coverage.permissionRetention ? 'covered' : 'missing'}`,
      `- workspace artifact scope 新索引语义：${summary.coverage.workspaceArtifactScope ? 'covered' : 'missing'}`,
      `- 新 schema contract：${summary.coverage.newSchemaContract ? 'covered' : 'missing'}`,
      '',
      '## 步骤',
      '',
      '| 步骤 | 状态 | 耗时 ms | 细节 |',
      '| ---- | ---- | ------- | ---- |',
      rows,
      '',
      '## 证据文件',
      '',
      '- `test-results/upgrade-migration-matrix/summary.json`',
      '',
    ].join('\n'),
    'utf8'
  );
}

async function main(): Promise<void> {
  const options = parseOptions();
  const baseEnv = loadDockerDbEnv();
  const sourceDatabaseUrl = getDockerDatabaseUrl(baseEnv);
  const testDatabaseUrl = replaceDatabaseName(sourceDatabaseUrl, options.databaseName);
  const entries = loadMigrationEntries();
  const summary: UpgradeMigrationSummary = {
    status: 'failed',
    startedAt: new Date().toISOString(),
    sourceDatabaseUrl: maskDatabaseUrl(sourceDatabaseUrl),
    testDatabaseUrl: maskDatabaseUrl(testDatabaseUrl),
    options,
    coverage: {
      oldVersionFixture: true,
      currentMigrations: true,
      dataRetention: true,
      permissionRetention: true,
      workspaceArtifactScope: true,
      newSchemaContract: true,
    },
    steps: [],
  };

  resetResultDir();

  try {
    await runStep(summary, 'create isolated upgrade database', async () => {
      await recreateTestDatabase(sourceDatabaseUrl, options.databaseName, options.prepare);
      return options.databaseName;
    });

    const sql = postgres(testDatabaseUrl, { max: 1 });
    try {
      await runStep(summary, `migrate old fixture schema through ${options.fromTag}`, async () => {
        await runMigrationEntries(sql, entriesThrough(entries, options.fromTag));
        return `${entriesThrough(entries, options.fromTag).length} migrations`;
      });

      await runStep(summary, 'seed old-version data fixture', async () => {
        summary.fixture = await seedOldVersionFixture(sql);
        return `workspace=${summary.fixture.workspaceId}`;
      });

      await runStep(summary, `upgrade schema through ${options.targetTag}`, async () => {
        const remainingEntries = entriesAfter(entries, options.fromTag);
        await runMigrationEntries(sql, remainingEntries);
        return `${remainingEntries.length} migrations`;
      });

      await runStep(summary, 'verify upgraded data and schema contract', async () => {
        if (!summary.fixture) {
          throw new Error('Fixture was not seeded.');
        }
        summary.checks = await readUpgradeChecks(sql, summary.fixture);
        assertChecks(summary.checks as Awaited<ReturnType<typeof readUpgradeChecks>>);
        return 'data retained; workspace duplicate path blocked by upgraded index';
      });

      summary.status = 'passed';
    } finally {
      await sql.end({ timeout: 5 });
    }
  } catch (error) {
    summary.status = 'failed';
    summary.error = error instanceof Error ? error.stack || error.message : String(error);
    throw error;
  } finally {
    writeSummary(summary);
    writeReport(summary);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
