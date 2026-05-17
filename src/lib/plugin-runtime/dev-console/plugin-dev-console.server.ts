import fs from 'node:fs';
import path from 'node:path';
import { desc, like } from 'drizzle-orm';
import {
  checkPluginTargets,
  discoverPluginRoots,
  loadPluginDefinition,
  type PluginCheckReport,
  type PluginCheckResult,
} from '@/lib/plugin-runtime/checks';
import type { PluginDiagnostic } from '@/plugin-sdk/diagnostics';
import type { DefinedPlugin } from '@/plugin-sdk';
import { env } from '@/lib/_core/env';
import { db } from '@/lib/db';
import { webhookLogs } from '@/lib/db/schema';
import { getAuditPort, type AuditEvent } from '@/lib/audit/audit-port.server';
import { getUsageLedger, type UsageRecord } from '@/lib/usage/usage-ledger.server';
import { pluginQueryService } from '@/lib/plugins/plugin-query.server';
import {
  listJobs,
  listJobRuns,
  type JobDefinition,
  type JobRunRecord,
} from '@/lib/jobs/job-registry';
import { eventBus } from '@/lib/bus';
import { listPersistedPluginJobRuns } from '@/lib/jobs/job-run-store.server';
import type { RuntimeReport } from '@/lib/runtime';
import {
  getDefaultPluginDevTargets,
  listLegacyPluginDirectories,
  relativeToProject,
  toPluginDevPosix,
  type LegacyPluginDirectory,
} from './legacy-plugin-scan.server';

export type PluginActivityStatus = 'ok' | 'skipped' | 'failed';

export interface PluginActivitySection<TItem> {
  status: PluginActivityStatus;
  message: string;
  items: TItem[];
}

export interface PluginDevAuditItem {
  id: string;
  action: string;
  type: string;
  actorId?: string;
  timestamp: string;
}

export interface PluginDevUsageItem {
  id: string;
  category: string;
  amount: number;
  unit: string;
  userId: string;
  timestamp: string;
}

export interface PluginDevJobDefinition {
  name: string;
  priority: string;
  maxRetries: number;
  timeoutMs: number;
}

export interface PluginDevJobRun {
  id: string;
  jobName: string;
  status: string;
  attempts: number;
  startedAt: string;
  completedAt?: string;
  deadLetteredAt?: string;
  error?: string;
}

export interface PluginDevWebhookItem {
  id: string;
  eventType: string;
  status: string;
  createdAt: string;
  processedAt?: string;
  error?: string;
  retryCount?: number | null;
}

export interface PluginDevEventSubscription {
  event: string;
  handler?: string;
  registered: boolean;
  listeners: string[];
}

export interface PluginDevActivity {
  audit: PluginActivitySection<PluginDevAuditItem>;
  usage: PluginActivitySection<PluginDevUsageItem>;
  jobs: PluginActivitySection<PluginDevJobRun> & {
    registered: PluginDevJobDefinition[];
  };
  events: PluginActivitySection<PluginDevEventSubscription> & {
    publishes: string[];
    registered: string[];
  };
  webhooks: PluginActivitySection<PluginDevWebhookItem>;
}

export interface PluginDevInstallationStatus {
  status: 'installed' | 'missing' | 'unknown';
  enabled: boolean;
  version?: string;
  installedAt?: string;
  message: string;
}

export interface PluginDevDataCollection {
  name: string;
  fields: Array<{ name: string; definition: unknown }>;
  indexes: unknown[];
}

export interface PluginDevContractSummary {
  raw: unknown;
  id: string;
  name: string;
  version: string;
  description?: string;
  kind: string;
  trustLevel?: string;
  permissions: readonly string[];
  routes: {
    pages: unknown[];
    apis: unknown[];
  };
  menu: unknown[];
  slots: unknown[];
  data: {
    collections: PluginDevDataCollection[];
  };
  resources: {
    locales: Array<{ locale: string; path: string }>;
    assets: readonly unknown[];
  };
  config: unknown;
  lifecycle: Record<string, string>;
  events: {
    publishes: readonly string[];
    subscribes: Array<{ event: string; handler: string }>;
  };
  jobs: Array<{ name: string; definition: unknown }>;
  webhooks: Array<{ name: string; definition: unknown }>;
  egress: readonly string[];
}

export interface PluginDevPluginReport {
  pluginId: string;
  pluginPath: string;
  sourceTarget: string;
  success: boolean;
  filesScanned: number;
  diagnostics: PluginDiagnostic[];
  installation: PluginDevInstallationStatus;
  contract: PluginDevContractSummary | null;
  test: {
    files: string[];
    status: 'ready' | 'missing';
    command: string;
  };
  build: {
    artifactDir: string;
    reportExists: boolean;
    reportUpdatedAt?: string;
    command: string;
  };
  activity: PluginDevActivity;
}

export interface PluginDevTargetReport {
  targetPath: string;
  checked: number;
  success: boolean;
  diagnostics: PluginDiagnostic[];
}

export interface PluginDevConsoleReport {
  generatedAt: string;
  targetPaths: string[];
  targets: PluginDevTargetReport[];
  summary: {
    totalPlugins: number;
    passingPlugins: number;
    failingPlugins: number;
    diagnostics: number;
    errors: number;
    warnings: number;
    legacyPluginDirectories: number;
  };
  legacy: LegacyPluginDirectory[];
  runtime: RuntimeReport | null;
  plugins: PluginDevPluginReport[];
}

export interface PluginDevConsoleOptions {
  targetPaths?: string[];
  includeRuntime?: boolean;
  includeActivity?: boolean;
}

function hasDatabaseConfiguration(): boolean {
  if (env.NODE_ENV === 'test') {
    return false;
  }

  return Boolean(env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_HOST);
}

function asArray<T>(value: T | readonly T[] | undefined): T[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? Array.from(value as readonly T[]) : [value as T];
}

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return '[unserializable]';
  }
}

function getTestFiles(pluginRoot: string): string[] {
  const testDir = path.join(pluginRoot, 'tests');
  const files: string[] = [];

  if (!fs.existsSync(testDir)) {
    return files;
  }

  function walk(currentPath: string): void {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
        continue;
      }

      if (entry.isFile() && /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        files.push(relativeToProject(entryPath));
      }
    }
  }

  walk(testDir);
  return files;
}

function getBuildStatus(pluginId: string, pluginPath = `plugins/${pluginId}`) {
  const artifactDir = path.join(process.cwd(), '.ploykit-build', pluginId);
  const reportPath = path.join(artifactDir, 'build-report.json');
  const reportExists = fs.existsSync(reportPath);
  const stats = reportExists ? fs.statSync(reportPath) : null;

  return {
    artifactDir: relativeToProject(artifactDir),
    reportExists,
    reportUpdatedAt: stats?.mtime.toISOString(),
    command: `npm run plugin:build -- ${toPluginDevPosix(pluginPath)}`,
  };
}

function summarizeContract(contract: DefinedPlugin): PluginDevContractSummary {
  const collections = Object.entries(contract.data?.collections ?? {}).map(
    ([name, collection]) => ({
      name,
      fields: Object.entries(collection.fields).map(([fieldName, definition]) => ({
        name: fieldName,
        definition: safeJson(definition),
      })),
      indexes: safeJson(collection.indexes ?? []) as unknown[],
    })
  );
  const menus = asArray(contract.menu);

  return {
    raw: safeJson(contract),
    id: contract.id,
    name: contract.name,
    version: contract.version,
    description: contract.description,
    kind: contract.kind ?? 'app',
    trustLevel: contract.trustLevel,
    permissions: contract.permissions ?? [],
    routes: {
      pages: safeJson(contract.routes?.pages ?? []) as unknown[],
      apis: safeJson(contract.routes?.apis ?? []) as unknown[],
    },
    menu: safeJson(menus) as unknown[],
    slots: safeJson(
      Object.entries(contract.slots ?? {}).map(([slotName, declarations]) => ({
        slotName,
        declarations,
      }))
    ) as unknown[],
    data: {
      collections,
    },
    resources: {
      locales: Object.entries(contract.resources?.locales ?? {}).map(([locale, localePath]) => ({
        locale,
        path: localePath,
      })),
      assets: contract.resources?.assets ?? [],
    },
    config: safeJson(contract.config ?? contract.configSchema ?? null),
    lifecycle: { ...(contract.lifecycle ?? {}) },
    events: {
      publishes: contract.events?.publishes ?? [],
      subscribes: Object.entries(contract.events?.subscribes ?? {}).map(([event, handler]) => ({
        event,
        handler,
      })),
    },
    jobs: Object.entries(contract.jobs ?? {}).map(([name, definition]) => ({
      name,
      definition: safeJson(definition),
    })),
    webhooks: Object.entries(contract.webhooks ?? {}).map(([name, definition]) => ({
      name,
      definition: safeJson(definition),
    })),
    egress: contract.egress ?? [],
  };
}

function toAuditItem(event: AuditEvent): PluginDevAuditItem {
  return {
    id: event.id,
    action: event.action,
    type: event.type,
    actorId: event.actorId,
    timestamp: event.timestamp.toISOString(),
  };
}

function toUsageItem(record: UsageRecord): PluginDevUsageItem {
  return {
    id: record.id,
    category: record.category,
    amount: record.amount,
    unit: record.unit,
    userId: record.userId,
    timestamp: record.timestamp.toISOString(),
  };
}

function toJobDefinition(job: JobDefinition): PluginDevJobDefinition {
  return {
    name: job.name,
    priority: job.priority,
    maxRetries: job.maxRetries,
    timeoutMs: job.timeoutMs,
  };
}

function toJobRun(run: JobRunRecord): PluginDevJobRun {
  return {
    id: run.id,
    jobName: run.jobName,
    status: run.status,
    attempts: run.attempts,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString(),
    error: run.error,
  };
}

async function getAuditActivity(
  pluginId: string
): Promise<PluginActivitySection<PluginDevAuditItem>> {
  try {
    const events = await getAuditPort().query({ targetId: pluginId, limit: 5 });
    return {
      status: 'ok',
      message: `${events.length} audit record(s)`,
      items: events.map(toAuditItem),
    };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      items: [],
    };
  }
}

async function getUsageActivity(
  pluginId: string
): Promise<PluginActivitySection<PluginDevUsageItem>> {
  try {
    const records = await getUsageLedger().query({ limit: 100 });
    const pluginRecords = records
      .filter((record) => record.metadata?.pluginId === pluginId)
      .slice(0, 5);

    return {
      status: 'ok',
      message: `${pluginRecords.length} usage record(s)`,
      items: pluginRecords.map(toUsageItem),
    };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      items: [],
    };
  }
}

async function getJobActivity(pluginId: string): Promise<PluginDevActivity['jobs']> {
  const prefix = `${pluginId}.`;
  const registered = listJobs().filter((job) => job.name.startsWith(prefix));
  try {
    const persistedRuns = await listPersistedPluginJobRuns(pluginId, 5);

    if (persistedRuns.length > 0) {
      return {
        status: 'ok',
        message: `${registered.length} registered job(s), ${persistedRuns.length} persisted recent run(s)`,
        registered: registered.map(toJobDefinition),
        items: persistedRuns.map((run) => ({
          id: run.id,
          jobName: run.jobName,
          status: run.status,
          attempts: run.attempts,
          startedAt: run.startedAt.toISOString(),
          completedAt: run.completedAt?.toISOString(),
          deadLetteredAt: run.deadLetteredAt?.toISOString(),
          error: run.error ?? undefined,
        })),
      };
    }
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      registered: registered.map(toJobDefinition),
      items: [],
    };
  }

  const runs = listJobRuns()
    .filter((run) => run.jobName.startsWith(prefix))
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())
    .slice(0, 5);

  return {
    status: 'ok',
    message: `${registered.length} registered job(s), ${runs.length} recent run(s)`,
    registered: registered.map(toJobDefinition),
    items: runs.map(toJobRun),
  };
}

function getEventActivity(
  pluginId: string,
  contract: PluginDevContractSummary | null,
  enabled: boolean
): PluginDevActivity['events'] {
  const declared = contract?.events.subscribes ?? [];
  const registered = eventBus.getPluginSubscriptions(pluginId);
  const declaredEvents = new Set(declared.map((subscription) => subscription.event));
  const missing = declared.filter((subscription) => !registered.includes(subscription.event));
  const undeclaredRegistered = registered.filter((event) => !declaredEvents.has(event));

  const items: PluginDevEventSubscription[] = [
    ...declared.map((subscription) => ({
      event: subscription.event,
      handler: subscription.handler,
      registered: registered.includes(subscription.event),
      listeners: eventBus.getListeners(subscription.event),
    })),
    ...undeclaredRegistered.map((event) => ({
      event,
      registered: true,
      listeners: eventBus.getListeners(event),
    })),
  ];

  if (declared.length === 0 && (contract?.events.publishes.length ?? 0) === 0) {
    return {
      status: 'ok',
      message: 'No event declarations',
      publishes: [],
      registered,
      items,
    };
  }

  if (enabled && missing.length > 0) {
    return {
      status: 'failed',
      message: `${registered.length} registered subscription(s), ${missing.length} declared subscription(s) missing`,
      publishes: [...(contract?.events.publishes ?? [])],
      registered,
      items,
    };
  }

  return {
    status: 'ok',
    message: enabled
      ? `${registered.length} registered subscription(s)`
      : `${declared.length} declared subscription(s); registration waits for enable`,
    publishes: [...(contract?.events.publishes ?? [])],
    registered,
    items,
  };
}

async function getWebhookActivity(
  pluginId: string
): Promise<PluginActivitySection<PluginDevWebhookItem>> {
  if (!hasDatabaseConfiguration()) {
    return {
      status: 'skipped',
      message: 'Webhook receipts require a configured database',
      items: [],
    };
  }

  try {
    const rows = await db
      .select({
        id: webhookLogs.id,
        eventType: webhookLogs.eventType,
        status: webhookLogs.status,
        createdAt: webhookLogs.createdAt,
        processedAt: webhookLogs.processedAt,
        error: webhookLogs.error,
        retryCount: webhookLogs.retryCount,
      })
      .from(webhookLogs)
      .where(like(webhookLogs.eventType, `${pluginId}.%`))
      .orderBy(desc(webhookLogs.createdAt))
      .limit(5);

    return {
      status: 'ok',
      message: `${rows.length} webhook receipt(s)`,
      items: rows.map((row) => ({
        id: row.id,
        eventType: row.eventType,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        processedAt: row.processedAt?.toISOString(),
        error: row.error ?? undefined,
        retryCount: row.retryCount,
      })),
    };
  } catch (error) {
    return {
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
      items: [],
    };
  }
}

async function getPluginActivity(
  pluginId: string,
  contract: PluginDevContractSummary | null,
  installation: PluginDevInstallationStatus
): Promise<PluginDevActivity> {
  const [audit, usage, webhooks] = await Promise.all([
    getAuditActivity(pluginId),
    getUsageActivity(pluginId),
    getWebhookActivity(pluginId),
  ]);

  return {
    audit,
    usage,
    jobs: await getJobActivity(pluginId),
    events: getEventActivity(pluginId, contract, installation.enabled),
    webhooks,
  };
}

async function getInstallationStatus(pluginId: string): Promise<PluginDevInstallationStatus> {
  if (!hasDatabaseConfiguration()) {
    return {
      status: 'unknown',
      enabled: false,
      message: 'Installation state requires a configured database',
    };
  }

  try {
    const installation = await pluginQueryService.getInstallation(pluginId);
    if (!installation) {
      return {
        status: 'missing',
        enabled: false,
        message: 'Plugin is not installed; runtime routes will be blocked',
      };
    }

    return {
      status: 'installed',
      enabled: installation.enabled,
      version: installation.version,
      installedAt: installation.installedAt.toISOString(),
      message: installation.enabled
        ? 'Plugin is installed and enabled'
        : 'Plugin is installed but disabled; runtime routes will be blocked',
    };
  } catch (error) {
    return {
      status: 'unknown',
      enabled: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function emptyActivity(): PluginDevActivity {
  const skipped = { status: 'skipped' as const, message: 'Activity loading disabled', items: [] };
  return {
    audit: skipped,
    usage: skipped,
    jobs: { ...skipped, registered: [] },
    events: { ...skipped, publishes: [], registered: [] },
    webhooks: skipped,
  };
}

function targetName(targetPath: string): string {
  return relativeToProject(targetPath);
}

function getPluginResult(
  pluginResults: Map<string, PluginCheckResult>,
  pluginRoot: string
): PluginCheckResult | undefined {
  return pluginResults.get(relativeToProject(pluginRoot));
}

async function getRuntimeReport(includeRuntime: boolean): Promise<RuntimeReport | null> {
  if (!includeRuntime) {
    return null;
  }

  const runtime = await import('@/lib/runtime');
  return runtime.runReconcile();
}

export async function buildPluginDevConsoleReport(
  options: PluginDevConsoleOptions = {}
): Promise<PluginDevConsoleReport> {
  const targetPaths = options.targetPaths ?? getDefaultPluginDevTargets();
  const includeActivity = options.includeActivity ?? true;
  const targets: PluginDevTargetReport[] = [];
  const pluginResults = new Map<string, PluginCheckResult>();
  const sourceTargets = new Map<string, string>();
  const pluginRoots: string[] = [];

  for (const targetPath of targetPaths) {
    const checkReport: PluginCheckReport = await checkPluginTargets(targetPath);
    targets.push({
      targetPath: checkReport.targetPath,
      checked: checkReport.checked,
      success: checkReport.success,
      diagnostics: checkReport.diagnostics,
    });

    for (const result of checkReport.plugins) {
      pluginResults.set(result.pluginPath, result);
    }

    for (const root of discoverPluginRoots(targetPath)) {
      pluginRoots.push(root);
      sourceTargets.set(relativeToProject(root), targetName(targetPath));
    }
  }

  const plugins: PluginDevPluginReport[] = [];

  for (const pluginRoot of pluginRoots) {
    const result = getPluginResult(pluginResults, pluginRoot);
    let contract: PluginDevContractSummary | null = null;
    let pluginId = result?.pluginId ?? path.basename(pluginRoot);

    try {
      const definition = await loadPluginDefinition(pluginRoot, path.join(pluginRoot, 'plugin.ts'));
      pluginId = definition.id;
      contract = summarizeContract(definition);
    } catch {
      contract = null;
    }

    const pluginPath = relativeToProject(pluginRoot);
    const testFiles = getTestFiles(pluginRoot);
    const installation = await getInstallationStatus(pluginId);

    plugins.push({
      pluginId,
      pluginPath,
      sourceTarget: sourceTargets.get(pluginPath) ?? '',
      success: result?.success ?? false,
      filesScanned: result?.filesScanned ?? 0,
      diagnostics: result?.diagnostics ?? [],
      installation,
      contract,
      test: {
        files: testFiles,
        status: testFiles.length > 0 ? 'ready' : 'missing',
        command: `npm run plugin:test -- ${toPluginDevPosix(pluginPath)}`,
      },
      build: getBuildStatus(pluginId, pluginPath),
      activity: includeActivity
        ? await getPluginActivity(pluginId, contract, installation)
        : emptyActivity(),
    });
  }

  const allDiagnostics = plugins.flatMap((plugin) => plugin.diagnostics);
  const legacy = targetPaths.flatMap((targetPath) => listLegacyPluginDirectories(targetPath));
  const runtime = await getRuntimeReport(options.includeRuntime ?? false);

  return {
    generatedAt: new Date().toISOString(),
    targetPaths: targetPaths.map(relativeToProject),
    targets,
    summary: {
      totalPlugins: plugins.length,
      passingPlugins: plugins.filter((plugin) => plugin.success).length,
      failingPlugins: plugins.filter((plugin) => !plugin.success).length,
      diagnostics: allDiagnostics.length,
      errors: allDiagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
      warnings: allDiagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length,
      legacyPluginDirectories: legacy.length,
    },
    legacy,
    runtime,
    plugins,
  };
}
