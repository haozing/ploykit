import { createHash, randomUUID } from 'crypto';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import {
  Permission,
  PluginError,
  type PluginFileCreateUploadInput,
  type PluginFilePurpose,
  type PluginFileRecord,
  type PluginFileStatus,
  type PluginFiles,
} from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import { pluginFiles, type NewPluginFile, type PluginFile } from '@/lib/db/schema/plugin-platform';
import { getInitializedBlobStore } from '@/lib/services/storage/init.server';
import type { BlobStore } from '@/lib/services/storage/blob-store';
import type { AuditPort } from '@/lib/audit/audit-port.server';
import { createPluginFileSignedUrl } from '@/lib/plugin-runtime/files/plugin-file-signing.server';
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

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

export interface PluginFilesScope {
  pluginId: string;
  userId: string;
  userRole: 'admin' | 'user';
  system?: boolean;
}

export type PluginFileAccessAction = 'read' | 'write' | 'delete';

export interface PluginFilesUsage {
  fileCount: number;
  storageBytes: number;
  dailyUploadBytes: number;
}

export interface PluginFilesRepository {
  createPending(
    scope: PluginFilesScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      fileName: string;
      contentType: string;
      size: number;
      purpose: PluginFilePurpose;
      storageKey: string;
      runId?: string;
      expiresAt?: Date;
      metadata: Record<string, unknown>;
    }
  ): Promise<PluginFile>;
  complete(
    scope: PluginFilesScope,
    input: {
      fileId: string;
      storageKey?: string;
      size: number;
      hash?: string;
      contentType?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<PluginFile>;
  get(scope: PluginFilesScope, id: string): Promise<PluginFile | null>;
  list(
    scope: PluginFilesScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      purpose?: PluginFilePurpose;
      status?: PluginFileStatus;
      runId?: string;
      limit: number;
      offset: number;
    }
  ): Promise<PluginFile[]>;
  getUsage(
    scope: PluginFilesScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      uploadedSince?: Date;
    }
  ): Promise<PluginFilesUsage>;
  archive(scope: PluginFilesScope, id: string): Promise<PluginFile>;
  softDelete(scope: PluginFilesScope, id: string): Promise<PluginFile>;
}

export interface PluginFilesQuota {
  maxFileSizeBytes: number;
  maxFilesPerScope?: number;
  maxStorageBytesPerScope?: number;
  maxDailyUploadBytesPerScope?: number;
}

export interface PluginFilesHost {
  getBlobStore(): BlobStore;
  createSignedUrl(input: {
    file: PluginFile;
    operation: 'upload' | 'download';
    expiresInSeconds: number;
  }): Promise<string>;
  getQuota(
    scope: PluginFilesScope,
    resourceScope: NormalizedPluginResourceScope
  ): Promise<PluginFilesQuota>;
  authorizeScope(
    scope: PluginFilesScope,
    resourceScope: NormalizedPluginResourceScope,
    action: PluginFileAccessAction
  ): Promise<void>;
}

export interface CreatePluginFilesOptions {
  repository?: PluginFilesRepository;
  host?: Partial<PluginFilesHost>;
  auditPort?: AuditPort;
}

const VALID_PURPOSES = new Set<PluginFilePurpose>(['source', 'result', 'temp']);
const VALID_STATUSES = new Set<PluginFileStatus>([
  'pending_upload',
  'ready',
  'archived',
  'deleted',
]);
const DEFAULT_MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const MAX_FILE_NAME_LENGTH = 255;
const DAILY_UPLOAD_WINDOW_MS = 24 * 60 * 60 * 1000;

function createDefaultHost(host?: Partial<PluginFilesHost>): PluginFilesHost {
  return {
    getBlobStore: getInitializedBlobStore,
    async createSignedUrl(input) {
      return createPluginFileSignedUrl({
        file: input.file,
        operation: input.operation,
        expiresInSeconds: input.expiresInSeconds,
      });
    },
    async getQuota() {
      return { maxFileSizeBytes: DEFAULT_MAX_FILE_SIZE_BYTES };
    },
    async authorizeScope() {
      return undefined;
    },
    ...host,
  };
}

function resolveScope(scope: PluginCapabilityScope, capability: string): PluginFilesScope {
  const user = requireUser(scope, capability);
  return {
    pluginId: scope.contract.id,
    userId: user.id,
    userRole: user.role,
    system: scope.system,
  };
}

function fileActionToResourceAction(action: PluginFileAccessAction): 'read' | 'write' | 'delete' {
  return action === 'read' ? 'read' : action === 'write' ? 'write' : 'delete';
}

function createDefaultFileScopeAuthorizer(capabilityScope: PluginCapabilityScope) {
  return async (
    _scope: PluginFilesScope,
    resourceScope: NormalizedPluginResourceScope,
    action: PluginFileAccessAction
  ) =>
    assertResourceScopeAccess(
      capabilityScope,
      resourceScope,
      fileActionToResourceAction(action),
      'ctx.files'
    );
}

function fileResourceScope(file: PluginFile): NormalizedPluginResourceScope {
  if (file.scopeType === 'user' || file.scopeType === 'workspace') {
    return { type: file.scopeType, id: file.scopeId };
  }

  throw new PluginError({
    code: 'PLUGIN_FILE_SCOPE_INVALID',
    message: `File "${file.id}" has an invalid resource scope.`,
    statusCode: 500,
    details: {
      fileId: file.id,
      scopeType: file.scopeType,
      scopeId: file.scopeId,
    },
  });
}

async function assertFileScopeAccess(
  host: PluginFilesHost,
  scope: PluginFilesScope,
  file: PluginFile,
  action: PluginFileAccessAction
): Promise<NormalizedPluginResourceScope> {
  const resourceScope = fileResourceScope(file);
  await host.authorizeScope(scope, resourceScope, action);
  return resourceScope;
}

function normalizeFileName(fileName: string): string {
  const normalized = fileName.trim().replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
  if (!normalized || normalized === '.' || normalized === '..') {
    throw new PluginError({
      code: 'PLUGIN_FILE_NAME_INVALID',
      message: 'File name must be a non-empty base name.',
      statusCode: 400,
    });
  }
  if (normalized.length > MAX_FILE_NAME_LENGTH) {
    throw new PluginError({
      code: 'PLUGIN_FILE_NAME_INVALID',
      message: `File name must be at most ${MAX_FILE_NAME_LENGTH} characters.`,
      statusCode: 400,
    });
  }
  return normalized;
}

function normalizeContentType(contentType: string): string {
  const normalized = contentType.trim().toLowerCase();
  if (!normalized || !normalized.includes('/') || normalized.length > 200) {
    throw new PluginError({
      code: 'PLUGIN_FILE_CONTENT_TYPE_INVALID',
      message: 'File content type must be a valid MIME type.',
      statusCode: 400,
    });
  }
  return normalized;
}

function normalizePurpose(purpose: PluginFilePurpose): PluginFilePurpose {
  if (!VALID_PURPOSES.has(purpose)) {
    throw new PluginError({
      code: 'PLUGIN_FILE_PURPOSE_INVALID',
      message: `File purpose "${purpose}" is invalid.`,
      statusCode: 400,
    });
  }
  return purpose;
}

function normalizeStatus(status: PluginFileStatus | undefined): PluginFileStatus | undefined {
  if (status === undefined) return undefined;
  if (!VALID_STATUSES.has(status)) {
    throw new PluginError({
      code: 'PLUGIN_FILE_STATUS_INVALID',
      message: `File status "${status}" is invalid.`,
      statusCode: 400,
    });
  }
  return status;
}

function normalizeSize(size: number): number {
  if (!Number.isFinite(size) || size < 0 || !Number.isInteger(size)) {
    throw new PluginError({
      code: 'PLUGIN_FILE_SIZE_INVALID',
      message: 'File size must be a non-negative integer.',
      statusCode: 400,
    });
  }
  return size;
}

function normalizeHash(hash: string | undefined): string | undefined {
  const normalized = hash?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 200) {
    throw new PluginError({
      code: 'PLUGIN_FILE_HASH_INVALID',
      message: 'File hash must be at most 200 characters.',
      statusCode: 400,
    });
  }
  return normalized;
}

function buildStorageKey(input: {
  pluginId: string;
  resourceScope: NormalizedPluginResourceScope;
  fileId: string;
  fileName: string;
}): string {
  return [
    'plugins',
    input.pluginId,
    input.resourceScope.type,
    input.resourceScope.id,
    input.fileId,
    input.fileName,
  ].join('/');
}

async function toBuffer(body: Buffer | Uint8Array | ReadableStream): Promise<Buffer> {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  const arrayBuffer = await new Response(body).arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function hashBuffer(buffer: Buffer): string {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

function toRecord(row: PluginFile): PluginFileRecord {
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
    status: row.status as PluginFileStatus,
    runId: row.runId ?? undefined,
    metadata: row.metadata,
    expiresAt: row.expiresAt ?? undefined,
    uploadedAt: row.uploadedAt ?? undefined,
    archivedAt: row.archivedAt ?? undefined,
    deletedAt: row.deletedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function assertQuota(
  host: PluginFilesHost,
  repository: PluginFilesRepository,
  scope: PluginFilesScope,
  resourceScope: NormalizedPluginResourceScope,
  size: number
): Promise<void> {
  const quota = await host.getQuota(scope, resourceScope);
  if (quota.maxFileSizeBytes !== -1 && size > quota.maxFileSizeBytes) {
    throw new PluginError({
      code: 'PLUGIN_FILE_SIZE_LIMIT_EXCEEDED',
      message: `File size exceeds the ${quota.maxFileSizeBytes} byte limit.`,
      statusCode: 413,
      details: {
        size,
        maxFileSizeBytes: quota.maxFileSizeBytes,
      },
    });
  }

  const shouldCheckScopeUsage =
    (quota.maxFilesPerScope !== undefined && quota.maxFilesPerScope !== -1) ||
    (quota.maxStorageBytesPerScope !== undefined && quota.maxStorageBytesPerScope !== -1) ||
    (quota.maxDailyUploadBytesPerScope !== undefined && quota.maxDailyUploadBytesPerScope !== -1);

  if (!shouldCheckScopeUsage) {
    return;
  }

  const usage = await repository.getUsage(scope, {
    resourceScope,
    uploadedSince: new Date(Date.now() - DAILY_UPLOAD_WINDOW_MS),
  });

  if (
    quota.maxFilesPerScope !== undefined &&
    quota.maxFilesPerScope !== -1 &&
    usage.fileCount + 1 > quota.maxFilesPerScope
  ) {
    throw new PluginError({
      code: 'PLUGIN_FILE_COUNT_LIMIT_EXCEEDED',
      message: `File count exceeds the ${quota.maxFilesPerScope} file limit for this scope.`,
      statusCode: 429,
      details: {
        fileCount: usage.fileCount,
        requestedFiles: 1,
        maxFilesPerScope: quota.maxFilesPerScope,
      },
    });
  }

  if (
    quota.maxStorageBytesPerScope !== undefined &&
    quota.maxStorageBytesPerScope !== -1 &&
    usage.storageBytes + size > quota.maxStorageBytesPerScope
  ) {
    throw new PluginError({
      code: 'PLUGIN_FILE_STORAGE_LIMIT_EXCEEDED',
      message: `File storage exceeds the ${quota.maxStorageBytesPerScope} byte limit for this scope.`,
      statusCode: 413,
      details: {
        storageBytes: usage.storageBytes,
        requestedBytes: size,
        maxStorageBytesPerScope: quota.maxStorageBytesPerScope,
      },
    });
  }

  if (
    quota.maxDailyUploadBytesPerScope !== undefined &&
    quota.maxDailyUploadBytesPerScope !== -1 &&
    usage.dailyUploadBytes + size > quota.maxDailyUploadBytesPerScope
  ) {
    throw new PluginError({
      code: 'PLUGIN_FILE_DAILY_UPLOAD_LIMIT_EXCEEDED',
      message: `Daily file uploads exceed the ${quota.maxDailyUploadBytesPerScope} byte limit for this scope.`,
      statusCode: 429,
      details: {
        dailyUploadBytes: usage.dailyUploadBytes,
        requestedBytes: size,
        maxDailyUploadBytesPerScope: quota.maxDailyUploadBytesPerScope,
      },
    });
  }
}

export class DbPluginFilesRepository implements PluginFilesRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inPlugin<T>(
    scope: PluginFilesScope,
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

  async createPending(
    scope: PluginFilesScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      fileName: string;
      contentType: string;
      size: number;
      purpose: PluginFilePurpose;
      storageKey: string;
      runId?: string;
      expiresAt?: Date;
      metadata: Record<string, unknown>;
    }
  ) {
    return this.inPlugin(scope, async (executor) => {
      const [row] = await executor
        .insert(pluginFiles)
        .values({
          id: randomUUID(),
          pluginId: scope.pluginId,
          userId: scope.userId,
          scopeType: input.resourceScope.type,
          scopeId: input.resourceScope.id,
          ownerUserId: scope.userId,
          fileName: input.fileName,
          contentType: input.contentType,
          size: input.size,
          purpose: input.purpose,
          status: 'pending_upload',
          storageKey: input.storageKey,
          runId: input.runId,
          expiresAt: input.expiresAt,
          metadata: input.metadata,
        } satisfies NewPluginFile)
        .returning();
      return row;
    });
  }

  async complete(
    scope: PluginFilesScope,
    input: {
      fileId: string;
      storageKey?: string;
      size: number;
      hash?: string;
      contentType?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    return this.inPlugin(scope, async (executor) => {
      const [existing] = await executor
        .select()
        .from(pluginFiles)
        .where(
          and(
            eq(pluginFiles.pluginId, scope.pluginId),
            eq(pluginFiles.id, input.fileId),
            isNull(pluginFiles.deletedAt)
          )
        )
        .limit(1);

      if (!existing) {
        throw new PluginError({
          code: 'PLUGIN_FILE_NOT_FOUND',
          message: `File "${input.fileId}" was not found.`,
          statusCode: 404,
        });
      }

      const [row] = await executor
        .update(pluginFiles)
        .set({
          storageKey: input.storageKey ?? existing.storageKey,
          size: input.size,
          hash: input.hash,
          contentType: input.contentType ?? existing.contentType,
          metadata: input.metadata
            ? { ...existing.metadata, ...input.metadata }
            : existing.metadata,
          status: 'ready',
          uploadedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pluginFiles.pluginId, scope.pluginId),
            eq(pluginFiles.id, input.fileId),
            isNull(pluginFiles.deletedAt)
          )
        )
        .returning();
      return row;
    });
  }

  async get(scope: PluginFilesScope, id: string) {
    return this.inPlugin(scope, async (executor) => {
      const [row] = await executor
        .select()
        .from(pluginFiles)
        .where(
          and(
            eq(pluginFiles.pluginId, scope.pluginId),
            eq(pluginFiles.id, id),
            isNull(pluginFiles.deletedAt)
          )
        )
        .limit(1);
      return row ?? null;
    });
  }

  async list(
    scope: PluginFilesScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      purpose?: PluginFilePurpose;
      status?: PluginFileStatus;
      runId?: string;
      limit: number;
      offset: number;
    }
  ) {
    return this.inPlugin(scope, async (executor) => {
      let whereClause = and(
        eq(pluginFiles.pluginId, scope.pluginId),
        eq(pluginFiles.scopeType, input.resourceScope.type),
        eq(pluginFiles.scopeId, input.resourceScope.id),
        isNull(pluginFiles.deletedAt)
      );
      if (input.purpose) whereClause = and(whereClause, eq(pluginFiles.purpose, input.purpose));
      if (input.status) whereClause = and(whereClause, eq(pluginFiles.status, input.status));
      if (input.runId) whereClause = and(whereClause, eq(pluginFiles.runId, input.runId));

      return executor
        .select()
        .from(pluginFiles)
        .where(whereClause)
        .orderBy(desc(pluginFiles.createdAt))
        .limit(input.limit)
        .offset(input.offset);
    });
  }

  async getUsage(
    scope: PluginFilesScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      uploadedSince?: Date;
    }
  ): Promise<PluginFilesUsage> {
    return this.inPlugin(scope, async (executor) => {
      const baseWhere = and(
        eq(pluginFiles.pluginId, scope.pluginId),
        eq(pluginFiles.scopeType, input.resourceScope.type),
        eq(pluginFiles.scopeId, input.resourceScope.id),
        isNull(pluginFiles.deletedAt)
      );
      const [scopeUsage] = await executor
        .select({
          fileCount: sql<number>`count(*)::int`,
          storageBytes: sql<number>`coalesce(sum(${pluginFiles.size}), 0)::bigint`,
        })
        .from(pluginFiles)
        .where(baseWhere);

      const dailyWhere = input.uploadedSince
        ? and(baseWhere, gte(pluginFiles.createdAt, input.uploadedSince))
        : baseWhere;
      const [dailyUsage] = await executor
        .select({
          dailyUploadBytes: sql<number>`coalesce(sum(${pluginFiles.size}), 0)::bigint`,
        })
        .from(pluginFiles)
        .where(dailyWhere);

      return {
        fileCount: Number(scopeUsage?.fileCount ?? 0),
        storageBytes: Number(scopeUsage?.storageBytes ?? 0),
        dailyUploadBytes: Number(dailyUsage?.dailyUploadBytes ?? 0),
      };
    });
  }

  async archive(scope: PluginFilesScope, id: string) {
    return this.updateLifecycle(scope, id, 'archived');
  }

  async softDelete(scope: PluginFilesScope, id: string) {
    return this.updateLifecycle(scope, id, 'deleted');
  }

  private async updateLifecycle(
    scope: PluginFilesScope,
    id: string,
    status: Extract<PluginFileStatus, 'archived' | 'deleted'>
  ) {
    return this.inPlugin(scope, async (executor) => {
      const now = new Date();
      const [row] = await executor
        .update(pluginFiles)
        .set({
          status,
          archivedAt: status === 'archived' ? now : undefined,
          deletedAt: status === 'deleted' ? now : undefined,
          updatedAt: now,
        })
        .where(
          and(
            eq(pluginFiles.pluginId, scope.pluginId),
            eq(pluginFiles.id, id),
            isNull(pluginFiles.deletedAt)
          )
        )
        .returning();

      if (!row) {
        throw new PluginError({
          code: 'PLUGIN_FILE_NOT_FOUND',
          message: `File "${id}" was not found.`,
          statusCode: 404,
        });
      }

      return row;
    });
  }
}

export function createPluginFilesCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginFilesOptions = {}
): PluginFiles {
  const repository = options.repository ?? new DbPluginFilesRepository();
  const host = createDefaultHost({
    authorizeScope: createDefaultFileScopeAuthorizer(scope),
    ...options.host,
  });

  return {
    async createUpload(input: PluginFileCreateUploadInput) {
      enforceCapabilityPermission(scope, Permission.FilesWrite, 'ctx.files.createUpload');
      const fileScope = resolveScope(scope, 'ctx.files.createUpload');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.files.createUpload');
      const metadata = input.metadata ?? {};
      assertJsonSerializable(metadata, 'File metadata');
      const size = normalizeSize(input.size);
      await host.authorizeScope(fileScope, resourceScope, 'write');
      await assertQuota(host, repository, fileScope, resourceScope, size);

      const fileName = normalizeFileName(input.fileName);
      const contentType = normalizeContentType(input.contentType);
      const purpose = normalizePurpose(input.purpose);
      const storageKey = buildStorageKey({
        pluginId: scope.contract.id,
        resourceScope,
        fileId: randomUUID(),
        fileName,
      });

      let row = await repository.createPending(fileScope, {
        resourceScope,
        fileName,
        contentType,
        size,
        purpose,
        storageKey,
        runId: input.runId,
        expiresAt: input.expiresAt,
        metadata,
      });

      if (input.body) {
        const body = await toBuffer(input.body);
        if (body.length !== size) {
          throw new PluginError({
            code: 'PLUGIN_FILE_SIZE_MISMATCH',
            message: 'Declared file size does not match uploaded body size.',
            statusCode: 400,
            details: {
              declaredSize: size,
              actualSize: body.length,
            },
          });
        }
        await host.getBlobStore().put({ key: row.storageKey, body, contentType });
        row = await repository.complete(fileScope, {
          fileId: row.id,
          size: body.length,
          hash: hashBuffer(body),
        });
      }

      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.files.createUpload`,
        {
          fileId: row.id,
          scope: { type: row.scopeType, id: row.scopeId },
          fileName: row.fileName,
          size: row.size,
          purpose: row.purpose,
          runId: row.runId,
        },
        options.auditPort
      );

      return {
        id: row.id,
        scope: denormalizeResourceScope({
          type: row.scopeType as 'user' | 'workspace',
          id: row.scopeId,
        }),
        fileName: row.fileName,
        contentType: row.contentType,
        size: row.size,
        purpose: row.purpose as PluginFilePurpose,
        status: row.status as PluginFileStatus,
        storageRef: row.storageKey,
        metadata: row.metadata,
        expiresAt: row.expiresAt ?? undefined,
        createdAt: row.createdAt,
      };
    },

    async completeUpload(input) {
      enforceCapabilityPermission(scope, Permission.FilesWrite, 'ctx.files.completeUpload');
      const fileScope = resolveScope(scope, 'ctx.files.completeUpload');
      const metadata = input.metadata ?? {};
      assertJsonSerializable(metadata, 'File metadata');
      const existing = await repository.get(fileScope, input.fileId);
      if (!existing || existing.status !== 'pending_upload') {
        throw new PluginError({
          code: 'PLUGIN_FILE_NOT_FOUND',
          message: `Pending upload file "${input.fileId}" was not found.`,
          statusCode: 404,
        });
      }
      const resourceScope = await assertFileScopeAccess(host, fileScope, existing, 'write');
      const row = await repository.complete(fileScope, {
        fileId: input.fileId,
        storageKey: input.storageRef,
        size: normalizeSize(input.size),
        hash: normalizeHash(input.hash),
        contentType: input.contentType ? normalizeContentType(input.contentType) : undefined,
        metadata,
      });
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.files.completeUpload`,
        {
          fileId: row.id,
          scope: resourceScope,
          size: row.size,
          hash: row.hash,
          runId: row.runId,
        },
        options.auditPort
      );
      return toRecord(row);
    },

    async read(id) {
      enforceCapabilityPermission(scope, Permission.FilesRead, 'ctx.files.read');
      const fileScope = resolveScope(scope, 'ctx.files.read');
      const row = await repository.get(fileScope, id);
      if (!row || row.status !== 'ready') {
        throw new PluginError({
          code: 'PLUGIN_FILE_NOT_FOUND',
          message: `File "${id}" was not found or is not ready.`,
          statusCode: 404,
        });
      }
      const resourceScope = await assertFileScopeAccess(host, fileScope, row, 'read');
      const blob = await host.getBlobStore().get(row.storageKey);
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.files.read`,
        { fileId: row.id, scope: resourceScope, size: row.size, runId: row.runId },
        options.auditPort
      );
      return {
        record: toRecord(row),
        body: blob.body,
      };
    },

    async get(id) {
      enforceCapabilityPermission(scope, Permission.FilesRead, 'ctx.files.get');
      const fileScope = resolveScope(scope, 'ctx.files.get');
      const row = await repository.get(fileScope, id);
      if (row) {
        await assertFileScopeAccess(host, fileScope, row, 'read');
      }
      return row ? toRecord(row) : null;
    },

    async list(input) {
      enforceCapabilityPermission(scope, Permission.FilesRead, 'ctx.files.list');
      const fileScope = resolveScope(scope, 'ctx.files.list');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.files.list');
      await host.authorizeScope(fileScope, resourceScope, 'read');
      const rows = await repository.list(fileScope, {
        resourceScope,
        purpose: input.purpose ? normalizePurpose(input.purpose) : undefined,
        status: normalizeStatus(input.status),
        runId: input.runId,
        limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
        offset: Math.max(input.offset ?? 0, 0),
      });
      return rows.map(toRecord);
    },

    async createSignedUploadUrl(id, options) {
      enforceCapabilityPermission(scope, Permission.FilesWrite, 'ctx.files.createSignedUploadUrl');
      const fileScope = resolveScope(scope, 'ctx.files.createSignedUploadUrl');
      const row = await repository.get(fileScope, id);
      if (!row || row.status !== 'pending_upload') {
        throw new PluginError({
          code: 'PLUGIN_FILE_NOT_FOUND',
          message: `Pending upload file "${id}" was not found.`,
          statusCode: 404,
        });
      }
      await assertFileScopeAccess(host, fileScope, row, 'write');
      return host.createSignedUrl({
        file: row,
        operation: 'upload',
        expiresInSeconds: options?.expiresInSeconds ?? 300,
      });
    },

    async createSignedDownloadUrl(id, options) {
      enforceCapabilityPermission(scope, Permission.FilesRead, 'ctx.files.createSignedDownloadUrl');
      const fileScope = resolveScope(scope, 'ctx.files.createSignedDownloadUrl');
      const row = await repository.get(fileScope, id);
      if (!row || row.status !== 'ready') {
        throw new PluginError({
          code: 'PLUGIN_FILE_NOT_FOUND',
          message: `Ready file "${id}" was not found.`,
          statusCode: 404,
        });
      }
      await assertFileScopeAccess(host, fileScope, row, 'read');
      return host.createSignedUrl({
        file: row,
        operation: 'download',
        expiresInSeconds: options?.expiresInSeconds ?? 300,
      });
    },

    async archive(id) {
      enforceCapabilityPermission(scope, Permission.FilesWrite, 'ctx.files.archive');
      const fileScope = resolveScope(scope, 'ctx.files.archive');
      const existing = await repository.get(fileScope, id);
      if (!existing) {
        throw new PluginError({
          code: 'PLUGIN_FILE_NOT_FOUND',
          message: `File "${id}" was not found.`,
          statusCode: 404,
        });
      }
      const resourceScope = await assertFileScopeAccess(host, fileScope, existing, 'delete');
      const row = await repository.archive(fileScope, id);
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.files.archive`,
        { fileId: id, scope: resourceScope, runId: row.runId },
        options.auditPort
      );
      return toRecord(row);
    },

    async delete(id) {
      enforceCapabilityPermission(scope, Permission.FilesWrite, 'ctx.files.delete');
      const fileScope = resolveScope(scope, 'ctx.files.delete');
      const existing = await repository.get(fileScope, id);
      if (!existing) {
        throw new PluginError({
          code: 'PLUGIN_FILE_NOT_FOUND',
          message: `File "${id}" was not found.`,
          statusCode: 404,
        });
      }
      const resourceScope = await assertFileScopeAccess(host, fileScope, existing, 'delete');
      const row = await repository.softDelete(fileScope, id);
      try {
        await host.getBlobStore().delete(row.storageKey);
      } catch {
        // Metadata is authoritative for plugin visibility. Cleanup retries can remove stale blobs.
      }
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.files.delete`,
        {
          fileId: id,
          scope: resourceScope,
          size: row.size,
          runId: row.runId,
        },
        options.auditPort
      );
    },
  };
}
