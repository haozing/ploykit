import { createHash, randomUUID } from 'crypto';
import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import {
  Permission,
  PluginError,
  type PluginRag,
  type PluginRagContextPack,
  type PluginRagSearchResult,
} from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import {
  pluginArtifacts,
  pluginRagChunks,
  type NewPluginRagChunk,
  type PluginRagChunk,
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

export interface PluginRagScope {
  pluginId: string;
  userId: string;
}

export interface PluginRagIndexHostInput {
  scope: NormalizedPluginResourceScope;
  sourceId: string;
  sourcePath?: string;
  sourceHash: string;
  chunks: Array<{
    id: string;
    chunkIndex: number;
    content: string;
    contentHash: string;
    metadata: Record<string, unknown>;
  }>;
}

export interface PluginRagSearchHostInput {
  scope: NormalizedPluginResourceScope;
  query: string;
  topK: number;
  sourceIds?: string[];
  pathPrefix?: string;
  metadata?: Record<string, unknown>;
}

export interface PluginRagDeleteHostInput {
  scope: NormalizedPluginResourceScope;
  sourceId?: string;
  path?: string;
}

export interface PluginRagRepository {
  readArtifactContent(
    scope: PluginRagScope,
    input: { scope: NormalizedPluginResourceScope; artifactId?: string; path?: string }
  ): Promise<{
    id: string;
    path: string;
    content: string;
    hash: string;
    metadata: Record<string, unknown>;
  } | null>;
  replaceSource(scope: PluginRagScope, input: PluginRagIndexHostInput): Promise<void>;
  search(scope: PluginRagScope, input: PluginRagSearchHostInput): Promise<PluginRagChunk[]>;
  delete(scope: PluginRagScope, input: PluginRagDeleteHostInput): Promise<void>;
}

export interface CreatePluginRagOptions {
  repository?: PluginRagRepository;
  auditPort?: AuditPort;
}

const MAX_PATH_LENGTH = 512;
const MAX_SOURCE_CONTENT_BYTES = 2 * 1024 * 1024;
const MIN_CHUNK_SIZE = 200;
const MAX_CHUNK_SIZE = 8_000;
const DEFAULT_CHUNK_SIZE = 1_200;
const DEFAULT_CHUNK_OVERLAP = 160;
const MAX_CHUNK_OVERLAP = 1_000;
const MAX_TOP_K = 50;
const DEFAULT_TOP_K = 8;
const DEFAULT_CONTEXT_SEPARATOR = '\n\n---\n\n';
const DEFAULT_CONTEXT_MAX_CHARACTERS = 8_000;

function scopeContextUserId(scope: PluginRagScope): string {
  return scope.userId;
}

function activeChunkWhere(scope: PluginRagScope) {
  return and(
    eq(pluginRagChunks.pluginId, scope.pluginId),
    eq(pluginRagChunks.userId, scope.userId),
    isNull(pluginRagChunks.deletedAt)
  );
}

function activeArtifactWhere(scope: PluginRagScope, resourceScope: NormalizedPluginResourceScope) {
  return and(
    eq(pluginArtifacts.pluginId, scope.pluginId),
    eq(pluginArtifacts.userId, scope.userId),
    eq(pluginArtifacts.scopeType, resourceScope.type),
    eq(pluginArtifacts.scopeId, resourceScope.id),
    isNull(pluginArtifacts.deletedAt)
  );
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function byteSize(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function validateOptionalPath(scope: PluginCapabilityScope, path?: string): string | undefined {
  if (path === undefined || path.trim() === '') {
    return undefined;
  }

  const normalized = normalizeSlashes(path.trim()).replace(/^\/+/, '');
  const segments = normalized.split('/').filter(Boolean);

  if (
    !normalized ||
    normalized.length > MAX_PATH_LENGTH ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new PluginError({
      code: 'PLUGIN_RAG_PATH_INVALID',
      message: `RAG path "${path}" must be a safe relative path inside the workspace.`,
      statusCode: 400,
      fix: 'Use a relative path like "docs/source.md" and avoid absolute paths or "..".',
      details: {
        pluginId: scope.contract.id,
        path,
      },
    });
  }

  return segments.join('/');
}

function validateSourceId(scope: PluginCapabilityScope, sourceId: string): string {
  const normalized = sourceId.trim();
  if (!normalized) {
    throw new PluginError({
      code: 'PLUGIN_RAG_SOURCE_REQUIRED',
      message: 'RAG sourceId is required.',
      statusCode: 400,
      details: {
        pluginId: scope.contract.id,
      },
    });
  }

  return normalized;
}

function validateQuery(scope: PluginCapabilityScope, query: string): string {
  const normalized = query.trim();
  if (!normalized) {
    throw new PluginError({
      code: 'PLUGIN_RAG_QUERY_REQUIRED',
      message: 'RAG query must be non-empty.',
      statusCode: 400,
      details: {
        pluginId: scope.contract.id,
      },
    });
  }

  return normalized;
}

function validateContent(scope: PluginCapabilityScope, content: string): void {
  const size = byteSize(content);
  if (size > MAX_SOURCE_CONTENT_BYTES) {
    throw new PluginError({
      code: 'PLUGIN_RAG_CONTENT_TOO_LARGE',
      message: `RAG source content is ${size} bytes, above the ${MAX_SOURCE_CONTENT_BYTES} byte limit.`,
      statusCode: 413,
      details: {
        pluginId: scope.contract.id,
        size,
        maxSize: MAX_SOURCE_CONTENT_BYTES,
      },
    });
  }
}

function normalizeChunkSize(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_CHUNK_SIZE;
  }

  return Math.min(Math.max(Math.floor(value), MIN_CHUNK_SIZE), MAX_CHUNK_SIZE);
}

function normalizeChunkOverlap(chunkSize: number, value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return Math.min(DEFAULT_CHUNK_OVERLAP, Math.floor(chunkSize / 2));
  }

  return Math.min(Math.max(Math.floor(value), 0), MAX_CHUNK_OVERLAP, Math.floor(chunkSize / 2));
}

function normalizeTopK(value?: number): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_TOP_K;
  }

  return Math.min(Math.max(Math.floor(value), 1), MAX_TOP_K);
}

function tokenize(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const chars = Array.from(normalized.replace(/\s+/g, '')).filter((char) => char.length > 0);
  return new Set([...tokens, ...chars]);
}

function scoreChunk(query: string, content: string): number {
  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) {
    return 0;
  }

  const contentTokens = tokenize(content);
  let matched = 0;
  for (const token of queryTokens) {
    if (contentTokens.has(token)) {
      matched += 1;
    }
  }

  const phraseBoost = content.toLowerCase().includes(query.toLowerCase()) ? 0.25 : 0;
  return matched / queryTokens.size + phraseBoost;
}

function splitIntoChunks(content: string, chunkSize: number, overlap: number): string[] {
  const normalized = content.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const targetEnd = Math.min(cursor + chunkSize, normalized.length);
    let end = targetEnd;
    if (targetEnd < normalized.length) {
      const paragraphBreak = normalized.lastIndexOf('\n\n', targetEnd);
      const lineBreak = normalized.lastIndexOf('\n', targetEnd);
      const sentenceBreak = Math.max(
        normalized.lastIndexOf('。', targetEnd),
        normalized.lastIndexOf('.', targetEnd),
        normalized.lastIndexOf('!', targetEnd),
        normalized.lastIndexOf('?', targetEnd)
      );
      const candidate = Math.max(paragraphBreak, lineBreak, sentenceBreak);
      if (candidate > cursor + Math.floor(chunkSize * 0.4)) {
        end = candidate + 1;
      }
    }

    const chunk = normalized.slice(cursor, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= normalized.length) {
      break;
    }

    cursor = Math.max(end - overlap, cursor + 1);
  }

  return chunks;
}

function toSearchResult(row: PluginRagChunk, score: number): PluginRagSearchResult {
  return {
    id: row.id,
    scope: denormalizeResourceScope({
      type: row.scopeType as 'user' | 'workspace',
      id: row.scopeId,
    }),
    sourceId: row.sourceId,
    sourcePath: row.sourcePath ?? undefined,
    chunkIndex: row.chunkIndex,
    content: row.content,
    score,
    metadata: row.metadata,
  };
}

function metadataMatches(
  metadata: Record<string, unknown>,
  expected?: Record<string, unknown>
): boolean {
  if (!expected || Object.keys(expected).length === 0) {
    return true;
  }

  return Object.entries(expected).every(([key, value]) => metadata[key] === value);
}

function resolveScope(scope: PluginCapabilityScope, capability: string): PluginRagScope {
  const user = requireUser(scope, capability);
  return {
    pluginId: scope.contract.id,
    userId: user.id,
  };
}

export class DbPluginRagRepository implements PluginRagRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inContext<T>(
    scope: PluginRagScope,
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

  async readArtifactContent(
    scope: PluginRagScope,
    input: { scope: NormalizedPluginResourceScope; artifactId?: string; path?: string }
  ) {
    return this.inContext(scope, async (executor) => {
      let whereClause = activeArtifactWhere(scope, input.scope);
      if (input.artifactId) {
        whereClause = and(whereClause, eq(pluginArtifacts.id, input.artifactId));
      }
      if (input.path) {
        whereClause = and(whereClause, eq(pluginArtifacts.path, input.path));
      }

      const [row] = await executor.select().from(pluginArtifacts).where(whereClause).limit(1);
      if (!row) {
        return null;
      }

      return {
        id: row.id,
        path: row.path,
        content: row.content,
        hash: row.hash,
        metadata: row.metadata,
      };
    });
  }

  async replaceSource(scope: PluginRagScope, input: PluginRagIndexHostInput) {
    await this.inContext(scope, async (executor) => {
      await executor
        .update(pluginRagChunks)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            activeChunkWhere(scope),
            eq(pluginRagChunks.scopeType, input.scope.type),
            eq(pluginRagChunks.scopeId, input.scope.id),
            eq(pluginRagChunks.sourceId, input.sourceId)
          )
        );

      if (input.chunks.length === 0) {
        return;
      }

      const now = new Date();
      const rows = input.chunks.map(
        (chunk) =>
          ({
            id: chunk.id,
            pluginId: scope.pluginId,
            userId: scope.userId,
            scopeType: input.scope.type,
            scopeId: input.scope.id,
            sourceId: input.sourceId,
            sourcePath: input.sourcePath,
            sourceHash: input.sourceHash,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            contentHash: chunk.contentHash,
            metadata: chunk.metadata,
            updatedAt: now,
          }) satisfies NewPluginRagChunk
      );

      await executor.insert(pluginRagChunks).values(rows);
    });
  }

  async search(scope: PluginRagScope, input: PluginRagSearchHostInput) {
    return this.inContext(scope, async (executor) => {
      let whereClause = and(
        activeChunkWhere(scope),
        eq(pluginRagChunks.scopeType, input.scope.type),
        eq(pluginRagChunks.scopeId, input.scope.id)
      );
      if (input.sourceIds?.length) {
        whereClause = and(whereClause, inArray(pluginRagChunks.sourceId, input.sourceIds));
      }
      if (input.pathPrefix) {
        whereClause = and(whereClause, like(pluginRagChunks.sourcePath, `${input.pathPrefix}%`));
      }

      return executor
        .select()
        .from(pluginRagChunks)
        .where(whereClause)
        .orderBy(asc(pluginRagChunks.sourcePath), asc(pluginRagChunks.chunkIndex))
        .limit(Math.max(input.topK * 20, input.topK));
    });
  }

  async delete(scope: PluginRagScope, input: PluginRagDeleteHostInput) {
    await this.inContext(scope, async (executor) => {
      let whereClause = and(
        activeChunkWhere(scope),
        eq(pluginRagChunks.scopeType, input.scope.type),
        eq(pluginRagChunks.scopeId, input.scope.id)
      );
      if (input.sourceId) {
        whereClause = and(whereClause, eq(pluginRagChunks.sourceId, input.sourceId));
      }
      if (input.path) {
        whereClause = and(whereClause, eq(pluginRagChunks.sourcePath, input.path));
      }

      await executor
        .update(pluginRagChunks)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(whereClause);
    });
  }
}

export function createPluginRagCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginRagOptions = {}
): PluginRag {
  const repository = options.repository ?? new DbPluginRagRepository();

  return {
    async index(input) {
      enforceCapabilityPermission(scope, Permission.RagWrite, 'ctx.rag.index');
      const ragScope = resolveScope(scope, 'ctx.rag.index');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.rag.index');
      await assertResourceScopeAccess(scope, resourceScope, 'write', 'ctx.rag.index');
      const path = validateOptionalPath(scope, input.path);
      const metadata = input.metadata ?? {};
      validateMetadata(metadata);

      let sourceId = input.artifactId;
      let sourcePath = path;
      let content = input.content;
      let sourceHash = content ? sha256(content) : '';
      let inheritedMetadata: Record<string, unknown> = {};

      if (!content) {
        const artifact = await repository.readArtifactContent(ragScope, {
          scope: resourceScope,
          artifactId: input.artifactId,
          path,
        });
        if (!artifact) {
          throw new PluginError({
            code: 'PLUGIN_RAG_SOURCE_NOT_FOUND',
            message: 'RAG index source was not found.',
            statusCode: 404,
            details: {
              pluginId: scope.contract.id,
              scope: resourceScope,
              artifactId: input.artifactId,
              path,
            },
          });
        }

        sourceId = artifact.id;
        sourcePath = artifact.path;
        content = artifact.content;
        sourceHash = artifact.hash;
        inheritedMetadata = artifact.metadata;
      }

      sourceId = validateSourceId(scope, sourceId ?? sourcePath ?? sha256(content));
      validateContent(scope, content);
      const chunkSize = normalizeChunkSize(input.chunkSize);
      const chunkOverlap = normalizeChunkOverlap(chunkSize, input.chunkOverlap);
      const chunks = splitIntoChunks(content, chunkSize, chunkOverlap).map((chunk, index) => ({
        id: randomUUID(),
        chunkIndex: index,
        content: chunk,
        contentHash: sha256(chunk),
        metadata: {
          ...inheritedMetadata,
          ...metadata,
          chunkSize,
          chunkOverlap,
        },
      }));

      await repository.replaceSource(ragScope, {
        scope: resourceScope,
        sourceId,
        sourcePath,
        sourceHash,
        chunks,
      });

      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.rag.index`,
        {
          scope: resourceScope,
          sourceId,
          sourcePath,
          sourceHash,
          chunkCount: chunks.length,
        },
        options.auditPort
      );

      return {
        scope: resourceScope,
        sourceId,
        sourcePath,
        sourceHash,
        chunkCount: chunks.length,
        indexedAt: new Date(),
      };
    },

    async search(input) {
      enforceCapabilityPermission(scope, Permission.RagRead, 'ctx.rag.search');
      const ragScope = resolveScope(scope, 'ctx.rag.search');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.rag.search');
      await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.rag.search');
      const query = validateQuery(scope, input.query);
      const topK = normalizeTopK(input.topK);
      const pathPrefix = validateOptionalPath(scope, input.pathPrefix);
      if (input.metadata) {
        validateMetadata(input.metadata);
      }

      const rows = await repository.search(ragScope, {
        scope: resourceScope,
        query,
        topK,
        sourceIds: input.sourceIds,
        pathPrefix,
        metadata: input.metadata,
      });

      return rows
        .map((row) => toSearchResult(row, scoreChunk(query, row.content)))
        .filter((row) => metadataMatches(row.metadata, input.metadata))
        .filter((row) => row.score > 0)
        .sort((left, right) => right.score - left.score || left.chunkIndex - right.chunkIndex)
        .slice(0, topK);
    },

    async buildContextPack(input) {
      enforceCapabilityPermission(scope, Permission.RagRead, 'ctx.rag.buildContextPack');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.rag.buildContextPack');
      await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.rag.buildContextPack');
      const maxCharacters = Math.max(input.maxCharacters ?? DEFAULT_CONTEXT_MAX_CHARACTERS, 1);
      const separator = input.separator ?? DEFAULT_CONTEXT_SEPARATOR;
      const sources = await this.search(input);
      const selected: PluginRagSearchResult[] = [];
      let content = '';

      for (const source of sources) {
        const block = `${source.sourcePath ?? source.sourceId}#${source.chunkIndex}\n${source.content}`;
        const next = content ? `${content}${separator}${block}` : block;
        if (next.length > maxCharacters && selected.length > 0) {
          break;
        }
        content = next.slice(0, maxCharacters);
        selected.push(source);
        if (content.length >= maxCharacters) {
          break;
        }
      }

      return {
        scope: resourceScope,
        query: input.query,
        content,
        sources: selected,
        characterCount: content.length,
      } satisfies PluginRagContextPack;
    },

    async delete(input) {
      enforceCapabilityPermission(scope, Permission.RagWrite, 'ctx.rag.delete');
      const ragScope = resolveScope(scope, 'ctx.rag.delete');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.rag.delete');
      await assertResourceScopeAccess(scope, resourceScope, 'delete', 'ctx.rag.delete');
      const path = validateOptionalPath(scope, input.path);
      if (!input.sourceId && !path) {
        throw new PluginError({
          code: 'PLUGIN_RAG_DELETE_TARGET_REQUIRED',
          message: 'ctx.rag.delete requires either sourceId or path.',
          statusCode: 400,
          details: {
            pluginId: scope.contract.id,
            scope: resourceScope,
          },
        });
      }

      await repository.delete(ragScope, { scope: resourceScope, sourceId: input.sourceId, path });
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.rag.delete`,
        {
          scope: resourceScope,
          sourceId: input.sourceId,
          path,
        },
        options.auditPort
      );
    },
  };
}

function validateMetadata(metadata: Record<string, unknown>): void {
  assertJsonSerializable(metadata, 'RAG metadata');
}
