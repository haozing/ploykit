import fs from 'node:fs';
import path from 'node:path';
import {
  createInMemoryRuntimeStore,
  type RuntimeStore,
  type RuntimeStoreBillingAccount,
  type RuntimeStoreRedeemCode,
  type RuntimeStoreTaxProfileRecord,
} from '../src/lib/module-runtime';
import {
  backupRestoreSmokeScope,
  seedBackupRestoreSmokeStore,
} from './host-backup-restore-smoke-fixture';

const required = process.argv.includes('--required');
const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'backup-restore',
  checkedAt.replace(/[:.]/g, '-')
);
const reportPath = path.join(outputDir, 'backup-restore.json');
const latestPath = path.resolve(process.cwd(), '.runtime', 'backup-restore', 'latest.json');

const { productId, workspaceId, userId, redeemCode } = backupRestoreSmokeScope;

interface RuntimeStoreSnapshot {
  runs: Awaited<ReturnType<RuntimeStore['listRuns']>>;
  outbox: Awaited<ReturnType<RuntimeStore['listOutbox']>>;
  deliveries: Awaited<ReturnType<RuntimeStore['listDeliveries']>>;
  workers: Awaited<ReturnType<RuntimeStore['listWorkers']>>;
  webhookReceipts: Awaited<ReturnType<RuntimeStore['listWebhookReceipts']>>;
  notifications: Awaited<ReturnType<RuntimeStore['listNotifications']>>;
  notificationDeliveries: Awaited<ReturnType<RuntimeStore['listNotificationDeliveries']>>;
  audit: Awaited<ReturnType<RuntimeStore['listAudit']>>;
  usage: Awaited<ReturnType<RuntimeStore['listUsage']>>;
  metering: Awaited<ReturnType<RuntimeStore['listMetering']>>;
  credits: Awaited<ReturnType<RuntimeStore['listCreditLedger']>>;
  entitlements: Awaited<ReturnType<RuntimeStore['listEntitlements']>>;
  commercialCatalog: Awaited<ReturnType<RuntimeStore['listCommercialCatalogItems']>>;
  orders: Awaited<ReturnType<RuntimeStore['listCommercialOrders']>>;
  billingAccounts: RuntimeStoreBillingAccount[];
  invoices: Awaited<ReturnType<RuntimeStore['listInvoices']>>;
  creditNotes: Awaited<ReturnType<RuntimeStore['listCreditNotes']>>;
  subscriptions: Awaited<ReturnType<RuntimeStore['listSubscriptions']>>;
  subscriptionEvents: Awaited<ReturnType<RuntimeStore['listSubscriptionEvents']>>;
  taxProfiles: RuntimeStoreTaxProfileRecord[];
  revenueBuckets: Awaited<ReturnType<RuntimeStore['listRevenueBuckets']>>;
  settlementBatches: Awaited<ReturnType<RuntimeStore['listSettlementBatches']>>;
  providerInvocations: Awaited<ReturnType<RuntimeStore['listProviderInvocations']>>;
  ragSources: Awaited<ReturnType<RuntimeStore['listRagSources']>>;
  ragChunks: Awaited<ReturnType<RuntimeStore['listRagChunks']>>;
  redeemCodes: RuntimeStoreRedeemCode[];
  redeemRedemptions: Awaited<ReturnType<RuntimeStore['listRedeemRedemptions']>>;
  files: Awaited<ReturnType<RuntimeStore['listFiles']>>;
  catalogStates: Awaited<ReturnType<RuntimeStore['listCatalogStates']>>;
  memberships: Awaited<ReturnType<RuntimeStore['listMemberships']>>;
  products: Awaited<ReturnType<RuntimeStore['listProductScopeProducts']>>;
  workspaces: Awaited<ReturnType<RuntimeStore['listProductScopeWorkspaces']>>;
  domainAliases: Awaited<ReturnType<RuntimeStore['listProductScopeDomainAliases']>>;
  invites: Awaited<ReturnType<RuntimeStore['listProductScopeInvites']>>;
  hostUsers: Awaited<ReturnType<RuntimeStore['listHostUsers']>>;
  settings: Awaited<ReturnType<RuntimeStore['listSettings']>>;
  serviceConnections: Awaited<ReturnType<RuntimeStore['listServiceConnections']>>;
  resourceBindings: Awaited<ReturnType<RuntimeStore['listResourceBindings']>>;
}

function defined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)])
    );
  }
  return value;
}

function sortRecords<T>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    JSON.stringify(stable(left)).localeCompare(JSON.stringify(stable(right)))
  );
}

function summaryFromSnapshot(snapshot: RuntimeStoreSnapshot) {
  const counts = Object.fromEntries(
    Object.entries(snapshot).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])
  );
  return {
    ...counts,
    runLogs: snapshot.runs.reduce((sum, run) => sum + run.logs.length, 0),
  };
}

function createRestorePlan(snapshot: RuntimeStoreSnapshot) {
  const summary = summaryFromSnapshot(snapshot);
  return {
    level: 1,
    mode: 'runtime-store-semantic-snapshot',
    domains: Object.entries(summary)
      .filter(([key, value]) => key !== 'runLogs' && value > 0)
      .map(([key, value]) => ({ key, records: value })),
    warnings: [
      'semantic runtime-store smoke only',
      'does not prove pg_dump, WAL/PITR, or managed database snapshot restore',
      'does not copy or verify physical file objects',
      'does not restore secrets or external provider state',
      'starts restored worker-sensitive records in an isolated in-memory store',
    ],
  };
}

function fingerprint(snapshot: RuntimeStoreSnapshot) {
  return stable({
    runs: sortRecords(
      snapshot.runs.map((run) => ({
        moduleId: run.moduleId,
        kind: run.kind,
        name: run.name,
        status: run.status,
        progress: run.progress,
        result: run.result,
        error: run.error,
        input: run.input,
        logs: run.logs.map((log) => ({
          level: log.level,
          message: log.message,
          metadata: log.metadata,
        })),
      }))
    ),
    outbox: sortRecords(
      snapshot.outbox.map((record) => ({
        moduleId: record.moduleId,
        name: record.name,
        payload: record.payload,
        metadata: record.metadata,
        status: record.status,
        error: record.error,
        idempotencyKey: record.idempotencyKey,
        scheduledAt: record.scheduledAt,
        priority: record.priority,
      }))
    ),
    deliveries: sortRecords(
      snapshot.deliveries.map((record) => ({
        moduleId: record.moduleId,
        kind: record.kind,
        source: record.source,
        target: record.target,
        status: record.status,
        attempts: record.attempts,
        hasOutboxId: Boolean(record.outboxId),
        hasRunId: Boolean(record.runId),
        hasReceiptId: Boolean(record.receiptId),
        workerId: record.workerId,
        correlationId: record.correlationId,
        causationId: record.causationId,
        errorCategory: record.errorCategory,
        error: record.error,
        metadata: record.metadata,
      }))
    ),
    workers: sortRecords(
      snapshot.workers.map((record) => ({
        workerId: record.workerId,
        profile: record.profile,
        status: record.status,
        queueProfile: record.queueProfile,
        processed: record.processed,
        failed: record.failed,
        deadLettered: record.deadLettered,
        metadata: record.metadata,
      }))
    ),
    webhookReceipts: sortRecords(
      snapshot.webhookReceipts.map((record) => ({
        moduleId: record.moduleId,
        webhookName: record.webhookName,
        path: record.path,
        method: record.method,
        status: record.status,
        attempts: record.attempts,
        idempotencyKey: record.idempotencyKey,
        signature: record.signature,
        headers: record.headers,
        bodyDigest: record.bodyDigest,
        bodyText: record.bodyText,
        error: record.error,
      }))
    ),
    notifications: sortRecords(
      snapshot.notifications.map((record) => ({
        moduleId: record.moduleId,
        userId: record.userId,
        channel: record.channel,
        title: record.title,
        body: record.body,
        actionUrl: record.actionUrl,
        status: record.status,
        deliveryStatus: record.deliveryStatus,
        source: record.source,
        category: record.category,
        idempotencyKey: record.idempotencyKey,
        metadata: record.metadata,
      }))
    ),
    notificationDeliveries: sortRecords(
      snapshot.notificationDeliveries.map((record) => ({
        hasNotificationId: Boolean(record.notificationId),
        userId: record.userId,
        channel: record.channel,
        provider: record.provider,
        status: record.status,
        reason: record.reason,
        metadata: record.metadata,
      }))
    ),
    audit: sortRecords(
      snapshot.audit.map((record) => ({
        moduleId: record.moduleId,
        actorId: record.actorId,
        type: record.type,
        metadata: record.metadata,
      }))
    ),
    usage: sortRecords(
      snapshot.usage.map((record) => ({
        moduleId: record.moduleId,
        meter: record.meter,
        quantity: record.quantity,
        unit: record.unit,
        idempotencyKey: record.idempotencyKey,
        metadata: record.metadata,
      }))
    ),
    metering: sortRecords(
      snapshot.metering.map((record) => ({
        moduleId: record.moduleId,
        meter: record.meter,
        quantity: record.quantity,
        unit: record.unit,
        status: record.status,
        idempotencyKey: record.idempotencyKey,
        metadata: record.metadata,
      }))
    ),
    credits: sortRecords(
      snapshot.credits.map((record) => ({
        userId: record.userId,
        amount: record.amount,
        unit: record.unit,
        reason: record.reason,
        status: record.status,
        idempotencyKey: record.idempotencyKey,
        expiresAt: record.expiresAt,
        metadata: record.metadata,
      }))
    ),
    entitlements: sortRecords(
      snapshot.entitlements.map((record) => ({
        userId: record.userId,
        entitlement: record.entitlement,
        planId: record.planId,
        source: record.source,
        status: record.status,
        idempotencyKey: record.idempotencyKey,
        expiresAt: record.expiresAt,
        metadata: record.metadata,
      }))
    ),
    commercialCatalog: sortRecords(
      snapshot.commercialCatalog.map((record) => ({
        kind: record.kind,
        itemId: record.itemId,
        version: record.version,
        status: record.status,
        value: record.value,
        metadata: record.metadata,
      }))
    ),
    orders: sortRecords(
      snapshot.orders.map((record) => ({
        userId: record.userId,
        sku: record.sku,
        amount: record.amount,
        currency: record.currency,
        status: record.status,
        provider: record.provider,
        providerRef: record.providerRef,
        idempotencyKey: record.idempotencyKey,
        metadata: record.metadata,
      }))
    ),
    billingAccounts: sortRecords(
      snapshot.billingAccounts.map((record) => ({
        userId: record.userId,
        status: record.status,
        customerProfile: record.customerProfile,
        providerCustomers: record.providerCustomers,
        paymentMethods: record.paymentMethods,
        metadata: record.metadata,
      }))
    ),
    invoices: sortRecords(
      snapshot.invoices.map((record) => ({
        userId: record.userId,
        hasOrderId: Boolean(record.orderId),
        hasSubscriptionId: Boolean(record.subscriptionId),
        number: record.number,
        status: record.status,
        subtotal: record.subtotal,
        discount: record.discount,
        tax: record.tax,
        total: record.total,
        refunded: record.refunded,
        fee: record.fee,
        net: record.net,
        currency: record.currency,
        provider: record.provider,
        providerRef: record.providerRef,
        taxSnapshot: record.taxSnapshot,
        lines: record.lines,
        metadata: record.metadata,
      }))
    ),
    creditNotes: sortRecords(
      snapshot.creditNotes.map((record) => ({
        userId: record.userId,
        hasOrderId: Boolean(record.orderId),
        hasInvoiceId: Boolean(record.invoiceId),
        number: record.number,
        status: record.status,
        amount: record.amount,
        currency: record.currency,
        reason: record.reason,
        provider: record.provider,
        providerRef: record.providerRef,
        lines: record.lines,
        metadata: record.metadata,
      }))
    ),
    subscriptions: sortRecords(
      snapshot.subscriptions.map((record) => ({
        userId: record.userId,
        planId: record.planId,
        status: record.status,
        provider: record.provider,
        providerRef: record.providerRef,
        currentPeriodStart: record.currentPeriodStart,
        currentPeriodEnd: record.currentPeriodEnd,
        cancelAtPeriodEnd: record.cancelAtPeriodEnd,
        renewalStrategy: record.renewalStrategy,
        metadata: record.metadata,
      }))
    ),
    subscriptionEvents: sortRecords(
      snapshot.subscriptionEvents.map((record) => ({
        userId: record.userId,
        planId: record.planId,
        type: record.type,
        status: record.status,
        provider: record.provider,
        providerRef: record.providerRef,
        effectiveAt: record.effectiveAt,
        metadata: record.metadata,
      }))
    ),
    taxProfiles: sortRecords(
      snapshot.taxProfiles.map((record) => ({
        userId: record.userId,
        status: record.status,
        jurisdiction: record.jurisdiction,
        validationStatus: record.validationStatus,
        profile: record.profile,
        evidence: record.evidence,
        metadata: record.metadata,
      }))
    ),
    revenueBuckets: sortRecords(
      snapshot.revenueBuckets.map((record) => ({
        bucketDate: record.bucketDate,
        currency: record.currency,
        gross: record.gross,
        discount: record.discount,
        tax: record.tax,
        refund: record.refund,
        fee: record.fee,
        net: record.net,
        orders: record.orders,
        provider: record.provider,
        metadata: record.metadata,
      }))
    ),
    settlementBatches: sortRecords(
      snapshot.settlementBatches.map((record) => ({
        provider: record.provider,
        currency: record.currency,
        periodStart: record.periodStart,
        periodEnd: record.periodEnd,
        status: record.status,
        gross: record.gross,
        refund: record.refund,
        fee: record.fee,
        net: record.net,
        orderCount: record.orderCount,
        invoiceCount: record.invoiceCount,
        creditNoteCount: record.creditNoteCount,
        metadata: record.metadata,
      }))
    ),
    providerInvocations: sortRecords(
      snapshot.providerInvocations.map((record) => ({
        moduleId: record.moduleId,
        providerId: record.providerId,
        kind: record.kind,
        operation: record.operation,
        status: record.status,
        target: record.target,
        model: record.model,
        serviceConnectionId: record.serviceConnectionId,
        resourceBindingId: record.resourceBindingId,
        usage: record.usage,
        cost: record.cost,
        latencyMs: record.latencyMs,
        correlationId: record.correlationId,
        error: record.error,
        metadata: record.metadata,
      }))
    ),
    ragSources: sortRecords(
      snapshot.ragSources.map((record) => ({
        moduleId: record.moduleId,
        sourceId: record.sourceId,
        status: record.status,
        contentDigest: record.contentDigest,
        contentLength: record.contentLength,
        chunkCount: record.chunkCount,
        indexedAt: record.indexedAt,
        metadata: record.metadata,
      }))
    ),
    ragChunks: sortRecords(
      snapshot.ragChunks.map((record) => ({
        moduleId: record.moduleId,
        sourceId: record.sourceId,
        chunkIndex: record.chunkIndex,
        content: record.content,
        embedding: record.embedding,
        metadata: record.metadata,
      }))
    ),
    redeemCodes: sortRecords(
      snapshot.redeemCodes.map((record) => ({
        code: record.code,
        entitlement: record.entitlement,
        creditsAmount: record.creditsAmount,
        creditsUnit: record.creditsUnit,
        maxRedemptions: record.maxRedemptions,
        expiresAt: record.expiresAt,
        metadata: record.metadata,
      }))
    ),
    redeemRedemptions: sortRecords(
      snapshot.redeemRedemptions.map((record) => ({
        code: record.code,
        userId: record.userId,
        entitlement: record.entitlement,
        creditsAmount: record.creditsAmount,
        creditsUnit: record.creditsUnit,
        idempotencyKey: record.idempotencyKey,
        metadata: record.metadata,
      }))
    ),
    files: sortRecords(
      snapshot.files.map((record) => ({
        moduleId: record.moduleId,
        ownerId: record.ownerId,
        name: record.name,
        purpose: record.purpose,
        status: record.status,
        visibility: record.visibility,
        contentType: record.contentType,
        sizeBytes: record.sizeBytes,
        checksum: record.checksum,
        storageKey: record.storageKey,
        runId: Boolean(record.runId),
        metadata: record.metadata,
      }))
    ),
    catalogStates: sortRecords(
      snapshot.catalogStates.map((record) => ({
        productId: record.productId,
        moduleId: record.moduleId,
        status: record.status,
        bundleId: record.bundleId,
        required: record.required,
      }))
    ),
    memberships: sortRecords(
      snapshot.memberships.map((record) => ({
        productId: record.productId,
        workspaceId: record.workspaceId,
        userId: record.userId,
        role: record.role,
        status: record.status,
      }))
    ),
    products: sortRecords(snapshot.products),
    workspaces: sortRecords(snapshot.workspaces),
    domainAliases: sortRecords(snapshot.domainAliases),
    invites: sortRecords(snapshot.invites),
    hostUsers: sortRecords(
      snapshot.hostUsers.map((record) => ({
        id: record.id,
        email: record.email,
        role: record.role,
        status: record.status,
        productId: record.productId,
        workspaceId: record.workspaceId,
        workspaceRole: record.workspaceRole,
        permissions: record.permissions,
        metadata: record.metadata,
      }))
    ),
    settings: sortRecords(
      snapshot.settings.map((record) => ({
        namespace: record.namespace,
        key: record.key,
        value: record.value,
        status: record.status,
        version: record.version,
        metadata: record.metadata,
      }))
    ),
    serviceConnections: sortRecords(
      snapshot.serviceConnections.map((record) => ({
        connectionId: record.connectionId,
        moduleId: record.moduleId,
        service: record.service,
        provider: record.provider,
        status: record.status,
        environment: record.environment,
        authType: record.authType,
        config: record.config,
        secretRefs: record.secretRefs,
        health: record.health,
        metadata: record.metadata,
      }))
    ),
    resourceBindings: sortRecords(
      snapshot.resourceBindings.map((record) => ({
        bindingId: record.bindingId,
        moduleId: record.moduleId,
        name: record.name,
        kind: record.kind,
        value: record.value,
        status: record.status,
        metadata: record.metadata,
      }))
    ),
  });
}

async function snapshotStore(store: RuntimeStore): Promise<RuntimeStoreSnapshot> {
  const billingAccount = await store.getBillingAccount(productId, userId, workspaceId);
  const taxProfile = await store.getTaxProfile(productId, userId, workspaceId);
  const code = await store.getRedeemCode(productId, redeemCode);
  return {
    runs: await store.listRuns({ productId }),
    outbox: await store.listOutbox({ productId }),
    deliveries: await store.listDeliveries({ productId }),
    workers: await store.listWorkers({ productId }),
    webhookReceipts: await store.listWebhookReceipts({ productId }),
    notifications: await store.listNotifications({ productId }),
    notificationDeliveries: await store.listNotificationDeliveries({ productId }),
    audit: await store.listAudit({ productId }),
    usage: await store.listUsage({ productId }),
    metering: await store.listMetering({ productId }),
    credits: await store.listCreditLedger({ productId }),
    entitlements: await store.listEntitlements({ productId }),
    commercialCatalog: await store.listCommercialCatalogItems({ productId }),
    orders: await store.listCommercialOrders({ productId }),
    billingAccounts: [billingAccount].filter(defined),
    invoices: await store.listInvoices({ productId }),
    creditNotes: await store.listCreditNotes({ productId }),
    subscriptions: await store.listSubscriptions({ productId }),
    subscriptionEvents: await store.listSubscriptionEvents({ productId }),
    taxProfiles: [taxProfile].filter(defined),
    revenueBuckets: await store.listRevenueBuckets({ productId }),
    settlementBatches: await store.listSettlementBatches({ productId }),
    providerInvocations: await store.listProviderInvocations({ productId }),
    ragSources: await store.listRagSources({ productId }),
    ragChunks: await store.listRagChunks({ productId }),
    redeemCodes: [code].filter(defined),
    redeemRedemptions: await store.listRedeemRedemptions({ productId }),
    files: await store.listFiles({ productId }),
    catalogStates: await store.listCatalogStates({ productId }),
    memberships: await store.listMemberships({ productId }),
    products: await store.listProductScopeProducts({ productId }),
    workspaces: await store.listProductScopeWorkspaces({ productId }),
    domainAliases: await store.listProductScopeDomainAliases({ productId }),
    invites: await store.listProductScopeInvites({ productId }),
    hostUsers: await store.listHostUsers({ productId }),
    settings: await store.listSettings({ productId }),
    serviceConnections: await store.listServiceConnections({ productId }),
    resourceBindings: await store.listResourceBindings({ productId }),
  };
}

async function restoreSnapshot(snapshot: RuntimeStoreSnapshot, store: RuntimeStore) {
  const runIds = new Map<string, string>();
  const outboxIds = new Map<string, string>();
  const receiptIds = new Map<string, string>();
  const notificationIds = new Map<string, string>();
  const orderIds = new Map<string, string>();
  const invoiceIds = new Map<string, string>();

  for (const product of snapshot.products) {
    await store.upsertProductScopeProduct(product);
  }
  for (const workspace of snapshot.workspaces) {
    await store.upsertProductScopeWorkspace(workspace);
  }
  for (const alias of snapshot.domainAliases) {
    await store.upsertProductScopeDomainAlias(alias);
  }
  for (const invite of snapshot.invites) {
    await store.upsertProductScopeInvite(invite);
  }
  for (const membership of snapshot.memberships) {
    await store.upsertMembership(membership);
  }
  for (const user of snapshot.hostUsers) {
    await store.upsertHostUser(user);
  }
  for (const setting of snapshot.settings) {
    await store.upsertSetting({
      productId: setting.productId,
      workspaceId: setting.workspaceId,
      namespace: setting.namespace,
      key: setting.key,
      value: setting.value,
      status: setting.status,
      version: setting.version,
      metadata: setting.metadata,
    });
  }
  for (const connection of snapshot.serviceConnections) {
    await store.upsertServiceConnection({
      productId: connection.productId,
      workspaceId: connection.workspaceId,
      moduleId: connection.moduleId,
      connectionId: connection.connectionId,
      service: connection.service,
      provider: connection.provider,
      status: connection.status,
      environment: connection.environment,
      ownerType: connection.ownerType,
      scopeType: connection.scopeType,
      authType: connection.authType,
      config: connection.config,
      secretRefs: connection.secretRefs,
      health: connection.health,
      lastUsedAt: connection.lastUsedAt,
      metadata: connection.metadata,
    });
  }
  for (const binding of snapshot.resourceBindings) {
    await store.upsertResourceBinding({
      productId: binding.productId,
      workspaceId: binding.workspaceId,
      moduleId: binding.moduleId,
      bindingId: binding.bindingId,
      name: binding.name,
      kind: binding.kind,
      value: binding.value,
      status: binding.status,
      metadata: binding.metadata,
    });
  }

  for (const run of snapshot.runs) {
    const restored = await store.createRun({
      productId: run.productId,
      workspaceId: run.workspaceId,
      moduleId: run.moduleId,
      kind: run.kind,
      name: run.name,
      input: run.input,
      idempotencyKey: run.idempotencyKey ?? `restore:${run.id}`,
    });
    for (const log of run.logs) {
      await store.appendRunLog(restored.id, log.level, log.message, log.metadata);
    }
    await store.updateRunStatus(restored.id, run.status, {
      progress: run.progress,
      result: run.result,
      error: run.error,
    });
    runIds.set(run.id, restored.id);
  }
  for (const record of snapshot.outbox) {
    const restored = await store.enqueueOutbox({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      name: record.name,
      payload: record.payload,
      metadata: record.metadata,
      idempotencyKey: record.idempotencyKey ?? `restore:${record.id}`,
      priority: record.priority,
      scheduledAt: record.scheduledAt,
    });
    if (record.status !== 'queued') {
      await store.markOutbox(restored.id, record.status, record.error);
    }
    outboxIds.set(record.id, restored.id);
  }
  for (const record of snapshot.webhookReceipts) {
    const restored = await store.createWebhookReceipt({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      webhookName: record.webhookName,
      path: record.path,
      method: record.method,
      idempotencyKey: record.idempotencyKey ?? `restore:${record.id}`,
      signature: record.signature,
      headers: record.headers,
      bodyText: record.bodyText,
      bodyDigest: record.bodyDigest,
    });
    if (record.status !== 'received') {
      await store.markWebhookReceipt(restored.id, record.status, record.error);
    }
    receiptIds.set(record.id, restored.id);
  }
  for (const record of snapshot.notifications) {
    const restored = await store.createNotification({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      userId: record.userId,
      channel: record.channel,
      title: record.title,
      body: record.body,
      actionUrl: record.actionUrl,
      runId: record.runId ? runIds.get(record.runId) : undefined,
      source: record.source,
      category: record.category,
      status: record.status,
      deliveryStatus: record.deliveryStatus,
      idempotencyKey: record.idempotencyKey ?? `restore:${record.id}`,
      metadata: record.metadata,
      error: record.error,
    });
    notificationIds.set(record.id, restored.id);
  }
  for (const record of snapshot.notificationDeliveries) {
    await store.recordNotificationDelivery({
      notificationId: record.notificationId ? notificationIds.get(record.notificationId) : null,
      productId: record.productId,
      workspaceId: record.workspaceId,
      userId: record.userId,
      channel: record.channel,
      provider: record.provider,
      status: record.status,
      reason: record.reason,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.audit) {
    await store.recordAudit({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      actorId: record.actorId,
      type: record.type,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.usage) {
    await store.recordUsage({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      meter: record.meter,
      quantity: record.quantity,
      unit: record.unit,
      metadata: record.metadata,
      idempotencyKey: record.idempotencyKey ?? `restore:${record.id}`,
    });
  }
  for (const record of snapshot.metering) {
    const restored = await store.recordMetering({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      meter: record.meter,
      quantity: record.quantity,
      unit: record.unit,
      metadata: record.metadata,
      idempotencyKey: record.idempotencyKey ?? `restore:${record.id}`,
    });
    if (record.status !== 'authorized') {
      await store.updateMeteringStatus(restored.id, record.status, record.metadata);
    }
  }
  for (const record of snapshot.credits) {
    await store.recordCreditLedger({
      productId: record.productId,
      workspaceId: record.workspaceId,
      userId: record.userId,
      amount: record.amount,
      unit: record.unit,
      reason: record.reason,
      status: record.status,
      idempotencyKey: record.idempotencyKey ?? `restore:${record.id}`,
      expiresAt: record.expiresAt,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.entitlements) {
    await store.grantEntitlement({
      productId: record.productId,
      workspaceId: record.workspaceId,
      userId: record.userId,
      entitlement: record.entitlement,
      planId: record.planId,
      source: record.source,
      status: record.status,
      idempotencyKey: record.idempotencyKey ?? `restore:${record.id}`,
      expiresAt: record.expiresAt,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.commercialCatalog) {
    await store.upsertCommercialCatalogItem({
      productId: record.productId,
      workspaceId: record.workspaceId,
      kind: record.kind,
      itemId: record.itemId,
      version: record.version,
      status: record.status,
      value: record.value,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.orders) {
    const restored = await store.createCommercialOrder({
      productId: record.productId,
      workspaceId: record.workspaceId,
      userId: record.userId,
      sku: record.sku,
      amount: record.amount,
      currency: record.currency,
      provider: record.provider,
      providerRef: record.providerRef,
      idempotencyKey: record.idempotencyKey ?? `restore:${record.id}`,
      metadata: record.metadata,
    });
    if (record.status !== 'created') {
      await store.updateCommercialOrderStatus(restored.id, record.status, record.metadata);
    }
    orderIds.set(record.id, restored.id);
  }
  for (const record of snapshot.billingAccounts) {
    await store.upsertBillingAccount({
      productId: record.productId,
      workspaceId: record.workspaceId,
      userId: record.userId,
      status: record.status,
      customerProfile: record.customerProfile,
      providerCustomers: record.providerCustomers,
      paymentMethods: record.paymentMethods,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.subscriptions) {
    await store.upsertSubscription({
      id: record.id,
      productId: record.productId,
      workspaceId: record.workspaceId,
      userId: record.userId,
      planId: record.planId,
      status: record.status,
      provider: record.provider,
      providerRef: record.providerRef,
      currentPeriodStart: record.currentPeriodStart,
      currentPeriodEnd: record.currentPeriodEnd,
      trialEnd: record.trialEnd,
      cancelAtPeriodEnd: record.cancelAtPeriodEnd,
      renewalStrategy: record.renewalStrategy,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.invoices) {
    const restored = await store.upsertInvoice({
      id: record.id,
      productId: record.productId,
      workspaceId: record.workspaceId,
      userId: record.userId,
      orderId: record.orderId ? (orderIds.get(record.orderId) ?? record.orderId) : null,
      subscriptionId: record.subscriptionId,
      number: record.number,
      status: record.status,
      subtotal: record.subtotal,
      discount: record.discount,
      tax: record.tax,
      total: record.total,
      refunded: record.refunded,
      fee: record.fee,
      net: record.net,
      currency: record.currency,
      provider: record.provider,
      providerRef: record.providerRef,
      documentFileId: record.documentFileId,
      taxSnapshot: record.taxSnapshot,
      lines: record.lines,
      metadata: record.metadata,
      issuedAt: record.issuedAt,
      dueAt: record.dueAt,
      paidAt: record.paidAt,
    });
    invoiceIds.set(record.id, restored.id);
  }
  for (const record of snapshot.creditNotes) {
    await store.createCreditNote({
      id: record.id,
      productId: record.productId,
      workspaceId: record.workspaceId,
      userId: record.userId,
      orderId: record.orderId ? (orderIds.get(record.orderId) ?? record.orderId) : null,
      invoiceId: record.invoiceId ? (invoiceIds.get(record.invoiceId) ?? record.invoiceId) : null,
      number: record.number,
      status: record.status,
      amount: record.amount,
      currency: record.currency,
      reason: record.reason,
      provider: record.provider,
      providerRef: record.providerRef,
      lines: record.lines,
      metadata: record.metadata,
      issuedAt: record.issuedAt,
    });
  }
  for (const record of snapshot.subscriptionEvents) {
    await store.createSubscriptionEvent({
      productId: record.productId,
      workspaceId: record.workspaceId,
      userId: record.userId,
      subscriptionId: record.subscriptionId,
      planId: record.planId,
      type: record.type,
      status: record.status,
      provider: record.provider,
      providerRef: record.providerRef,
      effectiveAt: record.effectiveAt,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.taxProfiles) {
    await store.upsertTaxProfile({
      productId: record.productId,
      workspaceId: record.workspaceId,
      userId: record.userId,
      status: record.status,
      jurisdiction: record.jurisdiction,
      validationStatus: record.validationStatus,
      profile: record.profile,
      evidence: record.evidence,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.revenueBuckets) {
    await store.upsertRevenueBucket({
      productId: record.productId,
      workspaceId: record.workspaceId,
      bucketDate: record.bucketDate,
      currency: record.currency,
      gross: record.gross,
      discount: record.discount,
      tax: record.tax,
      refund: record.refund,
      fee: record.fee,
      net: record.net,
      orders: record.orders,
      provider: record.provider,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.settlementBatches) {
    await store.upsertSettlementBatch({
      id: record.id,
      productId: record.productId,
      workspaceId: record.workspaceId,
      provider: record.provider,
      currency: record.currency,
      periodStart: record.periodStart,
      periodEnd: record.periodEnd,
      status: record.status,
      gross: record.gross,
      refund: record.refund,
      fee: record.fee,
      net: record.net,
      orderCount: record.orderCount,
      invoiceCount: record.invoiceCount,
      creditNoteCount: record.creditNoteCount,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.providerInvocations) {
    await store.recordProviderInvocation({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      providerId: record.providerId,
      kind: record.kind,
      operation: record.operation,
      status: record.status,
      target: record.target,
      model: record.model,
      serviceConnectionId: record.serviceConnectionId,
      resourceBindingId: record.resourceBindingId,
      usage: record.usage,
      cost: record.cost,
      latencyMs: record.latencyMs,
      correlationId: record.correlationId,
      error: record.error,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.ragSources) {
    await store.upsertRagSource({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      sourceId: record.sourceId,
      status: record.status,
      contentDigest: record.contentDigest,
      contentLength: record.contentLength,
      chunkCount: record.chunkCount,
      indexedAt: record.indexedAt,
      deletedAt: record.deletedAt,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.ragChunks) {
    await store.upsertRagChunk({
      id: record.id,
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      sourceId: record.sourceId,
      chunkIndex: record.chunkIndex,
      content: record.content,
      embedding: record.embedding,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.redeemCodes) {
    await store.upsertRedeemCode(record);
  }
  for (const record of snapshot.redeemRedemptions) {
    await store.recordRedeemRedemption({
      productId: record.productId,
      workspaceId,
      code: record.code,
      userId: record.userId,
      entitlement: record.entitlement,
      creditsAmount: record.creditsAmount,
      creditsUnit: record.creditsUnit,
      idempotencyKey: record.idempotencyKey ?? `restore:${record.id}`,
      metadata: record.metadata,
    });
  }
  for (const record of snapshot.files) {
    const restored = await store.createFile({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      actorId: record.ownerId,
      ownerId: record.ownerId,
      name: record.name,
      purpose: record.purpose,
      status: 'uploading',
      visibility: record.visibility,
      contentType: record.contentType,
      storageKey: record.storageKey,
      runId: record.runId ? (runIds.get(record.runId) ?? undefined) : undefined,
      metadata: record.metadata,
      expiresAt: record.expiresAt,
    });
    await store.updateFile(restored.id, {
      status: record.status,
      visibility: record.visibility,
      contentType: record.contentType,
      sizeBytes: record.sizeBytes,
      checksum: record.checksum,
      metadata: record.metadata,
      expiresAt: record.expiresAt,
      publishedAt: record.publishedAt,
      deletedAt: record.deletedAt,
    });
  }
  for (const state of snapshot.catalogStates) {
    await store.upsertCatalogState(state);
  }
  for (const record of snapshot.deliveries) {
    await store.recordDelivery({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      actorId: record.actorId,
      kind: record.kind,
      source: record.source,
      target: record.target,
      status: record.status,
      attempts: record.attempts,
      outboxId: record.outboxId ? (outboxIds.get(record.outboxId) ?? null) : null,
      runId: record.runId ? (runIds.get(record.runId) ?? null) : null,
      receiptId: record.receiptId ? (receiptIds.get(record.receiptId) ?? null) : null,
      eventId: record.eventId,
      emailId: record.emailId,
      workerId: record.workerId,
      correlationId: record.correlationId,
      causationId: record.causationId,
      nextRetryAt: record.nextRetryAt,
      errorCategory: record.errorCategory,
      error: record.error,
      metadata: record.metadata,
    });
  }
  for (const worker of snapshot.workers) {
    await store.upsertWorkerHeartbeat({
      productId: worker.productId,
      workspaceId: worker.workspaceId,
      workerId: worker.workerId,
      profile: worker.profile,
      status: worker.status,
      queueProfile: worker.queueProfile,
      heartbeatAt: worker.heartbeatAt,
      lastDrainAt: worker.lastDrainAt,
      lastDurationMs: worker.lastDurationMs,
      processed: worker.processed,
      failed: worker.failed,
      deadLettered: worker.deadLettered,
      metadata: worker.metadata,
    });
  }
}

const source = createInMemoryRuntimeStore({
  now: () => new Date('2026-05-20T00:00:00.000Z'),
  createId: (() => {
    let next = 0;
    return (prefix: string) => `${prefix}_${++next}`;
  })(),
});
const restored = createInMemoryRuntimeStore({
  now: () => new Date('2026-05-20T00:00:00.000Z'),
  createId: (() => {
    let next = 0;
    return (prefix: string) => `${prefix}_restored_${++next}`;
  })(),
});

await seedBackupRestoreSmokeStore(source);
const before = await snapshotStore(source);
const restorePlan = createRestorePlan(before);
await restoreSnapshot(before, restored);
const after = await snapshotStore(restored);
const beforeSummary = summaryFromSnapshot(before);
const afterSummary = summaryFromSnapshot(after);
const beforeFingerprint = fingerprint(before);
const afterFingerprint = fingerprint(after);
const countsOk = JSON.stringify(stable(beforeSummary)) === JSON.stringify(stable(afterSummary));
const fingerprintOk = JSON.stringify(beforeFingerprint) === JSON.stringify(afterFingerprint);
const coveredDomains = restorePlan.domains.length;
const coverageOk = coveredDomains >= 30;
const ok = countsOk && fingerprintOk && coverageOk;
const result = {
  ok,
  required,
  checkedAt,
  mode: 'runtime-store-semantic-snapshot',
  level: 1,
  scope: {
    runtimeStore: 'memory',
    semanticOnly: true,
    postgresPhysicalBackup: false,
    objectStorageBackup: false,
    moduleDataV2PhysicalTables: false,
    secretsBackup: false,
  },
  restorePlan,
  before: beforeSummary,
  after: afterSummary,
  checks: [
    {
      id: 'runtime-store-semantic-counts',
      ok: countsOk,
      before: beforeSummary,
      after: afterSummary,
    },
    {
      id: 'runtime-store-semantic-fingerprint',
      ok: fingerprintOk,
      comparedDomains: Object.keys(beforeFingerprint as Record<string, unknown>).length,
    },
    {
      id: 'runtime-store-domain-coverage',
      ok: coverageOk,
      coveredDomains,
      domains: restorePlan.domains,
    },
    {
      id: 'restore-plan-generated',
      ok: restorePlan.domains.length > 0 && restorePlan.warnings.length > 0,
      warnings: restorePlan.warnings,
    },
  ],
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = ok ? 0 : 1;
