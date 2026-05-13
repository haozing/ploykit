import { createHash, randomUUID } from 'crypto';
import { and, asc, eq, isNull, like, sql } from 'drizzle-orm';
import {
  Permission,
  PluginError,
  type PluginArtifactRecord,
  type PluginArtifacts,
  type PluginArtifactSummary,
  type PluginArtifactTreeEntry,
} from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import {
  pluginArtifacts,
  type PluginArtifact,
  type NewPluginArtifact,
} from '@/lib/db/schema/plugin-storage';
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

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

export interface PluginArtifactsScope {
  pluginId: string;
  userId: string;
}

export interface PluginArtifactUpsertInput {
  scope: NormalizedPluginResourceScope;
  path: string;
  content: string;
  contentType: string;
  metadata: Record<string, unknown>;
}

export interface PluginArtifactLookupInput {
  scope: NormalizedPluginResourceScope;
  path: string;
}

export interface PluginArtifactListInput {
  scope: NormalizedPluginResourceScope;
  prefix?: string;
  limit: number;
  offset: number;
}

export interface PluginArtifactMetadataUpdateInput {
  scope: NormalizedPluginResourceScope;
  path: string;
  metadata: Record<string, unknown>;
  merge: boolean;
}

export interface PluginArtifactsRepository {
  upsert(scope: PluginArtifactsScope, input: PluginArtifactUpsertInput): Promise<PluginArtifact>;
  read(
    scope: PluginArtifactsScope,
    input: PluginArtifactLookupInput
  ): Promise<PluginArtifact | null>;
  list(scope: PluginArtifactsScope, input: PluginArtifactListInput): Promise<PluginArtifact[]>;
  updateMetadata(
    scope: PluginArtifactsScope,
    input: PluginArtifactMetadataUpdateInput
  ): Promise<PluginArtifact>;
  softDelete(scope: PluginArtifactsScope, input: PluginArtifactLookupInput): Promise<void>;
}

export interface CreatePluginArtifactsOptions {
  repository?: PluginArtifactsRepository;
  auditPort?: AuditPort;
}

const DEFAULT_CONTENT_TYPE = 'text/plain';
const MAX_ARTIFACT_CONTENT_BYTES = 2 * 1024 * 1024;
const MAX_ARTIFACT_PATH_LENGTH = 512;
const MAX_LIST_LIMIT = 500;

function scopeContextUserId(scope: PluginArtifactsScope): string {
  return scope.userId;
}

function resourceWhere(scope: PluginArtifactsScope, resourceScope: NormalizedPluginResourceScope) {
  const conditions = [
    eq(pluginArtifacts.pluginId, scope.pluginId),
    eq(pluginArtifacts.scopeType, resourceScope.type),
    eq(pluginArtifacts.scopeId, resourceScope.id),
    isNull(pluginArtifacts.deletedAt),
  ];

  if (resourceScope.type === 'user') {
    conditions.push(eq(pluginArtifacts.userId, scope.userId));
  }

  return and(...conditions);
}

function artifactWhere(scope: PluginArtifactsScope, input: PluginArtifactLookupInput) {
  return and(resourceWhere(scope, input.scope), eq(pluginArtifacts.path, input.path));
}

function byteSize(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function validateArtifactPath(scope: PluginCapabilityScope, path: string): string {
  const normalized = normalizeSlashes(path.trim()).replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);

  if (
    !normalized ||
    normalized.length > MAX_ARTIFACT_PATH_LENGTH ||
    normalized.startsWith('/') ||
    segments.length === 0 ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new PluginError({
      code: 'PLUGIN_ARTIFACT_PATH_INVALID',
      message: `Artifact path "${path}" must be a safe relative path inside the workspace.`,
      statusCode: 400,
      fix: 'Use a relative path like "docs/outline.md" and avoid absolute paths or "..".',
      details: {
        pluginId: scope.contract.id,
        path,
      },
    });
  }

  return segments.join('/');
}

function normalizePrefix(scope: PluginCapabilityScope, prefix?: string): string | undefined {
  if (prefix === undefined || prefix.trim() === '') {
    return undefined;
  }

  const normalized = normalizeSlashes(prefix.trim()).replace(/^\/+/, '').replace(/\/+$/, '');
  if (normalized === '') {
    return undefined;
  }

  return validateArtifactPath(scope, normalized);
}

function validateContent(scope: PluginCapabilityScope, content: string): void {
  const size = byteSize(content);
  if (size > MAX_ARTIFACT_CONTENT_BYTES) {
    throw new PluginError({
      code: 'PLUGIN_ARTIFACT_CONTENT_TOO_LARGE',
      message: `Artifact content is ${size} bytes, above the ${MAX_ARTIFACT_CONTENT_BYTES} byte limit.`,
      statusCode: 413,
      details: {
        pluginId: scope.contract.id,
        size,
        maxSize: MAX_ARTIFACT_CONTENT_BYTES,
      },
    });
  }
}

function validateMetadata(metadata: Record<string, unknown>): void {
  assertJsonSerializable(metadata, 'Artifact metadata');
}

function toSummary(row: PluginArtifact): PluginArtifactSummary {
  return {
    id: row.id,
    scope: denormalizeResourceScope({
      type: row.scopeType as 'user' | 'workspace',
      id: row.scopeId,
    }),
    path: row.path,
    contentType: row.contentType,
    metadata: row.metadata,
    version: row.version,
    size: row.size,
    hash: row.hash,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toRecord(row: PluginArtifact): PluginArtifactRecord {
  return {
    ...toSummary(row),
    content: row.content,
  };
}

function toTreeEntry(row: PluginArtifact): PluginArtifactTreeEntry {
  const segments = row.path.split('/');
  const name = segments.at(-1) ?? row.path;
  const parentPath = segments.length > 1 ? segments.slice(0, -1).join('/') : '';

  return {
    ...toSummary(row),
    name,
    parentPath,
  };
}

export class DbPluginArtifactsRepository implements PluginArtifactsRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inContext<T>(
    scope: PluginArtifactsScope,
    fn: (executor: Executor) => Promise<T>
  ): Promise<T> {
    if (this.executor !== db) {
      await this.executor.execute(
        sql`SELECT set_config('app.current_user_id', ${scopeContextUserId(scope)}, true)`
      );
      await this.executor.execute(
        sql`SELECT set_config('app.current_plugin_id', ${scope.pluginId}, true)`
      );
      return fn(this.executor);
    }

    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_user_id', ${scopeContextUserId(scope)}, true)`
      );
      await tx.execute(sql`SELECT set_config('app.current_plugin_id', ${scope.pluginId}, true)`);
      return fn(tx);
    });
  }

  async upsert(scope: PluginArtifactsScope, input: PluginArtifactUpsertInput) {
    const now = new Date();
    const payload = {
      id: randomUUID(),
      pluginId: scope.pluginId,
      userId: scope.userId,
      scopeType: input.scope.type,
      scopeId: input.scope.id,
      path: input.path,
      contentType: input.contentType,
      content: input.content,
      metadata: input.metadata,
      size: byteSize(input.content),
      hash: sha256(input.content),
      version: 1,
      updatedAt: now,
    } satisfies NewPluginArtifact;

    return this.inContext(scope, async (executor) => {
      const [row] = await executor
        .insert(pluginArtifacts)
        .values(payload)
        .onConflictDoUpdate({
          target:
            input.scope.type === 'workspace'
              ? [
                  pluginArtifacts.pluginId,
                  pluginArtifacts.scopeType,
                  pluginArtifacts.scopeId,
                  pluginArtifacts.path,
                ]
              : [
                  pluginArtifacts.pluginId,
                  pluginArtifacts.userId,
                  pluginArtifacts.scopeType,
                  pluginArtifacts.scopeId,
                  pluginArtifacts.path,
                ],
          set: {
            contentType: input.contentType,
            content: input.content,
            metadata: input.metadata,
            size: byteSize(input.content),
            hash: sha256(input.content),
            version: sql`${pluginArtifacts.version} + 1`,
            updatedAt: now,
            deletedAt: null,
          },
          targetWhere:
            input.scope.type === 'workspace'
              ? sql`${pluginArtifacts.deletedAt} IS NULL AND ${pluginArtifacts.scopeType} = 'workspace'`
              : sql`${pluginArtifacts.deletedAt} IS NULL AND ${pluginArtifacts.scopeType} = 'user'`,
        })
        .returning();

      return row;
    });
  }

  async read(scope: PluginArtifactsScope, input: PluginArtifactLookupInput) {
    return this.inContext(scope, async (executor) => {
      const rows = await executor
        .select()
        .from(pluginArtifacts)
        .where(artifactWhere(scope, input))
        .limit(1);

      return rows[0] ?? null;
    });
  }

  async list(scope: PluginArtifactsScope, input: PluginArtifactListInput) {
    return this.inContext(scope, async (executor) => {
      let whereClause = resourceWhere(scope, input.scope);
      if (input.prefix) {
        whereClause = and(whereClause, like(pluginArtifacts.path, `${input.prefix}%`));
      }

      return executor
        .select()
        .from(pluginArtifacts)
        .where(whereClause)
        .orderBy(asc(pluginArtifacts.path))
        .limit(input.limit)
        .offset(input.offset);
    });
  }

  async updateMetadata(scope: PluginArtifactsScope, input: PluginArtifactMetadataUpdateInput) {
    return this.inContext(scope, async (executor) => {
      const [existing] = await executor
        .select()
        .from(pluginArtifacts)
        .where(artifactWhere(scope, input))
        .limit(1);

      if (!existing) {
        throw new PluginError({
          code: 'PLUGIN_ARTIFACT_NOT_FOUND',
          message: `Artifact "${input.scope.type}:${input.scope.id}/${input.path}" was not found.`,
          statusCode: 404,
          details: {
            pluginId: scope.pluginId,
            scope: input.scope,
            path: input.path,
          },
        });
      }

      const metadata = input.merge ? { ...existing.metadata, ...input.metadata } : input.metadata;
      const [row] = await executor
        .update(pluginArtifacts)
        .set({
          metadata,
          version: sql`${pluginArtifacts.version} + 1`,
          updatedAt: new Date(),
        })
        .where(artifactWhere(scope, input))
        .returning();

      return row;
    });
  }

  async softDelete(scope: PluginArtifactsScope, input: PluginArtifactLookupInput) {
    await this.inContext(scope, async (executor) => {
      await executor
        .update(pluginArtifacts)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(artifactWhere(scope, input));
    });
  }
}

function resolveScope(scope: PluginCapabilityScope, capability: string): PluginArtifactsScope {
  const user = requireUser(scope, capability);
  return {
    pluginId: scope.contract.id,
    userId: user.id,
  };
}

export function createPluginArtifactsCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginArtifactsOptions = {}
): PluginArtifacts {
  const repository = options.repository ?? new DbPluginArtifactsRepository();

  return {
    async writeText(input) {
      enforceCapabilityPermission(scope, Permission.ArtifactsWrite, 'ctx.artifacts.writeText');
      const artifactScope = resolveScope(scope, 'ctx.artifacts.writeText');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.artifacts.writeText');
      await assertResourceScopeAccess(scope, resourceScope, 'write', 'ctx.artifacts.writeText');
      const path = validateArtifactPath(scope, input.path);
      const contentType = input.contentType ?? DEFAULT_CONTENT_TYPE;
      const metadata = input.metadata ?? {};
      validateContent(scope, input.content);
      validateMetadata(metadata);

      const row = await repository.upsert(artifactScope, {
        scope: resourceScope,
        path,
        content: input.content,
        contentType,
        metadata,
      });

      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.artifacts.write`,
        {
          artifactId: row.id,
          scope: resourceScope,
          path,
          contentType,
          version: row.version,
          size: row.size,
        },
        options.auditPort
      );

      return toRecord(row);
    },

    async readText(input) {
      enforceCapabilityPermission(scope, Permission.ArtifactsRead, 'ctx.artifacts.readText');
      const artifactScope = resolveScope(scope, 'ctx.artifacts.readText');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.artifacts.readText');
      await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.artifacts.readText');
      const path = validateArtifactPath(scope, input.path);
      const row = await repository.read(artifactScope, { scope: resourceScope, path });
      return row ? toRecord(row) : null;
    },

    async list(input) {
      enforceCapabilityPermission(scope, Permission.ArtifactsRead, 'ctx.artifacts.list');
      const artifactScope = resolveScope(scope, 'ctx.artifacts.list');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.artifacts.list');
      await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.artifacts.list');
      const prefix = normalizePrefix(scope, input.prefix);
      const limit = Math.min(Math.max(input.limit ?? 100, 1), MAX_LIST_LIMIT);
      const offset = Math.max(input.offset ?? 0, 0);
      const rows = await repository.list(artifactScope, {
        scope: resourceScope,
        prefix,
        limit,
        offset,
      });
      return rows.map(toSummary);
    },

    async tree(input) {
      enforceCapabilityPermission(scope, Permission.ArtifactsRead, 'ctx.artifacts.tree');
      const artifactScope = resolveScope(scope, 'ctx.artifacts.tree');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.artifacts.tree');
      await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.artifacts.tree');
      const prefix = normalizePrefix(scope, input.prefix);
      const limit = Math.min(Math.max(input.limit ?? MAX_LIST_LIMIT, 1), MAX_LIST_LIMIT);
      const offset = Math.max(input.offset ?? 0, 0);
      const rows = await repository.list(artifactScope, {
        scope: resourceScope,
        prefix,
        limit,
        offset,
      });
      return rows.map(toTreeEntry);
    },

    async updateMetadata(input) {
      enforceCapabilityPermission(scope, Permission.ArtifactsWrite, 'ctx.artifacts.updateMetadata');
      const artifactScope = resolveScope(scope, 'ctx.artifacts.updateMetadata');
      const resourceScope = normalizeResourceScope(
        scope,
        input.scope,
        'ctx.artifacts.updateMetadata'
      );
      await assertResourceScopeAccess(
        scope,
        resourceScope,
        'write',
        'ctx.artifacts.updateMetadata'
      );
      const path = validateArtifactPath(scope, input.path);
      validateMetadata(input.metadata);
      const row = await repository.updateMetadata(artifactScope, {
        scope: resourceScope,
        path,
        metadata: input.metadata,
        merge: input.merge ?? true,
      });

      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.artifacts.updateMetadata`,
        {
          artifactId: row.id,
          scope: resourceScope,
          path,
          version: row.version,
        },
        options.auditPort
      );

      return toSummary(row);
    },

    async delete(input) {
      enforceCapabilityPermission(scope, Permission.ArtifactsWrite, 'ctx.artifacts.delete');
      const artifactScope = resolveScope(scope, 'ctx.artifacts.delete');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.artifacts.delete');
      await assertResourceScopeAccess(scope, resourceScope, 'delete', 'ctx.artifacts.delete');
      const path = validateArtifactPath(scope, input.path);
      await repository.softDelete(artifactScope, { scope: resourceScope, path });

      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.artifacts.delete`,
        {
          scope: resourceScope,
          path,
        },
        options.auditPort
      );
    },
  };
}
