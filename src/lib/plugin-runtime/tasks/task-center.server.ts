import { randomUUID } from 'crypto';
import { and, desc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type {
  PluginConnectorAuthProfile,
  PluginConnectorEgressPolicy,
  PluginConnectorRecord,
  PluginConnectorRedactionPolicy,
  PluginConnectorRetryPolicy,
  PluginRunCostReference,
  PluginRunReference,
  PluginRunStatus,
  PluginRunVisibility,
} from '@ploykit/plugin-sdk';
import { ForbiddenError, NotFoundError, ValidationError } from '@/lib/_core/errors';
import { db, withSystemContext, type Database } from '@/lib/db';
import { usageHistory, type UsageHistoryRecord } from '@/lib/db/schema/entitlement';
import {
  pluginConnectorCallLogs,
  pluginConnectors,
  pluginFiles,
  pluginRunLogs,
  pluginRunResults,
  pluginRuns,
  type NewPluginConnector,
  type PluginConnector,
  type PluginConnectorCallLog,
  type PluginFile,
  type PluginRun,
  type PluginRunLog,
  type PluginRunResult,
} from '@/lib/db/schema/plugin-platform';
import { getPluginRuntimeMapEntry } from '../loader';
import { pluginRuntimeRegistry } from '../registry';
import { DbPluginSecretsRepository } from '../capabilities/secrets-capability.server';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

const ACTIVE_RUN_STATUSES: PluginRunStatus[] = ['queued', 'running', 'waiting_external'];
const RUN_STATUSES: PluginRunStatus[] = [
  'queued',
  'running',
  'waiting_external',
  'cancel_requested',
  'cancelled',
  'succeeded',
  'failed',
];

export const pluginTaskListQuerySchema = z.object({
  pluginId: z.string().min(1).max(120).optional(),
  status: z.enum(RUN_STATUSES as [PluginRunStatus, ...PluginRunStatus[]]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  includeInternal: z.coerce.boolean().optional().default(false),
});

export const adminPluginTaskListQuerySchema = pluginTaskListQuerySchema.extend({
  userId: z.string().min(1).max(200).optional(),
});

export const pluginTaskParamsSchema = z.object({
  id: z.string().min(1).max(200),
});

export const pluginRunCancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const adminConnectorListQuerySchema = z.object({
  pluginId: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const connectorStatusSchema = z.enum(['active', 'disabled']);
const connectorAuthSchema = z
  .object({
    type: z.enum(['none', 'bearer', 'basic', 'apiKey', 'oauth2', 'custom']),
    secretName: z.string().min(1).max(120).optional(),
    headerName: z.string().min(1).max(120).optional(),
    authorizeUrl: z.string().url().optional(),
    tokenUrl: z.string().url().optional(),
    scopes: z.array(z.string().min(1).max(120)).max(50).optional(),
  })
  .passthrough();
const connectorPolicySchema = z.record(z.string(), z.unknown()).optional();

export const adminConnectorActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('setStatus'),
    pluginId: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    status: connectorStatusSchema,
  }),
  z.object({
    action: z.literal('rotateSecret'),
    pluginId: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    secretName: z.string().min(1).max(120),
    value: z.string().min(1).max(10000),
    userId: z.string().max(200).optional(),
  }),
  z.object({
    action: z.literal('upsert'),
    pluginId: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    type: z.string().min(1).max(80).optional(),
    baseUrl: z.string().url(),
    status: connectorStatusSchema.optional(),
    auth: connectorAuthSchema.optional(),
    egress: connectorPolicySchema,
    retry: connectorPolicySchema,
    redaction: connectorPolicySchema,
    timeoutMs: z.number().int().min(100).max(300000).optional(),
    retryCount: z.number().int().min(0).max(5).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    action: z.literal('test'),
    pluginId: z.string().min(1).max(120),
    name: z.string().min(1).max(120),
    path: z.string().min(1).max(500).default('/'),
    method: z.string().min(1).max(20).default('GET'),
  }),
]);

export type PluginTaskListQuery = z.infer<typeof pluginTaskListQuerySchema>;
export type AdminPluginTaskListQuery = z.infer<typeof adminPluginTaskListQuerySchema>;
export type AdminConnectorActionInput = z.infer<typeof adminConnectorActionSchema>;

export interface PluginTaskSummary {
  id: string;
  pluginId: string;
  pluginName: string;
  userId: string | null;
  scopeType: string;
  scopeId: string;
  title: string;
  visibility: PluginRunVisibility;
  status: PluginRunStatus;
  progress: number;
  inputs: PluginRunReference[];
  costs: PluginRunCostReference[];
  retry?: Record<string, unknown>;
  metadata: Record<string, unknown>;
  error?: Record<string, unknown>;
  cancelReason?: string;
  cancelRequestedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PluginTaskDetail extends PluginTaskSummary {
  logs: PluginTaskLog[];
  results: PluginTaskResult[];
  files: PluginTaskFile[];
  connectorCalls: PluginTaskConnectorCall[];
  usage: PluginTaskUsage[];
}

export interface PluginTaskLog {
  id: string;
  runId: string;
  level: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PluginTaskResult {
  id: string;
  runId: string;
  type: string;
  ref: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PluginTaskFile {
  id: string;
  pluginId: string;
  fileName: string;
  contentType: string;
  size: number;
  purpose: string;
  status: string;
  runId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  uploadedAt?: string;
  expiresAt?: string;
}

export interface PluginTaskConnectorCall {
  id: string;
  pluginId: string;
  connectorName: string;
  userId: string | null;
  runId?: string;
  method: string;
  url: string;
  status: number | null;
  ok: boolean;
  durationMs: number | null;
  meter?: string;
  creditsConsumed: number;
  requestMetadata: Record<string, unknown>;
  responseMetadata: Record<string, unknown>;
  error?: Record<string, unknown>;
  createdAt: string;
}

export interface PluginTaskUsage {
  id: string;
  idempotencyKey: string;
  userId: string;
  pluginId: string;
  metric: string;
  value: number;
  unit: string;
  meter?: string;
  metadata: Record<string, unknown>;
  recordedAt: string;
}

export interface PluginOperationsSummary {
  runs: {
    total: number;
    active: number;
    failed: number;
    succeeded: number;
    cancelRequested: number;
  };
  connectors: {
    total: number;
    active: number;
    disabled: number;
    recentFailures: number;
  };
  metering: {
    records: number;
    totalAmount: number;
  };
}

export interface AdminPluginOperationsReport {
  summary: PluginOperationsSummary;
  tasks: PluginTaskSummary[];
  connectorCalls: PluginTaskConnectorCall[];
  usage: PluginTaskUsage[];
  meters: AdminMeterUsage[];
}

export interface AdminMeterUsage {
  pluginId: string;
  meter: string;
  metric: string;
  unit: string;
  total: number;
  records: number;
}

export interface AdminConnectorSummary extends PluginConnectorRecord {
  id: string;
  pluginId: string;
  createdAt: string;
  updatedAt: string;
  recentCalls: PluginTaskConnectorCall[];
}

function toDateString(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function resolvePluginName(pluginId: string): Promise<string> {
  try {
    const entry = getPluginRuntimeMapEntry(pluginId);
    const contract = await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
    return contract.name || pluginId;
  } catch {
    return pluginId;
  }
}

async function resolvePluginNames(pluginIds: Iterable<string>): Promise<Map<string, string>> {
  const entries = await Promise.all(
    [...new Set(pluginIds)].map(async (pluginId) => [pluginId, await resolvePluginName(pluginId)])
  );
  return new Map(entries as Array<[string, string]>);
}

function toTaskSummary(row: PluginRun, pluginName: string): PluginTaskSummary {
  return {
    id: row.id,
    pluginId: row.pluginId,
    pluginName,
    userId: row.userId ?? null,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    title: row.title,
    visibility: row.visibility as PluginRunVisibility,
    status: row.status as PluginRunStatus,
    progress: row.progress,
    inputs: readArray<PluginRunReference>(row.inputs),
    costs: readArray<PluginRunCostReference>(row.costs),
    retry: row.retry ? readRecord(row.retry) : undefined,
    metadata: readRecord(row.metadata),
    error: row.error ? readRecord(row.error) : undefined,
    cancelReason: row.cancelReason ?? undefined,
    cancelRequestedAt: toDateString(row.cancelRequestedAt),
    startedAt: toDateString(row.startedAt),
    finishedAt: toDateString(row.finishedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTaskLog(row: PluginRunLog): PluginTaskLog {
  return {
    id: row.id,
    runId: row.runId,
    level: row.level,
    message: row.message,
    metadata: readRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
  };
}

function toTaskResult(row: PluginRunResult): PluginTaskResult {
  return {
    id: row.id,
    runId: row.runId,
    type: row.type,
    ref: row.ref,
    metadata: readRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
  };
}

function toTaskFile(row: PluginFile): PluginTaskFile {
  return {
    id: row.id,
    pluginId: row.pluginId,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size,
    purpose: row.purpose,
    status: row.status,
    runId: row.runId ?? undefined,
    metadata: readRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    uploadedAt: toDateString(row.uploadedAt),
    expiresAt: toDateString(row.expiresAt),
  };
}

function toConnectorCall(row: PluginConnectorCallLog): PluginTaskConnectorCall {
  return {
    id: row.id,
    pluginId: row.pluginId,
    connectorName: row.connectorName,
    userId: row.userId ?? null,
    runId: row.runId ?? undefined,
    method: row.method,
    url: row.url,
    status: row.status ?? null,
    ok: row.ok === 'true',
    durationMs: row.durationMs ?? null,
    meter: row.meter ?? undefined,
    creditsConsumed: row.creditsConsumed,
    requestMetadata: readRecord(row.requestMetadata),
    responseMetadata: readRecord(row.responseMetadata),
    error: row.error ? readRecord(row.error) : undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function toTaskUsage(row: UsageHistoryRecord): PluginTaskUsage {
  const metadata = readRecord(row.metadata);
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    userId: row.userId,
    pluginId: row.pluginId,
    metric: row.metric,
    value: row.value,
    unit: row.unit,
    meter: typeof metadata.meter === 'string' ? metadata.meter : undefined,
    metadata,
    recordedAt: row.recordedAt.toISOString(),
  };
}

function connectorAuthProfile(row: PluginConnector): PluginConnectorAuthProfile {
  const auth = readRecord(row.auth);
  if (typeof auth.type === 'string') {
    return auth as unknown as PluginConnectorAuthProfile;
  }
  if (!row.secretName || row.authType === 'none') {
    return { type: 'none' };
  }
  return { type: row.authType as 'bearer', secretName: row.secretName };
}

function toConnectorSummary(
  row: PluginConnector,
  calls: PluginTaskConnectorCall[]
): AdminConnectorSummary {
  return {
    id: row.id,
    pluginId: row.pluginId,
    name: row.name,
    type: row.type,
    baseUrl: row.baseUrl,
    status: row.status === 'disabled' ? 'disabled' : 'active',
    auth: connectorAuthProfile(row),
    egress: readRecord(row.egress) as PluginConnectorEgressPolicy,
    retry: readRecord(row.retry) as PluginConnectorRetryPolicy,
    redaction: readRecord(row.redaction) as PluginConnectorRedactionPolicy,
    authType: row.authType,
    secretName: row.secretName ?? undefined,
    timeoutMs: row.timeoutMs,
    retryCount: row.retryCount,
    metadata: readRecord(row.metadata),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    recentCalls: calls.filter(
      (call) => call.pluginId === row.pluginId && call.connectorName === row.name
    ),
  };
}

function userTaskWhere(userId: string, input: PluginTaskListQuery, id?: string): SQL | undefined {
  const conditions: SQL[] = [
    eq(pluginRuns.userId, userId),
    input.includeInternal
      ? ne(pluginRuns.visibility, 'admin-only')
      : eq(pluginRuns.visibility, 'user-visible'),
  ];
  if (id) conditions.push(eq(pluginRuns.id, id));
  if (input.pluginId) conditions.push(eq(pluginRuns.pluginId, input.pluginId));
  if (input.status) conditions.push(eq(pluginRuns.status, input.status));
  return and(...conditions);
}

function adminTaskWhere(input: AdminPluginTaskListQuery, id?: string): SQL | undefined {
  const conditions: SQL[] = [];
  if (id) conditions.push(eq(pluginRuns.id, id));
  if (input.pluginId) conditions.push(eq(pluginRuns.pluginId, input.pluginId));
  if (input.userId) conditions.push(eq(pluginRuns.userId, input.userId));
  if (input.status) conditions.push(eq(pluginRuns.status, input.status));
  return conditions.length > 0 ? and(...conditions) : undefined;
}

async function mapTaskSummaries(rows: PluginRun[]): Promise<PluginTaskSummary[]> {
  const pluginNames = await resolvePluginNames(rows.map((row) => row.pluginId));
  return rows.map((row) => toTaskSummary(row, pluginNames.get(row.pluginId) ?? row.pluginId));
}

async function loadTaskDetail(row: PluginRun, userScoped: boolean): Promise<PluginTaskDetail> {
  const pluginName = await resolvePluginName(row.pluginId);
  const [logs, results, files, calls, usageRows] = await withSystemContext(async (database) => {
    const usageConditions: SQL[] = [
      eq(usageHistory.pluginId, row.pluginId),
      sql`${usageHistory.metadata}->>'runId' = ${row.id}`,
    ];
    if (userScoped && row.userId) {
      usageConditions.push(eq(usageHistory.userId, row.userId));
    }

    return Promise.all([
      database
        .select()
        .from(pluginRunLogs)
        .where(eq(pluginRunLogs.runId, row.id))
        .orderBy(desc(pluginRunLogs.createdAt))
        .limit(200),
      database
        .select()
        .from(pluginRunResults)
        .where(eq(pluginRunResults.runId, row.id))
        .orderBy(desc(pluginRunResults.createdAt))
        .limit(100),
      database
        .select()
        .from(pluginFiles)
        .where(and(eq(pluginFiles.runId, row.id), isNull(pluginFiles.deletedAt)))
        .orderBy(desc(pluginFiles.createdAt))
        .limit(100),
      database
        .select()
        .from(pluginConnectorCallLogs)
        .where(eq(pluginConnectorCallLogs.runId, row.id))
        .orderBy(desc(pluginConnectorCallLogs.createdAt))
        .limit(100),
      database
        .select()
        .from(usageHistory)
        .where(and(...usageConditions))
        .orderBy(desc(usageHistory.recordedAt))
        .limit(200),
    ]);
  });

  return {
    ...toTaskSummary(row, pluginName),
    logs: logs.map(toTaskLog),
    results: results.map(toTaskResult),
    files: files.map(toTaskFile),
    connectorCalls: calls.map(toConnectorCall),
    usage: usageRows.map(toTaskUsage),
  };
}

export async function listUserPluginTasks(
  userId: string,
  input: PluginTaskListQuery
): Promise<PluginTaskSummary[]> {
  const rows = await withSystemContext((database) =>
    database
      .select()
      .from(pluginRuns)
      .where(userTaskWhere(userId, input))
      .orderBy(desc(pluginRuns.updatedAt))
      .limit(input.limit)
      .offset(input.offset)
  );
  return mapTaskSummaries(rows);
}

export async function getUserPluginTask(
  userId: string,
  id: string,
  options: { includeInternal?: boolean } = {}
): Promise<PluginTaskDetail> {
  const [row] = await withSystemContext((database) =>
    database
      .select()
      .from(pluginRuns)
      .where(
        userTaskWhere(
          userId,
          { limit: 1, offset: 0, includeInternal: Boolean(options.includeInternal) },
          id
        )
      )
      .limit(1)
  );
  if (!row) {
    throw new NotFoundError('Plugin task', id);
  }
  return loadTaskDetail(row, true);
}

export async function requestUserPluginTaskCancel(
  userId: string,
  id: string,
  reason?: string
): Promise<PluginTaskDetail> {
  const [existing] = await withSystemContext((database) =>
    database
      .select()
      .from(pluginRuns)
      .where(userTaskWhere(userId, { limit: 1, offset: 0, includeInternal: false }, id))
      .limit(1)
  );

  if (!existing) {
    throw new NotFoundError('Plugin task', id);
  }

  if (!ACTIVE_RUN_STATUSES.includes(existing.status as PluginRunStatus)) {
    throw new ValidationError('Only active plugin tasks can be cancelled.', {
      runId: id,
      status: existing.status,
    });
  }

  const [row] = await withSystemContext((database) =>
    database
      .update(pluginRuns)
      .set({
        status: 'cancel_requested',
        cancelReason: reason,
        cancelRequestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(pluginRuns.id, id), eq(pluginRuns.userId, userId)))
      .returning()
  );

  return loadTaskDetail(row, true);
}

export async function listAdminPluginTasks(
  input: AdminPluginTaskListQuery
): Promise<PluginTaskSummary[]> {
  const rows = await withSystemContext(async (database) => {
    const where = adminTaskWhere(input);
    return where
      ? database
          .select()
          .from(pluginRuns)
          .where(where)
          .orderBy(desc(pluginRuns.updatedAt))
          .limit(input.limit)
          .offset(input.offset)
      : database
          .select()
          .from(pluginRuns)
          .orderBy(desc(pluginRuns.updatedAt))
          .limit(input.limit)
          .offset(input.offset);
  });
  return mapTaskSummaries(rows);
}

export async function getAdminPluginTask(id: string): Promise<PluginTaskDetail> {
  const [row] = await withSystemContext((database) =>
    database.select().from(pluginRuns).where(eq(pluginRuns.id, id)).limit(1)
  );
  if (!row) {
    throw new NotFoundError('Plugin task', id);
  }
  return loadTaskDetail(row, false);
}

export async function requestAdminPluginTaskCancel(
  id: string,
  reason?: string
): Promise<PluginTaskDetail> {
  const [existing] = await withSystemContext((database) =>
    database.select().from(pluginRuns).where(eq(pluginRuns.id, id)).limit(1)
  );
  if (!existing) {
    throw new NotFoundError('Plugin task', id);
  }

  if (!ACTIVE_RUN_STATUSES.includes(existing.status as PluginRunStatus)) {
    throw new ValidationError('Only active plugin tasks can be cancelled.', {
      runId: id,
      status: existing.status,
    });
  }

  const [row] = await withSystemContext((database) =>
    database
      .update(pluginRuns)
      .set({
        status: 'cancel_requested',
        cancelReason: reason,
        cancelRequestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(pluginRuns.id, id))
      .returning()
  );
  return loadTaskDetail(row, false);
}

export async function buildAdminPluginOperationsReport(
  input: AdminPluginTaskListQuery = { limit: 50, offset: 0, includeInternal: true }
): Promise<AdminPluginOperationsReport> {
  const [tasks, statsRows, connectorsStats, callRows, usageRows, meterRows] =
    await withSystemContext(async (database) => {
      const taskWhere = adminTaskWhere(input);
      const taskQuery = taskWhere
        ? database
            .select()
            .from(pluginRuns)
            .where(taskWhere)
            .orderBy(desc(pluginRuns.updatedAt))
            .limit(input.limit)
            .offset(input.offset)
        : database
            .select()
            .from(pluginRuns)
            .orderBy(desc(pluginRuns.updatedAt))
            .limit(input.limit)
            .offset(input.offset);

      return Promise.all([
        taskQuery,
        database
          .select({
            total: sql<number>`count(*)::int`,
            active: sql<number>`count(*) filter (where ${pluginRuns.status} in ('queued', 'running', 'waiting_external'))::int`,
            failed: sql<number>`count(*) filter (where ${pluginRuns.status} = 'failed')::int`,
            succeeded: sql<number>`count(*) filter (where ${pluginRuns.status} = 'succeeded')::int`,
            cancelRequested: sql<number>`count(*) filter (where ${pluginRuns.status} = 'cancel_requested')::int`,
          })
          .from(pluginRuns),
        database
          .select({
            total: sql<number>`count(*)::int`,
            active: sql<number>`count(*) filter (where ${pluginConnectors.status} = 'active')::int`,
            disabled: sql<number>`count(*) filter (where ${pluginConnectors.status} = 'disabled')::int`,
          })
          .from(pluginConnectors),
        database
          .select()
          .from(pluginConnectorCallLogs)
          .orderBy(desc(pluginConnectorCallLogs.createdAt))
          .limit(50),
        database.select().from(usageHistory).orderBy(desc(usageHistory.recordedAt)).limit(100),
        database
          .select({
            pluginId: usageHistory.pluginId,
            meter: sql<string>`coalesce(${usageHistory.metadata}->>'meter', ${usageHistory.metric})`,
            metric: usageHistory.metric,
            unit: usageHistory.unit,
            total: sql<number>`coalesce(sum(${usageHistory.value}), 0)::int`,
            records: sql<number>`count(*)::int`,
          })
          .from(usageHistory)
          .groupBy(
            usageHistory.pluginId,
            sql`coalesce(${usageHistory.metadata}->>'meter', ${usageHistory.metric})`,
            usageHistory.metric,
            usageHistory.unit
          )
          .orderBy(desc(sql`coalesce(sum(${usageHistory.value}), 0)`))
          .limit(50),
      ]);
    });

  const connectorCalls = callRows.map(toConnectorCall);
  const usage = usageRows.map(toTaskUsage);
  const failedCalls = connectorCalls.filter((call) => !call.ok).length;
  return {
    summary: {
      runs: statsRows[0] ?? {
        total: 0,
        active: 0,
        failed: 0,
        succeeded: 0,
        cancelRequested: 0,
      },
      connectors: {
        total: connectorsStats[0]?.total ?? 0,
        active: connectorsStats[0]?.active ?? 0,
        disabled: connectorsStats[0]?.disabled ?? 0,
        recentFailures: failedCalls,
      },
      metering: {
        records: usage.length,
        totalAmount: usage.reduce((sum, row) => sum + row.value, 0),
      },
    },
    tasks: await mapTaskSummaries(tasks),
    connectorCalls,
    usage,
    meters: meterRows.map((row) => ({
      pluginId: row.pluginId,
      meter: row.meter,
      metric: row.metric,
      unit: row.unit,
      total: row.total,
      records: row.records,
    })),
  };
}

export async function listAdminConnectors(
  input: z.infer<typeof adminConnectorListQuerySchema>
): Promise<AdminConnectorSummary[]> {
  const [rows, calls] = await withSystemContext(async (database) =>
    Promise.all([
      input.pluginId
        ? database
            .select()
            .from(pluginConnectors)
            .where(eq(pluginConnectors.pluginId, input.pluginId))
            .orderBy(desc(pluginConnectors.updatedAt))
            .limit(input.limit)
        : database
            .select()
            .from(pluginConnectors)
            .orderBy(desc(pluginConnectors.updatedAt))
            .limit(input.limit),
      input.pluginId
        ? database
            .select()
            .from(pluginConnectorCallLogs)
            .where(eq(pluginConnectorCallLogs.pluginId, input.pluginId))
            .orderBy(desc(pluginConnectorCallLogs.createdAt))
            .limit(100)
        : database
            .select()
            .from(pluginConnectorCallLogs)
            .orderBy(desc(pluginConnectorCallLogs.createdAt))
            .limit(100),
    ])
  );
  const callSummaries = calls.map(toConnectorCall);
  return rows.map((row) => toConnectorSummary(row, callSummaries));
}

function validateConnectorName(name: string): string {
  const normalized = name.trim();
  if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new ValidationError(
      'Connector name may only contain letters, numbers, dots, underscores, colons, and hyphens.'
    );
  }
  return normalized;
}

function validatePluginId(pluginId: string): string {
  const normalized = pluginId.trim();
  if (!/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new ValidationError('Plugin id is invalid.');
  }
  return normalized;
}

function normalizeConnectorAuth(value: unknown): PluginConnectorAuthProfile {
  const auth = readRecord(value);
  const type = typeof auth.type === 'string' ? auth.type : 'none';
  if (type === 'none') return { type: 'none' };
  const secretName = typeof auth.secretName === 'string' ? auth.secretName.trim() : '';
  if (!secretName) {
    throw new ValidationError('Connector auth profiles require secretName.');
  }
  if (type === 'bearer' || type === 'basic') return { type, secretName };
  if (type === 'apiKey') {
    return {
      type,
      secretName,
      headerName: typeof auth.headerName === 'string' ? auth.headerName : undefined,
    };
  }
  if (type === 'oauth2') {
    return {
      type,
      secretName,
      authorizeUrl: typeof auth.authorizeUrl === 'string' ? auth.authorizeUrl : undefined,
      tokenUrl: typeof auth.tokenUrl === 'string' ? auth.tokenUrl : undefined,
      scopes: Array.isArray(auth.scopes)
        ? auth.scopes.filter((item): item is string => typeof item === 'string')
        : undefined,
    };
  }
  if (type === 'custom') {
    const headerName = typeof auth.headerName === 'string' ? auth.headerName.trim() : '';
    if (!headerName) {
      throw new ValidationError('Custom connector auth requires headerName.');
    }
    return { type, secretName, headerName };
  }
  throw new ValidationError(`Connector auth type "${type}" is not supported.`);
}

function authType(auth: PluginConnectorAuthProfile): string {
  return auth.type;
}

function secretName(auth: PluginConnectorAuthProfile): string | undefined {
  return auth.type === 'none' ? undefined : auth.secretName;
}

async function getConnectorOrThrow(
  database: Executor,
  pluginId: string,
  name: string
): Promise<PluginConnector> {
  const [row] = await database
    .select()
    .from(pluginConnectors)
    .where(and(eq(pluginConnectors.pluginId, pluginId), eq(pluginConnectors.name, name)))
    .limit(1);
  if (!row) {
    throw new NotFoundError('Plugin connector', `${pluginId}:${name}`);
  }
  return row;
}

export async function handleAdminConnectorAction(
  input: AdminConnectorActionInput
): Promise<{ connector?: AdminConnectorSummary; test?: Record<string, unknown>; success: true }> {
  const pluginId = validatePluginId(input.pluginId);

  if (input.action === 'rotateSecret') {
    const connectorName = validateConnectorName(input.name);
    await withSystemContext(async (database) => {
      await getConnectorOrThrow(database, pluginId, connectorName);
      const repository = new DbPluginSecretsRepository(database);
      await repository.set(
        { pluginId, userId: input.userId?.trim() ?? '', system: !input.userId },
        input.secretName,
        input.value
      );
    });
    const connector = (await listAdminConnectors({ pluginId, limit: 100 })).find(
      (item) => item.name === connectorName
    );
    return { success: true, connector };
  }

  if (input.action === 'setStatus') {
    const connectorName = validateConnectorName(input.name);
    const [row] = await withSystemContext((database) =>
      database
        .update(pluginConnectors)
        .set({ status: input.status, updatedAt: new Date() })
        .where(
          and(eq(pluginConnectors.pluginId, pluginId), eq(pluginConnectors.name, connectorName))
        )
        .returning()
    );
    if (!row) {
      throw new NotFoundError('Plugin connector', `${pluginId}:${connectorName}`);
    }
    return { success: true, connector: toConnectorSummary(row, []) };
  }

  if (input.action === 'upsert') {
    const connectorName = validateConnectorName(input.name);
    const auth = normalizeConnectorAuth(input.auth ?? { type: 'none' });
    const now = new Date();
    const values = {
      id: randomUUID(),
      pluginId,
      name: connectorName,
      type: input.type?.trim() || 'http',
      baseUrl: input.baseUrl.replace(/\/+$/, ''),
      auth: auth as unknown as Record<string, unknown>,
      authType: authType(auth),
      secretName: secretName(auth),
      egress: readRecord(input.egress),
      retry: readRecord(input.retry),
      redaction: readRecord(input.redaction),
      status: input.status ?? 'active',
      timeoutMs: input.timeoutMs ?? 30000,
      retryCount: input.retryCount ?? 0,
      metadata: readRecord(input.metadata),
      createdAt: now,
      updatedAt: now,
    } satisfies NewPluginConnector;

    const [row] = await withSystemContext((database) =>
      database
        .insert(pluginConnectors)
        .values(values)
        .onConflictDoUpdate({
          target: [
            pluginConnectors.pluginId,
            pluginConnectors.name,
            pluginConnectors.scopeType,
            pluginConnectors.scopeId,
          ],
          set: {
            type: values.type,
            baseUrl: values.baseUrl,
            auth: values.auth,
            authType: values.authType,
            secretName: values.secretName,
            egress: values.egress,
            retry: values.retry,
            redaction: values.redaction,
            status: values.status,
            timeoutMs: values.timeoutMs,
            retryCount: values.retryCount,
            metadata: values.metadata,
            updatedAt: now,
          },
        })
        .returning()
    );
    return { success: true, connector: toConnectorSummary(row, []) };
  }

  if (input.action === 'test') {
    const connectorName = validateConnectorName(input.name);
    const row = await withSystemContext((database) =>
      getConnectorOrThrow(database, pluginId, connectorName)
    );
    if (row.status === 'disabled') {
      throw new ForbiddenError('Disabled connectors cannot be tested.');
    }
    const target = new URL(input.path, row.baseUrl);
    return {
      success: true,
      test: {
        pluginId,
        connector: connectorName,
        method: input.method.toUpperCase(),
        url: target.toString(),
        egress: readRecord(row.egress),
        status: 'prepared',
      },
    };
  }

  return { success: true };
}
