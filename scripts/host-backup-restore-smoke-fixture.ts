import type { RuntimeStore } from '../src/lib/module-runtime';

export const backupRestoreSmokeScope = {
  productId: 'product-a',
  workspaceId: 'workspace-a',
  moduleId: 'hello',
  userId: 'user-1',
  redeemCode: 'BACKUP-WELCOME',
} as const;

const { productId, workspaceId, moduleId, userId, redeemCode } = backupRestoreSmokeScope;

export async function seedBackupRestoreSmokeStore(store: RuntimeStore) {
  await store.upsertProductScopeProduct({
    id: productId,
    name: 'Product A',
    profile: 'explicit-workspace',
    defaultWorkspaceId: workspaceId,
  });
  await store.upsertProductScopeWorkspace({
    id: workspaceId,
    productId,
    name: 'Workspace A',
    slug: workspaceId,
  });
  await store.upsertProductScopeDomainAlias({
    hostname: 'team.localhost',
    productId,
    workspaceId,
  });
  await store.upsertProductScopeInvite({
    id: 'invite-backup',
    productId,
    workspaceId,
    email: 'new@example.com',
    role: 'editor',
    status: 'pending',
    token: 'invite-token',
    expiresAt: '2026-06-01T00:00:00.000Z',
    invitedBy: userId,
  });
  await store.upsertMembership({
    productId,
    workspaceId,
    userId,
    role: 'owner',
    status: 'active',
  });
  await store.upsertHostUser({
    id: userId,
    productId,
    workspaceId,
    workspaceRole: 'owner',
    email: 'user@example.com',
    passwordHash: 'hash',
    role: 'admin',
    status: 'active',
    permissions: ['admin.audit.read'],
    metadata: { source: 'backup-smoke' },
  });
  await store.upsertSetting({
    productId,
    workspaceId,
    namespace: 'email',
    key: 'provider',
    value: { provider: 'log' },
    status: 'active',
    version: 2,
    metadata: { source: 'backup-smoke' },
  });
  await store.upsertServiceConnection({
    productId,
    workspaceId,
    moduleId,
    connectionId: 'hello:service:ai',
    service: 'ai',
    provider: 'static',
    status: 'active',
    authType: 'secret-ref',
    config: { model: 'static-text' },
    secretRefs: { apiKey: 'secret://ai/static' },
    health: { status: 'ready' },
    metadata: { source: 'backup-smoke' },
  });
  await store.upsertResourceBinding({
    productId,
    workspaceId,
    moduleId,
    bindingId: 'binding-backup',
    name: 'bucket',
    kind: 's3-bucket',
    value: { bucket: 'demo' },
    status: 'active',
    metadata: { source: 'backup-smoke' },
  });

  const run = await store.createRun({
    productId,
    workspaceId,
    moduleId,
    kind: 'job',
    name: 'backup-smoke',
    input: { source: 'backup-smoke' },
    idempotencyKey: 'backup-smoke-run',
  });
  await store.appendRunLog(run.id, 'info', 'backup smoke log', { requestId: 'req-backup' });
  await store.updateRunStatus(run.id, 'succeeded', {
    progress: 100,
    result: { ok: true },
  });

  const outbox = await store.enqueueOutbox({
    productId,
    workspaceId,
    moduleId,
    name: 'backup.smoke',
    payload: { runName: run.name },
    metadata: { source: 'backup-smoke' },
    idempotencyKey: 'backup-smoke-outbox',
    priority: 3,
    scheduledAt: '2026-05-20T00:01:00.000Z',
  });
  await store.markOutbox(outbox.id, 'processed');

  const receipt = await store.createWebhookReceipt({
    productId,
    workspaceId,
    moduleId,
    webhookName: 'backup',
    path: '/module-webhooks/hello/backup',
    method: 'POST',
    idempotencyKey: 'backup-smoke-webhook',
    signature: 'sha256=backup',
    headers: { 'x-provider-event': 'evt_backup' },
    bodyText: '{"event":"backup"}',
    bodyDigest: 'sha256:backup-body',
  });
  await store.markWebhookReceipt(receipt.id, 'processed');

  const notification = await store.createNotification({
    productId,
    workspaceId,
    moduleId,
    userId,
    title: 'Backup smoke finished',
    body: 'Semantic restore finished.',
    source: 'backup-smoke',
    category: 'system',
    status: 'unread',
    deliveryStatus: 'delivered',
    idempotencyKey: 'backup-smoke-notification',
    metadata: { source: 'backup-smoke' },
  });
  await store.recordNotificationDelivery({
    notificationId: notification.id,
    productId,
    workspaceId,
    userId,
    channel: 'inApp',
    provider: 'in-app',
    status: 'delivered',
    metadata: { source: 'backup-smoke' },
  });

  await store.recordDelivery({
    productId,
    workspaceId,
    moduleId,
    kind: 'job',
    source: 'backup.smoke',
    target: moduleId,
    status: 'delivered',
    attempts: 1,
    outboxId: outbox.id,
    runId: run.id,
    receiptId: receipt.id,
    workerId: 'worker-backup',
    correlationId: 'corr-backup',
    causationId: 'cause-backup',
    metadata: { source: 'backup-smoke' },
  });
  await store.upsertWorkerHeartbeat({
    productId,
    workspaceId,
    workerId: 'worker-backup',
    profile: 'default',
    queueProfile: 'jobs-events-webhooks-email',
    status: 'running',
    processed: 1,
    failed: 0,
    deadLettered: 0,
    metadata: { source: 'backup-smoke' },
  });

  await store.recordAudit({
    productId,
    workspaceId,
    moduleId,
    actorId: 'system',
    type: 'backup.smoke.seeded',
    metadata: { runName: 'backup-smoke' },
  });
  await store.recordUsage({
    productId,
    workspaceId,
    moduleId,
    meter: 'backup.smoke',
    quantity: 1,
    unit: 'event',
    idempotencyKey: 'backup-smoke-usage',
    metadata: { source: 'backup-smoke' },
  });
  const metering = await store.recordMetering({
    productId,
    workspaceId,
    moduleId,
    meter: 'backup.smoke.cost',
    quantity: 2,
    unit: 'credit',
    idempotencyKey: 'backup-smoke-meter',
    metadata: { phase: 'authorized' },
  });
  await store.updateMeteringStatus(metering.id, 'committed', { phase: 'committed' });
  await store.recordCreditLedger({
    productId,
    workspaceId,
    userId,
    amount: 5,
    unit: 'credit',
    reason: 'backup-smoke-grant',
    status: 'available',
    idempotencyKey: 'backup-smoke-credit',
    expiresAt: '2026-06-01T00:00:00.000Z',
    metadata: { source: 'backup-smoke' },
  });
  await store.grantEntitlement({
    productId,
    workspaceId,
    userId,
    entitlement: 'backup.pro',
    planId: 'pro',
    source: 'backup-smoke',
    status: 'active',
    idempotencyKey: 'backup-smoke-entitlement',
    expiresAt: '2026-06-01T00:00:00.000Z',
    metadata: { source: 'backup-smoke' },
  });

  await store.upsertCommercialCatalogItem({
    productId,
    workspaceId,
    kind: 'sku',
    itemId: 'backup_sku',
    version: 1,
    status: 'published',
    value: { amount: 1000, currency: 'usd' },
    metadata: { source: 'backup-smoke' },
  });
  const order = await store.createCommercialOrder({
    productId,
    workspaceId,
    userId,
    sku: 'backup_sku',
    amount: 1000,
    currency: 'usd',
    provider: 'local',
    providerRef: 'order-provider-ref',
    idempotencyKey: 'backup-smoke-order',
    metadata: { source: 'backup-smoke' },
  });
  await store.updateCommercialOrderStatus(order.id, 'paid', { paidAt: '2026-05-20T00:02:00.000Z' });
  await store.upsertBillingAccount({
    productId,
    workspaceId,
    userId,
    status: 'active',
    customerProfile: { email: 'user@example.com' },
    providerCustomers: { local: 'cus_backup' },
    paymentMethods: [{ provider: 'local', kind: 'test-card' }],
    metadata: { source: 'backup-smoke' },
  });
  const invoice = await store.upsertInvoice({
    id: 'invoice-backup',
    productId,
    workspaceId,
    userId,
    orderId: order.id,
    number: 'INV-BACKUP',
    status: 'paid',
    subtotal: 1000,
    discount: 0,
    tax: 80,
    total: 1080,
    refunded: 0,
    fee: 30,
    net: 970,
    currency: 'usd',
    provider: 'local',
    providerRef: 'invoice-provider-ref',
    taxSnapshot: { jurisdiction: 'US-CA', taxIdMasked: 'US****' },
    lines: [{ sku: 'backup_sku', amount: 1000 }],
    metadata: { source: 'backup-smoke' },
    issuedAt: '2026-05-20T00:03:00.000Z',
    paidAt: '2026-05-20T00:04:00.000Z',
  });
  await store.createCreditNote({
    id: 'credit-note-backup',
    productId,
    workspaceId,
    userId,
    orderId: order.id,
    invoiceId: invoice.id,
    number: 'CN-BACKUP',
    status: 'issued',
    amount: 100,
    currency: 'usd',
    reason: 'backup-smoke-partial-refund',
    provider: 'local',
    providerRef: 'credit-note-provider-ref',
    lines: [{ sku: 'backup_sku', amount: 100 }],
    metadata: { source: 'backup-smoke' },
    issuedAt: '2026-05-20T00:05:00.000Z',
  });
  await store.upsertSubscription({
    id: 'subscription-backup',
    productId,
    workspaceId,
    userId,
    planId: 'pro',
    status: 'active',
    provider: 'local',
    providerRef: 'sub_backup',
    currentPeriodStart: '2026-05-20T00:00:00.000Z',
    currentPeriodEnd: '2026-06-20T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    renewalStrategy: 'auto',
    metadata: { source: 'backup-smoke' },
  });
  await store.createSubscriptionEvent({
    productId,
    workspaceId,
    userId,
    subscriptionId: 'subscription-backup',
    planId: 'pro',
    type: 'created',
    status: 'active',
    provider: 'local',
    providerRef: 'sub_evt_backup',
    effectiveAt: '2026-05-20T00:00:00.000Z',
    metadata: { source: 'backup-smoke' },
  });
  await store.upsertTaxProfile({
    productId,
    workspaceId,
    userId,
    status: 'validated',
    jurisdiction: 'US-CA',
    validationStatus: 'valid',
    profile: { company: 'Example Inc.', taxIdMasked: 'US****' },
    evidence: { source: 'backup-smoke' },
    metadata: { source: 'backup-smoke' },
  });
  await store.upsertRevenueBucket({
    productId,
    workspaceId,
    bucketDate: '2026-05-20',
    currency: 'usd',
    gross: 1000,
    discount: 0,
    tax: 80,
    refund: 100,
    fee: 30,
    net: 870,
    orders: 1,
    provider: 'local',
    metadata: { source: 'backup-smoke' },
  });
  await store.upsertSettlementBatch({
    id: 'settlement-backup',
    productId,
    workspaceId,
    provider: 'local',
    currency: 'usd',
    periodStart: '2026-05-20T00:00:00.000Z',
    periodEnd: '2026-05-20T23:59:59.999Z',
    status: 'reconciled',
    gross: 1000,
    refund: 100,
    fee: 30,
    net: 870,
    orderCount: 1,
    invoiceCount: 1,
    creditNoteCount: 1,
    metadata: { source: 'backup-smoke' },
  });

  await store.recordProviderInvocation({
    productId,
    workspaceId,
    moduleId,
    providerId: 'host-ai-static',
    kind: 'ai',
    operation: 'generateText',
    status: 'succeeded',
    target: 'static',
    model: 'static-text',
    serviceConnectionId: 'hello:service:ai',
    resourceBindingId: 'binding-backup',
    usage: { inputTokens: 2, outputTokens: 3 },
    cost: { credits: 1, unit: 'credit' },
    latencyMs: 5,
    correlationId: 'corr-backup',
    metadata: { source: 'backup-smoke' },
  });
  await store.upsertRagSource({
    productId,
    workspaceId,
    moduleId,
    sourceId: 'source-backup',
    status: 'indexed',
    contentDigest: 'sha256:source',
    contentLength: 12,
    chunkCount: 1,
    indexedAt: '2026-05-20T00:06:00.000Z',
    metadata: { source: 'backup-smoke' },
  });
  await store.upsertRagChunk({
    id: 'rag-chunk-backup',
    productId,
    workspaceId,
    moduleId,
    sourceId: 'source-backup',
    chunkIndex: 0,
    content: 'hello backup',
    embedding: [0.1, 0.2, 0.3],
    metadata: { source: 'backup-smoke' },
  });
  await store.upsertRedeemCode({
    productId,
    code: redeemCode,
    entitlement: 'backup.pro',
    creditsAmount: 1,
    creditsUnit: 'credit',
    maxRedemptions: 5,
    expiresAt: '2026-06-01T00:00:00.000Z',
    metadata: { source: 'backup-smoke' },
  });
  await store.recordRedeemRedemption({
    productId,
    workspaceId,
    code: redeemCode,
    userId,
    entitlement: 'backup.pro',
    creditsAmount: 1,
    creditsUnit: 'credit',
    idempotencyKey: 'backup-smoke-redemption',
    metadata: { source: 'backup-smoke' },
  });

  const file = await store.createFile({
    productId,
    workspaceId,
    moduleId,
    actorId: userId,
    ownerId: userId,
    name: 'backup-report.txt',
    purpose: 'result',
    status: 'uploading',
    visibility: 'private',
    contentType: 'text/plain',
    storageKey: 'product-a/workspace-a/hello/backup-report.txt',
    runId: run.id,
    metadata: { source: 'backup-smoke' },
  });
  await store.updateFile(file.id, {
    status: 'ready',
    sizeBytes: 12,
    checksum: 'sha256:file',
    metadata: { source: 'backup-smoke', restored: false },
  });
  await store.upsertCatalogState({
    productId,
    moduleId,
    status: 'enabled',
    bundleId: 'backup-demo',
    required: true,
  });
}
