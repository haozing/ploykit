import fs from 'node:fs/promises';
import path from 'node:path';
import {
  randomUUID } from 'node:crypto';
import {
  createInMemoryRagVectorStore,
  createInMemoryRuntimeStore,
  createRuntimeStoreNotificationRuntime,
} from '../src/lib/module-runtime';
import {
  createLocalModuleFileStorage,
  createModuleAiProviderRegistry,
  createProviderModuleAiRuntime,
  createRuntimeStoreCommercialRuntime,
  createStorageBackedModuleFileRuntime,
  type ModuleAiProvider,
} from '../src/lib/module-capabilities';

type SmokeCheck = {
  id: string;
  ok: boolean;
  durationMs: number;
  detail?: unknown;
  error?: string;
};

const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'provider-local-smoke',
  checkedAt.replace(/[:.]/g, '-')
);
const fileRoot = path.join(outputDir, 'files');
const reportPath = path.join(outputDir, 'smoke.json');
const productId = 'provider-local-smoke-product';
const workspaceId = 'provider-local-smoke-workspace';
const moduleId = 'provider-local-smoke';
const userId = 'provider-local-smoke-user';
const checks: SmokeCheck[] = [];
let nextId = 0;

function createId(prefix: string): string {
  nextId += 1;
  return `${prefix}_${nextId}`;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function check(id: string, task: () => Promise<unknown>): Promise<void> {
  const startedAt = Date.now();
  try {
    const detail = await task();
    checks.push({
      id,
      ok: true,
      durationMs: Date.now() - startedAt,
      detail,
    });
  } catch (error) {
    checks.push({
      id,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const store = createInMemoryRuntimeStore({
  now: () => new Date('2026-05-21T00:00:00.000Z'),
  createId,
});
const storage = createLocalModuleFileStorage({
  rootDir: fileRoot,
  publicBaseUrl: 'http://localhost/local-provider-smoke/',
});
const fileRuntime = createStorageBackedModuleFileRuntime({
  store,
  storage,
  productId,
  workspaceId,
  ownerId: userId,
  quota: {
    perUserBytes: 1024,
    perWorkspaceBytes: 2048,
    perModuleBytes: 1024,
  },
  defaultSignedUrlSeconds: 60,
  mediaSecret: `provider-local-smoke-${randomUUID()}`,
});
const commercial = createRuntimeStoreCommercialRuntime({
  store,
  productId,
  workspaceId,
  planCatalog: [{ id: 'pro', name: 'Pro', entitlements: ['pro', 'ai'] }],
  skuCatalog: {
    'local-pro-pack': {
      credits: { amount: 25, unit: 'credit' },
      planId: 'pro',
      entitlements: ['exports'],
      metadata: { smoke: 'local-provider' },
    },
  },
  now: () => new Date('2026-05-21T00:00:00.000Z'),
});
const notifications = createRuntimeStoreNotificationRuntime({
  store,
  productId,
  workspaceId,
});

const localAiProvider: ModuleAiProvider = {
  id: 'local-smoke-ai',
  async generateText(input) {
    const text = `local-smoke:${input.prompt}`;
    return {
      text,
      model: input.model,
      usage: {
        inputTokens: Math.max(1, Math.ceil(input.prompt.length / 4)),
        outputTokens: Math.max(1, Math.ceil(text.length / 4)),
      },
    };
  },
  async embedText(input) {
    const value = [...input.text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return {
      embedding: [input.text.length, value % 997, (value % 37) / 37],
      model: input.model,
      usage: {
        inputTokens: Math.max(1, Math.ceil(input.text.length / 4)),
      },
    };
  },
};
const ai = createProviderModuleAiRuntime({
  registry: createModuleAiProviderRegistry({
    providers: [localAiProvider],
    policy: {
      text: { providerId: 'local-smoke-ai', model: 'local-text' },
      embedding: { providerId: 'local-smoke-ai', model: 'local-embedding' },
    },
  }),
  usage: (scopedModuleId) => commercial.forModule(scopedModuleId).usage,
  metering: (scopedModuleId) => commercial.forModule(scopedModuleId).metering,
  credits: (scopedModuleId) => commercial.forModule(scopedModuleId).credits,
  userId,
  costPolicy: {
    generateTextCredits: 1,
    embedTextCredits: 1,
  },
  evidence: async (record) => {
    await store.recordProviderInvocation({
      productId,
      workspaceId,
      ...record,
      kind: 'ai',
      status: 'succeeded',
    });
  },
});

await fs.mkdir(outputDir, { recursive: true });

const directStorageKey = `direct/${randomUUID()}.txt`;
const directStorageBody = new TextEncoder().encode('local provider smoke');
await check('local-storage-put', async () => {
  const head = await storage.put({
    key: directStorageKey,
    body: directStorageBody,
    contentType: 'text/plain',
    metadata: { smoke: 'local-provider' },
  });
  assert(head.sizeBytes === directStorageBody.byteLength, 'LOCAL_STORAGE_SIZE_MISMATCH');
  return { key: directStorageKey, checksum: head.checksum };
});

await check('local-storage-head-read', async () => {
  const head = await storage.head(directStorageKey);
  assert(head, 'LOCAL_STORAGE_HEAD_MISSING');
  assert(head.metadata.smoke === 'local-provider', 'LOCAL_STORAGE_METADATA_MISMATCH');
  const object = await storage.get(directStorageKey, { start: 0, end: 4 });
  assert(object, 'LOCAL_STORAGE_OBJECT_MISSING');
  assert(new TextDecoder().decode(object.body) === 'local', 'LOCAL_STORAGE_RANGE_MISMATCH');
  return { sizeBytes: head.sizeBytes, rangeBytes: object.body.byteLength };
});

await check('local-storage-signed-url', async () => {
  const signedUrl = await storage.createSignedUrl({
    key: directStorageKey,
    operation: 'read',
    expiresInSeconds: 60,
    disposition: 'attachment',
  });
  assert(signedUrl.includes('operation=read'), 'LOCAL_STORAGE_SIGNED_URL_MISSING_OPERATION');
  assert(
    signedUrl.includes('expiresInSeconds=60'),
    'LOCAL_STORAGE_SIGNED_URL_MISSING_EXPIRY'
  );
  return signedUrl;
});

await check('local-storage-delete', async () => {
  await storage.delete(directStorageKey);
  const head = await storage.head(directStorageKey);
  assert(!head, 'LOCAL_STORAGE_DELETE_STILL_EXISTS');
  return 'deleted';
});

let uploadedFileId = '';
await check('module-files-upload-complete-read', async () => {
  const files = fileRuntime.forModule(moduleId);
  const upload = await files.createUpload({
    name: 'smoke.txt',
    purpose: 'source',
    contentType: 'text/plain',
    sizeBytes: 11,
  });
  const ready = await files.completeUpload(upload.file.id, { content: 'hello smoke' });
  uploadedFileId = ready.id;
  const read = await files.read(ready.id);
  assert(read?.status === 'ready', 'MODULE_FILE_NOT_READY');
  assert(read.sizeBytes === 11, 'MODULE_FILE_SIZE_MISMATCH');
  return { id: read.id, storageKey: read.storageKey, status: read.status };
});

await check('module-files-media-gateway', async () => {
  const files = fileRuntime.forModule(moduleId);
  const signedUrl = await files.createSignedUrl(uploadedFileId, { expiresInSeconds: 60 });
  const url = new URL(signedUrl, 'http://localhost');
  const response = await fileRuntime.mediaGateway.resolve({
    fileId: uploadedFileId,
    token: url.searchParams.get('token') ?? undefined,
    range: { start: 0, end: 4 },
  });
  assert(response.status === 206, `MODULE_MEDIA_GATEWAY_UNEXPECTED_STATUS:${response.status}`);
  assert(
    response.body && new TextDecoder().decode(response.body) === 'hello',
    'MODULE_MEDIA_GATEWAY_BODY_MISMATCH'
  );
  return { status: response.status, contentRange: response.headers['content-range'] };
});

await check('module-files-quota-denied', async () => {
  const files = fileRuntime.forModule(moduleId);
  try {
    await files.createUpload({
      name: 'too-large.bin',
      purpose: 'source',
      sizeBytes: 4096,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert(message.includes('MODULE_FILE_QUOTA'), `UNEXPECTED_QUOTA_ERROR:${message}`);
    return message;
  }
  throw new Error('MODULE_FILE_QUOTA_NOT_ENFORCED');
});

let checkoutId = '';
await check('local-billing-checkout-paid-benefits', async () => {
  const commerce = commercial.forModule(moduleId).commerce;
  const checkout = await commerce.createCheckout({
    userId,
    sku: 'local-pro-pack',
    amount: 1200,
    currency: 'usd',
    idempotencyKey: 'local-provider-checkout',
  });
  checkoutId = checkout.id;
  const paid = await commercial.provider.applyCheckoutPaid({
    provider: 'local',
    providerRef: 'local-provider-checkout-paid',
    orderId: checkout.id,
    userId,
    sku: 'local-pro-pack',
    amount: 1200,
    currency: 'usd',
    idempotencyKey: 'local-provider-paid',
  });
  assert(paid.order.status === 'paid', 'LOCAL_BILLING_ORDER_NOT_PAID');
  assert(paid.credits.length === 1, 'LOCAL_BILLING_CREDIT_NOT_GRANTED');
  assert(paid.entitlements.length >= 3, 'LOCAL_BILLING_ENTITLEMENTS_NOT_GRANTED');
  return {
    checkoutId: checkout.id,
    status: paid.order.status,
    credits: paid.credits.length,
    entitlements: paid.entitlements.map((grant) => grant.entitlement),
  };
});

await check('local-billing-ledger-reconcile', async () => {
  const scoped = commercial.forModule(moduleId);
  const hasAi = await scoped.billing.hasEntitlement(userId, 'ai');
  const balance = await scoped.credits.balance(userId);
  const creditReconcile = await commercial.admin.reconcileCredits(userId);
  const benefitReconcile = await commercial.provider.reconcilePaidOrderBenefits({ userId });
  assert(hasAi, 'LOCAL_BILLING_ENTITLEMENT_MISSING');
  assert(balance.balance === 25, `LOCAL_BILLING_BALANCE_MISMATCH:${balance.balance}`);
  assert(creditReconcile.ok, 'LOCAL_BILLING_CREDIT_RECONCILE_FAILED');
  assert(benefitReconcile.checked === 1, 'LOCAL_BILLING_BENEFIT_RECONCILE_NOT_CHECKED');
  assert(benefitReconcile.repaired === 0, 'LOCAL_BILLING_BENEFIT_REPAIR_UNEXPECTED');
  return { checkoutId, balance, creditReconcile, benefitReconcile };
});

await check('ai-provider-generate-embed-metered', async () => {
  const moduleAi = ai.forModule('provider-ai-smoke');
  const text = await moduleAi.generateText({
    prompt: 'hello provider',
    idempotencyKey: 'ai-generate-local-smoke',
  });
  const embedding = await moduleAi.embedText({
    text: 'hello provider',
    idempotencyKey: 'ai-embed-local-smoke',
  });
  const balance = await commercial.forModule(moduleId).credits.balance(userId);
  const usage = await store.listUsage({ productId, moduleId: 'provider-ai-smoke' });
  const metering = await store.listMetering({ productId, moduleId: 'provider-ai-smoke' });
  const invocations = await store.listProviderInvocations({
    productId,
    moduleId: 'provider-ai-smoke',
    providerId: 'local-smoke-ai',
  });
  const providerInvocationLedger = {
    invocations: invocations.length,
    successful: invocations.filter((record) => record.status === 'succeeded').length,
    failed: invocations.filter((record) => record.status === 'failed').length,
    operations: invocations.map((record) => record.operation).sort(),
    kinds: [...new Set(invocations.map((record) => record.kind))].sort(),
    models: invocations.map((record) => record.model).filter(Boolean).sort(),
  };
  assert(text.text === 'local-smoke:hello provider', 'AI_PROVIDER_TEXT_MISMATCH');
  assert(embedding.embedding.length === 3, 'AI_PROVIDER_EMBEDDING_MISMATCH');
  assert(balance.balance === 23, `AI_PROVIDER_CREDIT_BALANCE_MISMATCH:${balance.balance}`);
  assert(usage.length === 2, `AI_PROVIDER_USAGE_MISMATCH:${usage.length}`);
  assert(
    metering.filter((entry) => entry.status === 'committed').length === 2,
    'AI_PROVIDER_METERING_NOT_COMMITTED'
  );
  assert(invocations.length === 2, `AI_PROVIDER_INVOCATION_LEDGER_MISMATCH:${invocations.length}`);
  return {
    textModel: text.model,
    embeddingModel: embedding.model,
    balance,
    usage: usage.map((entry) => entry.meter),
    metering: metering.map((entry) => entry.status),
    providerInvocationLedger,
  };
});

await check('rag-memory-vector-store', async () => {
  const vectorStore = createInMemoryRagVectorStore();
  await vectorStore.upsert({
    id: 'rag-vector-1',
    productId,
    workspaceId,
    moduleId,
    sourceId: 'source-1',
    content: 'PloyKit local provider smoke document',
    embedding: [1, 2, 3],
    metadata: { smoke: 'local-provider' },
  });
  const matches = await vectorStore.search({
    productId,
    workspaceId,
    moduleId,
    embedding: [1, 2, 3],
    limit: 1,
  });
  assert(matches[0]?.id === 'rag-vector-1', 'RAG_VECTOR_SEARCH_MISMATCH');
  const deleted = await vectorStore.deleteBySource({
    productId,
    workspaceId,
    moduleId,
    sourceId: 'source-1',
  });
  assert(deleted === 1, 'RAG_VECTOR_DELETE_MISMATCH');
  return { match: matches[0]?.id, score: matches[0]?.score, deleted };
});

await check('notifications-runtime-store', async () => {
  const moduleNotifications = notifications.forModule(moduleId);
  const notification = await moduleNotifications.send({
    userId,
    channel: 'inApp',
    title: 'Provider smoke',
    body: 'Local provider smoke completed.',
    metadata: {
      category: 'system',
      idempotencyKey: 'provider-local-smoke-notification',
    },
  });
  const listed = await moduleNotifications.list({ userId, status: 'unread' });
  const read = await moduleNotifications.markRead(notification.id);
  const delivery = await store.recordNotificationDelivery({
    notificationId: notification.id,
    productId,
    workspaceId,
    userId,
    provider: 'log',
    status: 'delivered',
    metadata: { smoke: 'local-provider' },
  });
  assert(listed.length === 1, `NOTIFICATION_LIST_MISMATCH:${listed.length}`);
  assert(read.status === 'read', 'NOTIFICATION_READ_MISMATCH');
  assert(delivery.status === 'delivered', 'NOTIFICATION_DELIVERY_MISMATCH');
  return { notificationId: notification.id, status: read.status, delivery: delivery.status };
});

const result = {
  ok: checks.every((item) => item.ok),
  skipped: false,
  checkedAt,
  providers: {
    files: {
      mode: 'local',
      smoke: 'storage-adapter + storage-backed-runtime + quota + media-gateway',
      durableAdapter: true,
    },
    billing: {
      mode: 'local-ledger',
      smoke: 'runtime-store ledger + local paid checkout benefits + reconcile',
      durableWithPostgresRuntimeStore: true,
    },
    ai: {
      mode: 'provider-registry-local-smoke',
      smoke: 'provider registry + cost guard + usage + metering + credits',
    },
    rag: {
      mode: 'memory-vector-store',
      smoke: 'upsert + search + delete',
      durableAdapter: false,
    },
    notifications: {
      mode: 'runtime-store',
      smoke: 'send + list + read + delivery log',
      durableWithPostgresRuntimeStore: true,
    },
  },
  domainEvidence: {
    providerInvocationLedger: (() => {
      const detail = checks.find((item) => item.id === 'ai-provider-generate-embed-metered')
        ?.detail as { providerInvocationLedger?: unknown } | undefined;
      return detail?.providerInvocationLedger ?? {
        invocations: 0,
        successful: 0,
        failed: 0,
        operations: [],
      };
    })(),
  },
  artifacts: {
    report: reportPath,
    filesRoot: fileRoot,
  },
  checks,
};

await fs.writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
