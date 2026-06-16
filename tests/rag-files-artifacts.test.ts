import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import type { ModuleAiApi } from '@ploykit/module-sdk';
import {
  createInMemoryRuntimeStore,
  createPgModuleDataExecutor,
  createPostgresRuntimeStore,
} from '../src/lib/module-runtime';
import {
  createInMemoryRagVectorStore,
  createRagIndexer,
  createRuntimeStoreRagVectorStore,
  createStaticModuleAiRuntime,
  type RagVectorStore,
} from '../src/lib/module-capabilities';
import { createHostModuleRagApi } from '../apps/host-next/lib/rag-provider';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ploykit:ploykit@127.0.0.1:55432/ploykit';

const keywordAi: ModuleAiApi = {
  async generateText(input) {
    return {
      text: input.prompt,
      model: 'keyword-test',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  },
  async *streamText(input) {
    yield input.prompt;
  },
  async embedText(input) {
    return {
      embedding: [input.text.toLowerCase().includes('delta') ? 1 : 0],
      model: 'keyword-test',
      usage: { inputTokens: 1 },
    };
  },
};

async function databaseReachable(): Promise<boolean> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function resetRagRuntimeTables(pool: Pool): Promise<void> {
  await pool.query(`
    drop table if exists module_rag_chunks cascade;
    drop table if exists module_rag_sources cascade;
    drop table if exists module_runtime_migrations cascade;
  `);
}

async function assertReindexHidesStaleChunks(vectorStore: RagVectorStore) {
  const indexer = createRagIndexer({
    productId: 'product-reindex',
    workspaceId: 'workspace-reindex',
    moduleId: 'rag-reindex',
    ai: keywordAi,
    vectorStore,
    chunkSize: 5,
  });

  await indexer.index({
    sourceId: 'source-reindex',
    content: 'alphaDELTA',
  });
  assert.equal(
    (await indexer.search({ query: 'delta', limit: 5 })).some((result) =>
      result.content.toLowerCase().includes('delta')
    ),
    true
  );

  await indexer.index({
    sourceId: 'source-reindex',
    content: 'alpha',
  });
  assert.equal(
    (await indexer.search({ query: 'delta', limit: 5 })).some((result) =>
      result.content.toLowerCase().includes('delta')
    ),
    false
  );
}

test('P19 RAG indexer isolates workspace scope and deletes source chunks', async () => {
  const vectorStore = createInMemoryRagVectorStore();
  const ai = createStaticModuleAiRuntime();
  const workspaceA = createRagIndexer({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    moduleId: 'rag-test',
    ai: ai.forModule('rag-test'),
    vectorStore,
    chunkSize: 20,
  });
  const workspaceB = createRagIndexer({
    productId: 'product-a',
    workspaceId: 'workspace-b',
    moduleId: 'rag-test',
    ai: ai.forModule('rag-test'),
    vectorStore,
    chunkSize: 20,
  });

  await workspaceA.index({
    sourceId: 'file-a',
    content: 'alpha product launch notes',
    metadata: { sourceType: 'file' },
  });
  await workspaceB.index({
    sourceId: 'file-b',
    content: 'alpha private workspace notes',
    metadata: { sourceType: 'file' },
  });

  assert.equal((await workspaceA.search({ query: 'alpha', limit: 5 })).length, 2);
  assert.equal(
    (await workspaceA.search({ query: 'alpha', limit: 5 })).every((item) =>
      String(item.id).includes('workspace-a')
    ),
    true
  );
  assert.equal(await workspaceA.deleteSource('file-a'), 2);
  assert.equal((await workspaceA.search({ query: 'alpha', limit: 5 })).length, 0);
  assert.ok((await workspaceB.search({ query: 'alpha', limit: 5 })).length > 0);
});

test('P19 RAG reindex hides stale chunks when a source shrinks', async () => {
  await assertReindexHidesStaleChunks(createInMemoryRagVectorStore());
  await assertReindexHidesStaleChunks(createRuntimeStoreRagVectorStore(createInMemoryRuntimeStore()));
});

test('P8 runtime-store RAG vector store persists source and chunk ledger', async () => {
  const store = createInMemoryRuntimeStore();
  const vectorStore = createRuntimeStoreRagVectorStore(store);
  const ai = createStaticModuleAiRuntime();
  const indexer = createRagIndexer({
    productId: 'product-rag',
    workspaceId: 'workspace-rag',
    moduleId: 'rag-runtime-store',
    ai: ai.forModule('rag-runtime-store'),
    vectorStore,
    chunkSize: 10,
  });

  await indexer.index({
    sourceId: 'source-1',
    content: 'alpha beta gamma delta',
    metadata: { sourceType: 'note' },
  });
  const sources = await store.listRagSources({
    productId: 'product-rag',
    workspaceId: 'workspace-rag',
    moduleId: 'rag-runtime-store',
  });
  const chunks = await store.listRagChunks({
    productId: 'product-rag',
    workspaceId: 'workspace-rag',
    moduleId: 'rag-runtime-store',
    sourceId: 'source-1',
  });
  const results = await indexer.search({ query: 'alpha', limit: 5 });

  assert.equal(sources[0]?.sourceId, 'source-1');
  assert.equal(sources[0]?.status, 'indexed');
  assert.equal(sources[0]?.chunkCount, chunks.length);
  assert.ok(sources[0]?.contentDigest);
  assert.ok(chunks.length > 1);
  assert.ok(results.length > 0);

  assert.equal(await indexer.deleteSource('source-1'), chunks.length);
  const deletedSources = await store.listRagSources({
    productId: 'product-rag',
    workspaceId: 'workspace-rag',
    moduleId: 'rag-runtime-store',
    sourceId: 'source-1',
  });
  assert.equal(deletedSources[0]?.status, 'deleted');
  assert.equal(
    (
      await store.listRagChunks({
        productId: 'product-rag',
        workspaceId: 'workspace-rag',
        moduleId: 'rag-runtime-store',
      })
    ).length,
    0
  );
});

test('P8 Postgres RAG vector store isolates workspace source and chunk ledger', async (t) => {
  if (!(await databaseReachable())) {
    t.skip(`Postgres is not reachable at ${DATABASE_URL}. Start it with npm run db:up.`);
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await resetRagRuntimeTables(pool);
    const store = createPostgresRuntimeStore({
      database: createPgModuleDataExecutor(pool),
    });
    await store.ensureSchema?.();
    const vectorStore = createRuntimeStoreRagVectorStore(store);
    const ai = createStaticModuleAiRuntime();
    const productId = 'product-rag-postgres';
    const moduleId = 'rag-postgres-store';
    const createIndexer = (workspaceId: string) =>
      createRagIndexer({
        productId,
        workspaceId,
        moduleId,
        ai: ai.forModule(moduleId),
        vectorStore,
        chunkSize: 20,
      });
    const workspaceA = createIndexer('workspace-a');
    const workspaceB = createIndexer('workspace-b');

    await workspaceA.index({
      sourceId: 'shared-source',
      content: 'alpha launch notes for workspace A',
      metadata: { workspace: 'workspace-a' },
    });
    await workspaceB.index({
      sourceId: 'shared-source',
      content: 'alpha private notes for workspace B',
      metadata: { workspace: 'workspace-b' },
    });

    const resultsA = await workspaceA.search({ query: 'alpha notes', limit: 5 });
    const resultsB = await workspaceB.search({ query: 'alpha notes', limit: 5 });
    assert.ok(resultsA.length > 0);
    assert.ok(resultsB.length > 0);
    assert.ok(resultsA.every((result) => result.metadata.workspace === 'workspace-a'));
    assert.ok(resultsB.every((result) => result.metadata.workspace === 'workspace-b'));
    assert.equal(
      (
        await store.listRagSources({
          productId,
          workspaceId: 'workspace-a',
          moduleId,
          sourceId: 'shared-source',
        })
      ).length,
      1
    );
    assert.equal(
      (
        await store.listRagSources({
          productId,
          workspaceId: 'workspace-b',
          moduleId,
          sourceId: 'shared-source',
        })
      ).length,
      1
    );

    const deleted = await workspaceA.deleteSource('shared-source');
    assert.ok(deleted > 0);
    assert.equal((await workspaceA.search({ query: 'alpha notes', limit: 5 })).length, 0);
    assert.ok((await workspaceB.search({ query: 'alpha notes', limit: 5 })).length > 0);
    assert.equal(
      (
        await store.listRagChunks({
          productId,
          workspaceId: 'workspace-b',
          moduleId,
          sourceId: 'shared-source',
        })
      ).length > 0,
      true
    );
  } finally {
    await pool.end();
  }
});

test('K7 host RAG provider uses vector indexer, workspace isolation and audit hooks', async () => {
  const ai = createStaticModuleAiRuntime();
  const store = createInMemoryRuntimeStore();
  const suffix = Date.now().toString(36);
  const productId = `host-rag-product-${suffix}`;
  const moduleId = 'host-rag-test';
  const audits: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
  const createRag = (workspaceId: string) =>
    createHostModuleRagApi({
      moduleId,
      session: {
        user: { id: 'user-rag', role: 'admin' },
        userId: 'user-rag',
        actorId: 'user-rag',
        productId,
        workspaceId,
      },
      ai: ai.forModule(moduleId),
      store,
      durable: true,
      audit(record) {
        audits.push({ type: record.type, metadata: record.metadata });
      },
      env: {
        PLOYKIT_RAG_PROVIDER: 'memory-vector',
        PLOYKIT_RAG_CHUNK_SIZE: '20',
      },
    });
  const workspaceA = `workspace-a-${suffix}`;
  const workspaceB = `workspace-b-${suffix}`;
  const ragA = createRag(workspaceA);
  const ragB = createRag(workspaceB);

  const documentA = await ragA.index({
    id: `source-a-${suffix}`,
    content: 'alpha product launch notes for workspace A',
    metadata: { workspace: workspaceA },
  });
  await ragB.index({
    id: `source-b-${suffix}`,
    content: 'alpha private notes for workspace B',
    metadata: { workspace: workspaceB },
  });
  const resultsA = await ragA.search({ query: 'alpha workspace', limit: 5 });
  const resultsB = await ragB.search({ query: 'alpha workspace', limit: 5 });
  const packA = await ragA.contextPack({ query: 'launch', limit: 2 });

  assert.equal(documentA.id, `source-a-${suffix}`);
  assert.ok(resultsA.length > 0);
  assert.ok(resultsB.length > 0);
  assert.ok(resultsA.every((result) => result.metadata.workspace === workspaceA));
  assert.ok(resultsB.every((result) => result.metadata.workspace === workspaceB));
  assert.ok(packA.context.includes('workspace A'));
  await ragA.delete(documentA.id);
  assert.equal((await ragA.search({ query: 'alpha workspace', limit: 5 })).length, 0);
  assert.ok((await ragB.search({ query: 'alpha workspace', limit: 5 })).length > 0);
  assert.ok(audits.some((record) => record.type === 'host.rag.indexed'));
  assert.ok(audits.some((record) => record.type === 'host.rag.context_pack_built'));
  assert.ok(audits.some((record) => record.type === 'host.rag.deleted'));
  assert.equal(
    (
      await store.listProviderInvocations({
        productId,
        providerId: 'memory-vector',
        kind: 'rag',
      })
    ).some((record) => record.operation === 'index' && record.status === 'succeeded'),
    true
  );
});
