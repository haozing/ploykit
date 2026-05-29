import { randomUUID } from 'node:crypto';
import {
  createInMemoryRagVectorStore,
  createRagIndexer,
  createRuntimeStoreRagVectorStore,
} from '@/lib/module-capabilities/rag';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type { RuntimeStore } from '@/lib/module-runtime/stores/runtime-store-types';
import type { ModuleAiApi, ModuleRagApi } from '@ploykit/module-sdk';
import { defaultProductId } from './default-scope';

export type HostRagProviderMode = 'memory-vector';

export interface HostRagProviderConfig {
  mode: HostRagProviderMode;
  configured: boolean;
  durable: boolean;
  chunkSize: number;
}

export interface HostRagProviderStatus {
  mode: HostRagProviderMode;
  configured: boolean;
  durable: boolean;
  degraded: boolean;
  vectorStore: 'in-memory' | 'runtime-store';
  indexer: {
    chunkSize: number;
    embeddings: 'host-ai';
  };
}

type HostRagEnv = Partial<
  Record<'PLOYKIT_RAG_PROVIDER' | 'PLOYKIT_RAG_CHUNK_SIZE', string | undefined>
>;

const hostRagVectorStore = createInMemoryRagVectorStore();

function normalizeMode(value: string | undefined): HostRagProviderMode {
  const mode = value?.trim() || 'memory-vector';
  if (mode === 'memory-vector') {
    return mode;
  }
  throw new Error(`PLOYKIT_RAG_PROVIDER_INVALID: expected memory-vector, got ${mode}`);
}

function boundedNumber(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

function productIdFor(session: ModuleHostSession): string {
  return defaultProductId(session.productId);
}

function workspaceIdFor(session: ModuleHostSession): string | null {
  return session.workspaceId ?? null;
}

export function resolveHostRagProviderConfig(env: HostRagEnv): HostRagProviderConfig {
  const mode = normalizeMode(env.PLOYKIT_RAG_PROVIDER);
  return {
    mode,
    configured: true,
    durable: false,
    chunkSize: boundedNumber(env.PLOYKIT_RAG_CHUNK_SIZE, 800, 120, 8000),
  };
}

export function getHostRagProviderStatus(
  env: HostRagEnv = process.env as HostRagEnv,
  runtimeStore?: { durable: boolean }
): HostRagProviderStatus {
  const config = resolveHostRagProviderConfig(env);
  const durable = runtimeStore?.durable ?? config.durable;
  return {
    mode: config.mode,
    configured: config.configured,
    durable,
    degraded: !durable,
    vectorStore: runtimeStore ? 'runtime-store' : 'in-memory',
    indexer: {
      chunkSize: config.chunkSize,
      embeddings: 'host-ai',
    },
  };
}

export function createHostModuleRagApi(input: {
  moduleId: string;
  session: ModuleHostSession;
  ai: ModuleAiApi;
  store?: RuntimeStore;
  durable?: boolean;
  env?: HostRagEnv;
  audit?: (record: {
    moduleId: string;
    type: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void> | void;
}): ModuleRagApi {
  const config = resolveHostRagProviderConfig(input.env ?? (process.env as HostRagEnv));
  const productId = productIdFor(input.session);
  const workspaceId = workspaceIdFor(input.session);
  const vectorStore = input.store
    ? createRuntimeStoreRagVectorStore(input.store)
    : hostRagVectorStore;
  const indexer = createRagIndexer({
    productId,
    workspaceId,
    moduleId: input.moduleId,
    ai: input.ai,
    vectorStore,
    chunkSize: config.chunkSize,
  });

  async function audit(type: string, metadata: Record<string, unknown>) {
    await input.audit?.({
      moduleId: input.moduleId,
      type,
      metadata: {
        provider: config.mode,
        durable: input.durable ?? Boolean(input.store),
        vectorStore: input.store ? 'runtime-store' : 'in-memory',
        productId,
        workspaceId,
        ...metadata,
      },
    });
  }

  async function recordInvocation(inputRecord: {
    operation: string;
    startedAt: number;
    status: 'succeeded' | 'failed';
    target?: string | null;
    usage?: Record<string, unknown>;
    error?: unknown;
    metadata?: Record<string, unknown>;
  }) {
    await input.store?.recordProviderInvocation({
      productId,
      workspaceId,
      moduleId: input.moduleId,
      providerId: config.mode,
      kind: 'rag',
      operation: inputRecord.operation,
      status: inputRecord.status,
      target: inputRecord.target,
      usage: inputRecord.usage,
      latencyMs: Date.now() - inputRecord.startedAt,
      error: inputRecord.error instanceof Error ? inputRecord.error : undefined,
      metadata: {
        durable: input.durable ?? Boolean(input.store),
        vectorStore: input.store ? 'runtime-store' : 'in-memory',
        ...inputRecord.metadata,
      },
    });
  }

  const api: ModuleRagApi = {
    async index(document) {
      const startedAt = Date.now();
      const sourceId = document.id ?? `rag_${randomUUID()}`;
      try {
        const chunks = await indexer.index({
          sourceId,
          content: document.content,
          metadata: document.metadata,
        });
        await audit('host.rag.indexed', {
          sourceId,
          chunkCount: chunks,
          contentLength: document.content.length,
        });
        await recordInvocation({
          operation: 'index',
          startedAt,
          status: 'succeeded',
          target: sourceId,
          usage: { chunks, contentLength: document.content.length },
        });
        return {
          id: sourceId,
          content: document.content,
          metadata: {
            ...(document.metadata ?? {}),
            sourceId,
            chunkCount: chunks,
            provider: config.mode,
          },
        };
      } catch (error) {
        await recordInvocation({
          operation: 'index',
          startedAt,
          status: 'failed',
          target: sourceId,
          error,
        });
        throw error;
      }
    },
    async search(query) {
      const startedAt = Date.now();
      try {
        const results = await indexer.search(query);
        await audit('host.rag.searched', {
          queryLength: query.query.length,
          limit: query.limit,
          resultCount: results.length,
        });
        await recordInvocation({
          operation: 'search',
          startedAt,
          status: 'succeeded',
          usage: { queryLength: query.query.length, resultCount: results.length },
        });
        return results;
      } catch (error) {
        await recordInvocation({
          operation: 'search',
          startedAt,
          status: 'failed',
          usage: { queryLength: query.query.length },
          error,
        });
        throw error;
      }
    },
    async contextPack(query) {
      const startedAt = Date.now();
      try {
        const pack = await indexer.contextPack(query);
        await audit('host.rag.context_pack_built', {
          queryLength: query.query.length,
          limit: query.limit,
          resultCount: pack.documents.length,
          contextLength: pack.context.length,
        });
        await recordInvocation({
          operation: 'contextPack',
          startedAt,
          status: 'succeeded',
          usage: {
            queryLength: query.query.length,
            resultCount: pack.documents.length,
            contextLength: pack.context.length,
          },
        });
        return pack;
      } catch (error) {
        await recordInvocation({
          operation: 'contextPack',
          startedAt,
          status: 'failed',
          usage: { queryLength: query.query.length },
          error,
        });
        throw error;
      }
    },
    async buildContextPack(query) {
      return api.contextPack(query);
    },
    async delete(id) {
      const startedAt = Date.now();
      try {
        const deletedRecord = await vectorStore.deleteById({
          productId,
          workspaceId,
          moduleId: input.moduleId,
          id,
        });
        const deletedBySource = deletedRecord ? 0 : await indexer.deleteSource(id);
        await audit('host.rag.deleted', {
          id,
          deletedRecords: deletedRecord ? 1 : deletedBySource,
          deleteMode: deletedRecord ? 'record' : 'source',
        });
        await recordInvocation({
          operation: 'delete',
          startedAt,
          status: 'succeeded',
          target: id,
          usage: { deletedRecords: deletedRecord ? 1 : deletedBySource },
        });
      } catch (error) {
        await recordInvocation({
          operation: 'delete',
          startedAt,
          status: 'failed',
          target: id,
          error,
        });
        throw error;
      }
    },
  };

  return api;
}
