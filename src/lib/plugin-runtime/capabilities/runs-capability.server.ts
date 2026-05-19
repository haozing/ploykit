import { randomUUID } from 'crypto';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  Permission,
  PluginError,
  type PluginFilePurpose,
  type PluginFileRecord,
  type PluginRunCostReference,
  type PluginRunLogRecord,
  type PluginRunReference,
  type PluginRunRecord,
  type PluginRunFiles,
  type PluginRunResultRecord,
  type PluginRunRetryPolicy,
  type PluginRunStatus,
  type PluginRunVisibility,
  type PluginRuns,
} from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import {
  pluginRunLogs,
  pluginRunResults,
  pluginRuns,
  type PluginFile,
  type NewPluginRun,
  type NewPluginRunLog,
  type NewPluginRunResult,
  type PluginRun,
  type PluginRunLog,
  type PluginRunResult,
} from '@/lib/db/schema/plugin-platform';
import {
  assertJsonSerializable,
  assertResourceScopeAccess,
  denormalizeResourceScope,
  enforceCapabilityPermission,
  normalizeResourceScope,
  requireUser,
  type NormalizedPluginResourceScope,
  type PluginCapabilityScope,
} from './guards.server';
import { recordCapabilityAudit } from './audit-helper.server';
import type { AuditPort } from '@/lib/audit/audit-port.server';
import {
  DbPluginFilesRepository,
  type PluginFilesRepository,
  type PluginFilesScope,
} from './files-capability.server';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

export interface PluginRunsScope {
  pluginId: string;
  userId: string;
}

export interface PluginRunsRepository {
  create(
    scope: PluginRunsScope,
    input: {
      title: string;
      resourceScope: NormalizedPluginResourceScope;
      visibility: PluginRunVisibility;
      inputs: PluginRunReference[];
      costs: PluginRunCostReference[];
      retry?: PluginRunRetryPolicy;
      metadata: Record<string, unknown>;
      idempotencyKey?: string;
    }
  ): Promise<PluginRun>;
  update(
    scope: PluginRunsScope,
    id: string,
    input: {
      status?: PluginRunStatus;
      progress?: number;
      metadata?: Record<string, unknown>;
      error?: Record<string, unknown> | null;
      cancelReason?: string;
      cancelRequestedAt?: Date;
      finishedAt?: Date;
    }
  ): Promise<PluginRun>;
  appendLog(scope: PluginRunsScope, id: string, input: NewPluginRunLog): Promise<PluginRunLog>;
  addResult(
    scope: PluginRunsScope,
    id: string,
    input: NewPluginRunResult
  ): Promise<PluginRunResult>;
  get(scope: PluginRunsScope, id: string): Promise<PluginRun | null>;
  getById?(scope: PluginRunsScope, id: string): Promise<PluginRun | null>;
  list(
    scope: PluginRunsScope,
    input: {
      resourceScope?: NormalizedPluginResourceScope;
      status?: PluginRunStatus;
      limit: number;
      offset: number;
    }
  ): Promise<PluginRun[]>;
  listResults(scope: PluginRunsScope, id: string): Promise<PluginRunResult[]>;
}

export interface CreatePluginRunsOptions {
  repository?: PluginRunsRepository;
  filesRepository?: PluginFilesRepository;
  auditPort?: AuditPort;
}

const RUN_STATUSES = new Set<PluginRunStatus>([
  'queued',
  'running',
  'waiting_external',
  'cancel_requested',
  'cancelled',
  'succeeded',
  'failed',
]);
const RUN_VISIBILITIES = new Set<PluginRunVisibility>(['user-visible', 'internal', 'admin-only']);

function resolveScope(scope: PluginCapabilityScope, capability: string): PluginRunsScope {
  const user = requireUser(scope, capability);
  return { pluginId: scope.contract.id, userId: user.id };
}

function resolveFileScope(scope: PluginCapabilityScope, capability: string): PluginFilesScope {
  const user = requireUser(scope, capability);
  return {
    pluginId: scope.contract.id,
    userId: user.id,
    userRole: user.role,
    system: scope.system,
  };
}

function normalizeTitle(title: string): string {
  const normalized = title.trim();
  if (!normalized || normalized.length > 200) {
    throw new PluginError({
      code: 'PLUGIN_RUN_TITLE_INVALID',
      message: 'Run title must be non-empty and at most 200 characters.',
      statusCode: 400,
    });
  }
  return normalized;
}

function normalizeProgress(progress: number | undefined): number | undefined {
  if (progress === undefined) return undefined;
  if (!Number.isFinite(progress)) {
    throw new PluginError({
      code: 'PLUGIN_RUN_PROGRESS_INVALID',
      message: 'Run progress must be a finite number.',
      statusCode: 400,
    });
  }
  return Math.min(Math.max(Math.round(progress), 0), 100);
}

function normalizeStatus(status: PluginRunStatus | undefined): PluginRunStatus | undefined {
  if (status === undefined) return undefined;
  if (!RUN_STATUSES.has(status)) {
    throw new PluginError({
      code: 'PLUGIN_RUN_STATUS_INVALID',
      message: `Run status "${status}" is invalid.`,
      statusCode: 400,
    });
  }
  return status;
}

function normalizeVisibility(visibility: PluginRunVisibility | undefined): PluginRunVisibility {
  const normalized = visibility ?? 'internal';
  if (!RUN_VISIBILITIES.has(normalized)) {
    throw new PluginError({
      code: 'PLUGIN_RUN_VISIBILITY_INVALID',
      message: `Run visibility "${String(visibility)}" is invalid.`,
      statusCode: 400,
    });
  }
  return normalized;
}

function normalizeRunReferences(
  references: PluginRunReference[] | undefined,
  label: string
): PluginRunReference[] {
  if (!references?.length) return [];
  if (references.length > 100) {
    throw new PluginError({
      code: 'PLUGIN_RUN_REFERENCES_INVALID',
      message: `${label} may include at most 100 references.`,
      statusCode: 400,
    });
  }
  return references.map((reference, index) => {
    const type = reference.type?.trim();
    const ref = reference.ref?.trim();
    if (!type || !ref) {
      throw new PluginError({
        code: 'PLUGIN_RUN_REFERENCES_INVALID',
        message: `${label} references require non-empty type and ref.`,
        statusCode: 400,
        details: { index },
      });
    }
    const metadata = reference.metadata ?? {};
    assertJsonSerializable(metadata, `${label} reference metadata`);
    return {
      type,
      ref,
      label: reference.label?.trim() || undefined,
      metadata,
    };
  });
}

function normalizeRunCosts(costs: PluginRunCostReference[] | undefined): PluginRunCostReference[] {
  if (!costs?.length) return [];
  if (costs.length > 100) {
    throw new PluginError({
      code: 'PLUGIN_RUN_COSTS_INVALID',
      message: 'Run costs may include at most 100 references.',
      statusCode: 400,
    });
  }
  return costs.map((cost, index) => {
    const metadata = cost.metadata ?? {};
    assertJsonSerializable(metadata, 'Run cost metadata');
    if (
      cost.amount !== undefined &&
      (typeof cost.amount !== 'number' || !Number.isFinite(cost.amount))
    ) {
      throw new PluginError({
        code: 'PLUGIN_RUN_COSTS_INVALID',
        message: 'Run cost amount must be a finite number.',
        statusCode: 400,
        details: { index },
      });
    }
    return {
      meter: cost.meter?.trim() || undefined,
      usageId: cost.usageId?.trim() || undefined,
      creditId: cost.creditId?.trim() || undefined,
      connectorCallId: cost.connectorCallId?.trim() || undefined,
      amount: cost.amount,
      unit: cost.unit?.trim() || undefined,
      metadata,
    };
  });
}

function normalizeRunRetry(
  retry: PluginRunRetryPolicy | undefined
): PluginRunRetryPolicy | undefined {
  if (!retry) return undefined;
  const maxAttempts = retry.maxAttempts;
  const retryAfterSeconds = retry.retryAfterSeconds;
  if (
    maxAttempts !== undefined &&
    (!Number.isInteger(maxAttempts) || maxAttempts < 0 || maxAttempts > 20)
  ) {
    throw new PluginError({
      code: 'PLUGIN_RUN_RETRY_INVALID',
      message: 'Run retry maxAttempts must be an integer between 0 and 20.',
      statusCode: 400,
    });
  }
  if (
    retryAfterSeconds !== undefined &&
    (!Number.isInteger(retryAfterSeconds) || retryAfterSeconds < 0)
  ) {
    throw new PluginError({
      code: 'PLUGIN_RUN_RETRY_INVALID',
      message: 'Run retryAfterSeconds must be a non-negative integer.',
      statusCode: 400,
    });
  }
  return {
    allowed: retry.allowed,
    maxAttempts,
    retryAfterSeconds,
  };
}

function readArrayMetadata<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function readRecordMetadata<T>(value: unknown): T | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : undefined;
}

function toRun(row: PluginRun): PluginRunRecord {
  return {
    id: row.id,
    scope: denormalizeResourceScope({
      type: row.scopeType as 'user' | 'workspace',
      id: row.scopeId,
    }),
    title: row.title,
    visibility: RUN_VISIBILITIES.has(row.visibility as PluginRunVisibility)
      ? (row.visibility as PluginRunVisibility)
      : 'internal',
    status: row.status as PluginRunStatus,
    progress: row.progress,
    inputs: readArrayMetadata<PluginRunReference>(row.inputs),
    results: [],
    costs: readArrayMetadata<PluginRunCostReference>(row.costs),
    retry: readRecordMetadata<PluginRunRetryPolicy>(row.retry),
    cancelReason: row.cancelReason ?? undefined,
    cancelRequestedAt: row.cancelRequestedAt ?? undefined,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt ?? undefined,
    finishedAt: row.finishedAt ?? undefined,
  };
}

function toFileRecord(row: PluginFile): PluginFileRecord {
  return {
    id: row.id,
    scope: denormalizeResourceScope({
      type: row.scopeType as 'user' | 'workspace',
      id: row.scopeId,
    }),
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size,
    hash: row.hash ?? undefined,
    purpose: row.purpose as PluginFilePurpose,
    status: row.status as PluginFileRecord['status'],
    visibility: row.visibility as PluginFileRecord['visibility'],
    publicUrl:
      row.visibility === 'public' && row.publicId
        ? `/api/plugin-media/${encodeURIComponent(row.pluginId)}/${encodeURIComponent(row.publicId)}/${encodeURIComponent(row.publicFileName || row.fileName)}`
        : undefined,
    contentDisposition: row.contentDisposition as PluginFileRecord['contentDisposition'],
    runId: row.runId ?? undefined,
    metadata: row.metadata,
    expiresAt: row.expiresAt ?? undefined,
    uploadedAt: row.uploadedAt ?? undefined,
    publishedAt: row.publishedAt ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function groupRunFiles(rows: PluginFile[]): PluginRunFiles {
  const groups: PluginRunFiles = {
    inputs: [],
    outputs: [],
    temp: [],
  };

  for (const row of rows) {
    const record = toFileRecord(row);
    if (record.purpose === 'source') {
      groups.inputs.push(record);
    } else if (record.purpose === 'result') {
      groups.outputs.push(record);
    } else {
      groups.temp.push(record);
    }
  }

  return groups;
}

function toRunWithFiles(row: PluginRun, files?: PluginRunFiles): PluginRunRecord {
  const run = toRun(row);
  return files ? { ...run, files } : run;
}

function toRunLog(row: PluginRunLog): PluginRunLogRecord {
  return {
    id: row.id,
    runId: row.runId,
    level: row.level as PluginRunLogRecord['level'],
    message: row.message,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}

function toRunResult(row: PluginRunResult): PluginRunResultRecord {
  return {
    id: row.id,
    runId: row.runId,
    type: row.type,
    ref: row.ref,
    metadata: row.metadata,
    createdAt: row.createdAt,
  };
}

function toRunReferenceFromResult(row: PluginRunResult): PluginRunReference {
  const metadata = row.metadata ?? {};
  const label = typeof metadata.label === 'string' ? metadata.label : undefined;
  return {
    type: row.type,
    ref: row.ref,
    label,
    metadata,
  };
}

export class DbPluginRunsRepository implements PluginRunsRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inPlugin<T>(
    scope: PluginRunsScope,
    fn: (executor: Executor) => Promise<T>
  ): Promise<T> {
    if (this.executor !== db) {
      return fn(this.executor);
    }

    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', ${scope.userId}, true)`);
      await tx.execute(sql`SELECT set_config('app.current_plugin_id', ${scope.pluginId}, true)`);
      return fn(tx);
    });
  }

  async create(
    scope: PluginRunsScope,
    input: {
      title: string;
      resourceScope: NormalizedPluginResourceScope;
      visibility: PluginRunVisibility;
      inputs: PluginRunReference[];
      costs: PluginRunCostReference[];
      retry?: PluginRunRetryPolicy;
      metadata: Record<string, unknown>;
      idempotencyKey?: string;
    }
  ) {
    return this.inPlugin(scope, async (executor) => {
      if (input.idempotencyKey) {
        const [existing] = await executor
          .select()
          .from(pluginRuns)
          .where(
            and(
              eq(pluginRuns.pluginId, scope.pluginId),
              eq(pluginRuns.userId, scope.userId),
              eq(pluginRuns.idempotencyKey, input.idempotencyKey)
            )
          )
          .limit(1);
        if (existing) return existing;
      }

      const [row] = await executor
        .insert(pluginRuns)
        .values({
          id: randomUUID(),
          pluginId: scope.pluginId,
          userId: scope.userId,
          scopeType: input.resourceScope.type,
          scopeId: input.resourceScope.id,
          title: input.title,
          visibility: input.visibility,
          status: 'queued',
          progress: 0,
          inputs: input.inputs as unknown as Record<string, unknown>[],
          costs: input.costs as unknown as Record<string, unknown>[],
          retry: input.retry as unknown as Record<string, unknown>,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata,
        } satisfies NewPluginRun)
        .returning();
      return row;
    });
  }

  async update(
    scope: PluginRunsScope,
    id: string,
    input: {
      status?: PluginRunStatus;
      progress?: number;
      metadata?: Record<string, unknown>;
      error?: Record<string, unknown> | null;
      cancelReason?: string;
      cancelRequestedAt?: Date;
      finishedAt?: Date;
    }
  ) {
    return this.inPlugin(scope, async (executor) => {
      const [row] = await executor
        .update(pluginRuns)
        .set({
          status: input.status,
          progress: input.progress,
          metadata: input.metadata,
          error: input.error ?? undefined,
          cancelReason: input.cancelReason,
          cancelRequestedAt: input.cancelRequestedAt,
          finishedAt: input.finishedAt,
          startedAt:
            input.status === 'running' || input.status === 'waiting_external'
              ? new Date()
              : undefined,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pluginRuns.pluginId, scope.pluginId),
            eq(pluginRuns.userId, scope.userId),
            eq(pluginRuns.id, id)
          )
        )
        .returning();

      if (!row) {
        throw new PluginError({
          code: 'PLUGIN_RUN_NOT_FOUND',
          message: `Run "${id}" was not found.`,
          statusCode: 404,
        });
      }

      return row;
    });
  }

  async appendLog(scope: PluginRunsScope, id: string, input: NewPluginRunLog) {
    await this.getOrThrow(scope, id);
    return this.inPlugin(scope, async (executor) => {
      const [row] = await executor.insert(pluginRunLogs).values(input).returning();
      return row;
    });
  }

  async addResult(scope: PluginRunsScope, id: string, input: NewPluginRunResult) {
    await this.getOrThrow(scope, id);
    return this.inPlugin(scope, async (executor) => {
      const [row] = await executor.insert(pluginRunResults).values(input).returning();
      return row;
    });
  }

  async get(scope: PluginRunsScope, id: string) {
    return this.inPlugin(scope, async (executor) => {
      const [row] = await executor
        .select()
        .from(pluginRuns)
        .where(
          and(
            eq(pluginRuns.pluginId, scope.pluginId),
            eq(pluginRuns.userId, scope.userId),
            eq(pluginRuns.id, id)
          )
        )
        .limit(1);
      return row ?? null;
    });
  }

  async getById(scope: PluginRunsScope, id: string) {
    return this.inPlugin(scope, async (executor) => {
      const [row] = await executor
        .select()
        .from(pluginRuns)
        .where(and(eq(pluginRuns.pluginId, scope.pluginId), eq(pluginRuns.id, id)))
        .limit(1);
      return row ?? null;
    });
  }

  async listResults(scope: PluginRunsScope, id: string) {
    await this.getOrThrow(scope, id);
    return this.inPlugin(scope, async (executor) => {
      return executor
        .select()
        .from(pluginRunResults)
        .where(eq(pluginRunResults.runId, id))
        .orderBy(desc(pluginRunResults.createdAt));
    });
  }

  private async getOrThrow(scope: PluginRunsScope, id: string): Promise<PluginRun> {
    const row = await this.get(scope, id);
    if (!row) {
      throw new PluginError({
        code: 'PLUGIN_RUN_NOT_FOUND',
        message: `Run "${id}" was not found.`,
        statusCode: 404,
      });
    }
    return row;
  }

  async list(
    scope: PluginRunsScope,
    input: {
      resourceScope?: NormalizedPluginResourceScope;
      status?: PluginRunStatus;
      limit: number;
      offset: number;
    }
  ) {
    return this.inPlugin(scope, async (executor) => {
      const conditions: SQL[] = [eq(pluginRuns.pluginId, scope.pluginId)];
      if (input.resourceScope) {
        conditions.push(eq(pluginRuns.scopeType, input.resourceScope.type));
        conditions.push(eq(pluginRuns.scopeId, input.resourceScope.id));
      } else {
        conditions.push(eq(pluginRuns.userId, scope.userId));
      }
      if (input.status) {
        conditions.push(eq(pluginRuns.status, input.status));
      }

      return executor
        .select()
        .from(pluginRuns)
        .where(and(...conditions))
        .orderBy(desc(pluginRuns.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    });
  }
}

export function createPluginRunsCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginRunsOptions = {}
): PluginRuns {
  const repository = options.repository ?? new DbPluginRunsRepository();
  const filesRepository =
    options.filesRepository ?? (!options.repository ? new DbPluginFilesRepository() : undefined);

  async function listFilesForRun(row: PluginRun): Promise<PluginRunFiles | undefined> {
    if (!filesRepository) {
      return undefined;
    }

    const resourceScope = {
      type: row.scopeType as 'user' | 'workspace',
      id: row.scopeId,
    } satisfies NormalizedPluginResourceScope;
    const rows = await filesRepository.list(resolveFileScope(scope, 'ctx.runs.get'), {
      resourceScope,
      runId: row.id,
      limit: 200,
      offset: 0,
    });

    return groupRunFiles(rows);
  }

  async function withTaskCenterDetails(row: PluginRun): Promise<PluginRunRecord> {
    const [files, results] = await Promise.all([
      listFilesForRun(row),
      repository.listResults(resolveScope(scope, 'ctx.runs.get'), row.id),
    ]);
    return {
      ...toRunWithFiles(row, files),
      results: results.map(toRunReferenceFromResult),
    };
  }

  return {
    async create(input) {
      enforceCapabilityPermission(scope, Permission.RunsWrite, 'ctx.runs.create');
      const runScope = resolveScope(scope, 'ctx.runs.create');
      const metadata = input.metadata ?? {};
      assertJsonSerializable(metadata, 'Run metadata');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.runs.create');
      await assertResourceScopeAccess(scope, resourceScope, 'write', 'ctx.runs.create');
      const row = await repository.create(runScope, {
        title: normalizeTitle(input.title),
        resourceScope,
        visibility: normalizeVisibility(input.visibility),
        inputs: normalizeRunReferences(input.inputs, 'Run input'),
        costs: normalizeRunCosts(input.costs),
        retry: normalizeRunRetry(input.retry),
        metadata,
        idempotencyKey: input.idempotencyKey,
      });
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.runs.create`,
        { runId: row.id, scope: { type: row.scopeType, id: row.scopeId } },
        options.auditPort
      );
      return withTaskCenterDetails(row);
    },

    async update(id, input) {
      enforceCapabilityPermission(scope, Permission.RunsWrite, 'ctx.runs.update');
      const runScope = resolveScope(scope, 'ctx.runs.update');
      const existing =
        (await repository.getById?.(runScope, id)) ?? (await repository.get(runScope, id));
      if (!existing) {
        throw new PluginError({
          code: 'PLUGIN_RUN_NOT_FOUND',
          message: `Run "${id}" was not found.`,
          statusCode: 404,
        });
      }
      await assertResourceScopeAccess(
        scope,
        { type: existing.scopeType as 'user' | 'workspace', id: existing.scopeId },
        'write',
        'ctx.runs.update'
      );
      if (input.metadata) assertJsonSerializable(input.metadata, 'Run metadata');
      const row = await repository.update(runScope, id, {
        status: normalizeStatus(input.status),
        progress: normalizeProgress(input.progress),
        metadata: input.metadata,
      });
      return withTaskCenterDetails(row);
    },

    async appendLog(id, input) {
      enforceCapabilityPermission(scope, Permission.RunsWrite, 'ctx.runs.appendLog');
      const runScope = resolveScope(scope, 'ctx.runs.appendLog');
      const existing =
        (await repository.getById?.(runScope, id)) ?? (await repository.get(runScope, id));
      if (!existing) {
        throw new PluginError({
          code: 'PLUGIN_RUN_NOT_FOUND',
          message: `Run "${id}" was not found.`,
          statusCode: 404,
        });
      }
      await assertResourceScopeAccess(
        scope,
        { type: existing.scopeType as 'user' | 'workspace', id: existing.scopeId },
        'write',
        'ctx.runs.appendLog'
      );
      const metadata = input.metadata ?? {};
      assertJsonSerializable(metadata, 'Run log metadata');
      const row = await repository.appendLog(runScope, id, {
        id: randomUUID(),
        runId: id,
        level: input.level,
        message: input.message,
        metadata,
      });
      return toRunLog(row);
    },

    async addResult(id, input) {
      enforceCapabilityPermission(scope, Permission.RunsWrite, 'ctx.runs.addResult');
      const runScope = resolveScope(scope, 'ctx.runs.addResult');
      const existing =
        (await repository.getById?.(runScope, id)) ?? (await repository.get(runScope, id));
      if (!existing) {
        throw new PluginError({
          code: 'PLUGIN_RUN_NOT_FOUND',
          message: `Run "${id}" was not found.`,
          statusCode: 404,
        });
      }
      await assertResourceScopeAccess(
        scope,
        { type: existing.scopeType as 'user' | 'workspace', id: existing.scopeId },
        'write',
        'ctx.runs.addResult'
      );
      const metadata = input.metadata ?? {};
      assertJsonSerializable(metadata, 'Run result metadata');
      const row = await repository.addResult(runScope, id, {
        id: randomUUID(),
        runId: id,
        type: input.type,
        ref: input.ref,
        metadata: input.label ? { ...metadata, label: input.label } : metadata,
      });
      return toRunResult(row);
    },

    async complete(id, metadata) {
      enforceCapabilityPermission(scope, Permission.RunsWrite, 'ctx.runs.complete');
      const runScope = resolveScope(scope, 'ctx.runs.complete');
      const existing =
        (await repository.getById?.(runScope, id)) ?? (await repository.get(runScope, id));
      if (!existing) {
        throw new PluginError({
          code: 'PLUGIN_RUN_NOT_FOUND',
          message: `Run "${id}" was not found.`,
          statusCode: 404,
        });
      }
      await assertResourceScopeAccess(
        scope,
        { type: existing.scopeType as 'user' | 'workspace', id: existing.scopeId },
        'write',
        'ctx.runs.complete'
      );
      if (metadata) assertJsonSerializable(metadata, 'Run completion metadata');
      return withTaskCenterDetails(
        await repository.update(runScope, id, {
          status: 'succeeded',
          progress: 100,
          metadata,
          finishedAt: new Date(),
        })
      );
    },

    async fail(id, error) {
      enforceCapabilityPermission(scope, Permission.RunsWrite, 'ctx.runs.fail');
      const runScope = resolveScope(scope, 'ctx.runs.fail');
      const existing =
        (await repository.getById?.(runScope, id)) ?? (await repository.get(runScope, id));
      if (!existing) {
        throw new PluginError({
          code: 'PLUGIN_RUN_NOT_FOUND',
          message: `Run "${id}" was not found.`,
          statusCode: 404,
        });
      }
      await assertResourceScopeAccess(
        scope,
        { type: existing.scopeType as 'user' | 'workspace', id: existing.scopeId },
        'write',
        'ctx.runs.fail'
      );
      const errorPayload = { code: error.code, message: error.message, metadata: error.metadata };
      assertJsonSerializable(errorPayload, 'Run error');
      return withTaskCenterDetails(
        await repository.update(runScope, id, {
          status: 'failed',
          error: errorPayload,
          finishedAt: new Date(),
        })
      );
    },

    async requestCancel(id, reason) {
      enforceCapabilityPermission(scope, Permission.RunsWrite, 'ctx.runs.requestCancel');
      const runScope = resolveScope(scope, 'ctx.runs.requestCancel');
      const existing =
        (await repository.getById?.(runScope, id)) ?? (await repository.get(runScope, id));
      if (!existing) {
        throw new PluginError({
          code: 'PLUGIN_RUN_NOT_FOUND',
          message: `Run "${id}" was not found.`,
          statusCode: 404,
        });
      }
      await assertResourceScopeAccess(
        scope,
        { type: existing.scopeType as 'user' | 'workspace', id: existing.scopeId },
        'write',
        'ctx.runs.requestCancel'
      );
      return withTaskCenterDetails(
        await repository.update(runScope, id, {
          status: 'cancel_requested',
          cancelReason: reason,
          cancelRequestedAt: new Date(),
        })
      );
    },

    async get(id) {
      enforceCapabilityPermission(scope, Permission.RunsRead, 'ctx.runs.get');
      const runScope = resolveScope(scope, 'ctx.runs.get');
      const row =
        (await repository.getById?.(runScope, id)) ?? (await repository.get(runScope, id));
      if (row) {
        await assertResourceScopeAccess(
          scope,
          { type: row.scopeType as 'user' | 'workspace', id: row.scopeId },
          'read',
          'ctx.runs.get'
        );
      }
      return row ? withTaskCenterDetails(row) : null;
    },

    async list(input = {}) {
      enforceCapabilityPermission(scope, Permission.RunsRead, 'ctx.runs.list');
      const runScope = resolveScope(scope, 'ctx.runs.list');
      const resourceScope = input.scope
        ? normalizeResourceScope(scope, input.scope, 'ctx.runs.list')
        : undefined;
      if (resourceScope) {
        await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.runs.list');
      }
      const rows = await repository.list(runScope, {
        resourceScope,
        status: normalizeStatus(input.status),
        limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
        offset: Math.max(input.offset ?? 0, 0),
      });
      return rows
        .filter((row) => row.userId === runScope.userId || row.visibility === 'user-visible')
        .map(toRun);
    },
  };
}
