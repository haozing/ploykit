import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createInMemoryRuntimeStore,
} from '../src/lib/module-runtime';
import {
  createStaticModuleAiRuntime,
} from '../src/lib/module-capabilities';
import type { ModuleHostSession } from '../src/lib/module-runtime/host/session';
import {
  createHostModuleRagApi,
  getHostRagProviderStatus,
} from '../apps/host-next/lib/rag-provider';

const checkedAt = new Date().toISOString();
const suffix = Date.now().toString(36);
const audits: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
const store = createInMemoryRuntimeStore();
const ai = createStaticModuleAiRuntime();
const productId = `rag-smoke-product-${suffix}`;
const moduleId = 'rag-provider-smoke';

function session(workspaceId: string): ModuleHostSession {
  return {
    user: { id: 'rag-smoke-user', email: 'rag-smoke@example.com', role: 'admin' },
    userId: 'rag-smoke-user',
    actorId: 'rag-smoke-user',
    productId,
    workspaceId,
  };
}

function ragForWorkspace(workspaceId: string) {
  return createHostModuleRagApi({
    moduleId,
    session: session(workspaceId),
    ai: ai.forModule(moduleId),
    store,
    audit(record) {
      audits.push({ type: record.type, metadata: record.metadata });
    },
  });
}

const checks: Array<{
  id: string;
  ok: boolean;
  durationMs: number;
  detail: Record<string, unknown>;
  error?: string;
}> = [];

async function check(id: string, run: () => Promise<Record<string, unknown>>) {
  const startedAt = Date.now();
  try {
    const detail = await run();
    checks.push({ id, ok: true, durationMs: Date.now() - startedAt, detail });
  } catch (error) {
    checks.push({
      id,
      ok: false,
      durationMs: Date.now() - startedAt,
      detail: {},
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const workspaceA = `workspace-a-${suffix}`;
const workspaceB = `workspace-b-${suffix}`;
const ragA = ragForWorkspace(workspaceA);
const ragB = ragForWorkspace(workspaceB);
let workspaceADocumentId = '';
let workspaceBSearchCount = 0;

await check('rag-provider-status', async () => {
  const status = getHostRagProviderStatus(undefined, { durable: false });
  assert.equal(status.mode, 'memory-vector');
  assert.equal(status.configured, true);
  assert.equal(status.indexer.embeddings, 'host-ai');
  return status;
});

await check('rag-index-search-workspace-isolation', async () => {
  const documentA = await ragA.index({
    id: `source-a-${suffix}`,
    content: 'alpha product launch notes for workspace A',
    metadata: { smoke: true, workspace: workspaceA },
  });
  await ragB.index({
    id: `source-b-${suffix}`,
    content: 'alpha private notes for workspace B',
    metadata: { smoke: true, workspace: workspaceB },
  });
  workspaceADocumentId = documentA.id;
  const resultsA = await ragA.search({ query: 'alpha workspace A', limit: 5 });
  const resultsB = await ragB.search({ query: 'alpha workspace B', limit: 5 });
  workspaceBSearchCount = resultsB.length;

  assert.equal(documentA.id, `source-a-${suffix}`);
  assert.ok(resultsA.length > 0);
  assert.ok(resultsB.length > 0);
  assert.ok(resultsA.every((item) => item.metadata.workspace === workspaceA));
  assert.ok(resultsB.every((item) => item.metadata.workspace === workspaceB));
  return {
    documentId: documentA.id,
    workspaceAResults: resultsA.length,
    workspaceBResults: resultsB.length,
    firstResultMetadata: resultsA[0]?.metadata,
  };
});

await check('rag-context-pack-delete-audit', async () => {
  const pack = await ragA.contextPack({ query: 'launch notes', limit: 3 });
  assert.ok(pack.context.includes('workspace A'));
  await ragA.delete(workspaceADocumentId);
  const afterDelete = await ragA.search({ query: 'alpha workspace A', limit: 5 });
  const afterDeleteWorkspaceB = await ragB.search({ query: 'alpha workspace B', limit: 5 });

  assert.equal(afterDelete.length, 0);
  assert.equal(afterDeleteWorkspaceB.length, workspaceBSearchCount);
  assert.ok(audits.some((record) => record.type === 'host.rag.indexed'));
  assert.ok(audits.some((record) => record.type === 'host.rag.deleted'));
  return {
    contextLength: pack.context.length,
    afterDelete: afterDelete.length,
    workspaceBStillVisible: afterDeleteWorkspaceB.length,
    auditTypes: [...new Set(audits.map((record) => record.type))],
  };
});

const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'rag-provider',
  checkedAt.replace(/[:.]/g, '-')
);
const latestPath = path.resolve(process.cwd(), '.runtime', 'rag-provider', 'latest.json');
const reportPath = path.join(outputDir, 'rag-provider-smoke.json');
const ragSources = await store.listRagSources({ productId, moduleId });
const ragChunks = await store.listRagChunks({ productId, moduleId });
const ragInvocations = await store.listProviderInvocations({
  productId,
  kind: 'rag',
});
const ragProviderInvocationLedger = {
  invocations: ragInvocations.length,
  successful: ragInvocations.filter((record) => record.status === 'succeeded').length,
  failed: ragInvocations.filter((record) => record.status === 'failed').length,
  operations: [...new Set(ragInvocations.map((record) => record.operation))].sort(),
  kinds: ['rag'],
  ragSources: ragSources.length,
  ragChunks: ragChunks.length,
  connectorInvocations: 0,
};
const report = {
  ok: checks.every((item) => item.ok),
  required: true,
  profile: 'host-rag-provider',
  checkedAt,
  provider: getHostRagProviderStatus(undefined, { durable: false }),
  domainEvidence: {
    ragLedger: {
      sources: ragSources.length,
      chunks: ragChunks.length,
    },
    providerInvocationLedger: ragProviderInvocationLedger,
  },
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = report.ok ? 0 : 1;
