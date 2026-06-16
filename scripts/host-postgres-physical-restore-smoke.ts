import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Pool } from 'pg';
import {
  createPgModuleDataExecutor,
  createPostgresRuntimeStore,
  verifyRuntimeStoreSchema,
  type RuntimeStore,
} from '../src/lib/module-runtime';

const docker = process.platform === 'win32' ? 'docker.exe' : 'docker';
const required = process.argv.includes('--required');
const checkedAt = new Date().toISOString();
const safeTimestamp = checkedAt.replace(/[:.]/g, '-');
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'postgres-physical-restore',
  safeTimestamp
);
const reportPath = path.join(outputDir, 'physical-restore.json');
const latestPath = path.resolve(
  process.cwd(),
  '.runtime',
  'postgres-physical-restore',
  'latest.json'
);
const dumpPath = path.join(outputDir, 'runtime-store.dump');

const postgresImage = process.env.PLOYKIT_POSTGRES_RESTORE_IMAGE ?? 'postgres:16-alpine';
const dbUser = 'ploykit';
const dbPassword = 'ploykit';
const dbName = 'ploykit';
const productId = 'physical-product';
const workspaceId = 'physical-workspace';
const moduleId = 'physical-module';
const userId = 'physical-user';
const runIdPrefix = `physical_${Date.now().toString(36)}`;

interface MatrixCheck {
  id: string;
  ok: boolean;
  command?: string;
  durationMs?: number;
  detail?: unknown;
  error?: string;
}

interface CommandResult {
  command: string;
  ok: boolean;
  status: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutBuffer?: Buffer;
}

const checks: MatrixCheck[] = [];
const startedContainers: string[] = [];
const warnings = [
  'local Docker pg_dump/pg_restore smoke only',
  'does not prove managed database snapshot restore',
  'does not prove WAL/PITR recovery-point objectives',
  'does not restore object storage assets or secrets',
  'does not cover module Data v2 physical tables unless they already exist in the source database',
];

function redactCommandArg(arg: string): string {
  if (arg.startsWith('POSTGRES_PASSWORD=')) {
    return 'POSTGRES_PASSWORD=REDACTED';
  }
  return redactDatabaseUrl(arg);
}

function displayCommand(command: string, args: readonly string[]): string {
  return [command, ...args.map(redactCommandArg)].join(' ');
}

function redactDatabaseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.password) {
      url.password = 'REDACTED';
    }
    return url.toString();
  } catch {
    return value.replace(/:\/\/([^:\s]+):([^@\s]+)@/, '://$1:REDACTED@');
  }
}

function runDocker(
  args: readonly string[],
  options: { input?: Buffer; binaryStdout?: boolean } = {}
): CommandResult {
  const startedAt = Date.now();
  const result = spawnSync(docker, [...args], {
    cwd: process.cwd(),
    encoding: options.binaryStdout ? null : 'utf8',
    input: options.input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout =
    typeof result.stdout === 'string'
      ? result.stdout
      : Buffer.isBuffer(result.stdout)
        ? result.stdout.toString('utf8')
        : '';
  const stderr =
    typeof result.stderr === 'string'
      ? result.stderr
      : Buffer.isBuffer(result.stderr)
        ? result.stderr.toString('utf8')
        : '';
  return {
    command: displayCommand(docker, args),
    ok: result.status === 0,
    status: result.status ?? 1,
    durationMs: Date.now() - startedAt,
    stdout,
    stderr: stderr || result.error?.message || '',
    stdoutBuffer: Buffer.isBuffer(result.stdout) ? result.stdout : undefined,
  };
}

function checkFromCommand(id: string, result: CommandResult, detail?: unknown): MatrixCheck {
  return {
    id,
    ok: result.ok,
    command: result.command,
    durationMs: result.durationMs,
    detail,
    error: result.ok ? undefined : result.stderr.trim() || result.stdout.trim(),
  };
}

function pushCheck(check: MatrixCheck): void {
  checks.push(check);
  if (!check.ok) {
    throw new Error(`${check.id} failed${check.error ? `: ${check.error}` : ''}`);
  }
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

function sortStable<T>(items: T[]): T[] {
  return [...items].sort((left, right) =>
    JSON.stringify(stable(left)).localeCompare(JSON.stringify(stable(right)))
  );
}

function sameStable(left: unknown, right: unknown): boolean {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') {
          resolve(address.port);
          return;
        }
        reject(new Error('Unable to allocate a local TCP port.'));
      });
    });
  });
}

function createDatabaseUrl(port: number): string {
  return `postgres://${dbUser}:${dbPassword}@127.0.0.1:${port}/${dbName}`;
}

function startContainer(name: string, port: number): CommandResult {
  const result = runDocker([
    'run',
    '-d',
    '--name',
    name,
    '-e',
    `POSTGRES_USER=${dbUser}`,
    '-e',
    `POSTGRES_PASSWORD=${dbPassword}`,
    '-e',
    `POSTGRES_DB=${dbName}`,
    '-p',
    `127.0.0.1:${port}:5432`,
    postgresImage,
  ]);
  if (result.ok) {
    startedContainers.push(name);
  }
  return result;
}

async function waitForContainer(
  name: string
): Promise<{ result: CommandResult; attempts: number }> {
  let latest = runDocker(['exec', name, 'pg_isready', '-U', dbUser, '-d', dbName]);
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    latest = runDocker(['exec', name, 'pg_isready', '-U', dbUser, '-d', dbName]);
    if (latest.ok) {
      return { result: latest, attempts: attempt };
    }
    await sleep(1000);
  }
  return { result: latest, attempts: 60 };
}

async function waitForDatabaseUrl(
  databaseUrl: string
): Promise<{ ok: boolean; attempts: number; error?: string }> {
  let lastError = '';
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query('select 1');
      await pool.end();
      return { ok: true, attempts: attempt };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await pool.end().catch(() => undefined);
      await sleep(1000);
    }
  }
  return { ok: false, attempts: 30, error: lastError };
}

async function withStore<T>(
  databaseUrl: string,
  callback: (input: {
    pool: Pool;
    store: RuntimeStore;
    database: ReturnType<typeof createPgModuleDataExecutor>;
  }) => Promise<T>
): Promise<T> {
  const pool = new Pool({ connectionString: databaseUrl });
  const database = createPgModuleDataExecutor(pool);
  const store = createPostgresRuntimeStore({
    database,
    createId: (() => {
      let next = 0;
      return (prefix: string) => `${prefix}_${runIdPrefix}_${++next}`;
    })(),
  });
  try {
    return await callback({ pool, store, database });
  } finally {
    await pool.end();
  }
}

async function seedRuntimeStore(store: RuntimeStore): Promise<void> {
  await store.upsertProductScopeProduct({
    id: productId,
    name: 'Physical Restore Product',
    profile: 'explicit-workspace',
    defaultWorkspaceId: workspaceId,
  });
  await store.upsertProductScopeWorkspace({
    id: workspaceId,
    productId,
    name: 'Physical Restore Workspace',
    slug: workspaceId,
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
    email: 'physical@example.com',
    passwordHash: 'hash:physical',
    role: 'admin',
    status: 'active',
    permissions: ['files.read'],
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.upsertSetting({
    productId,
    workspaceId,
    namespace: 'restore',
    key: 'mode',
    value: { mode: 'pg_dump_restore' },
    status: 'active',
    version: 1,
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.upsertServiceConnection({
    productId,
    workspaceId,
    moduleId,
    connectionId: 'physical:ai',
    service: 'ai',
    provider: 'static',
    status: 'active',
    authType: 'secret-ref',
    config: { model: 'static-text' },
    secretRefs: { apiKey: 'secret://physical/ai' },
    health: { status: 'ready' },
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.upsertResourceBinding({
    productId,
    workspaceId,
    moduleId,
    bindingId: 'physical-binding',
    name: 'restore-bucket',
    kind: 's3-bucket',
    value: { bucket: 'physical-restore' },
    status: 'active',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });

  const run = await store.createRun({
    productId,
    workspaceId,
    moduleId,
    kind: 'job',
    name: 'postgres-physical-restore-smoke',
    input: { source: 'pg_dump_restore' },
    idempotencyKey: 'postgres-physical-restore-run',
  });
  await store.appendRunLog(run.id, 'info', 'seeded before pg_dump', {
    source: 'postgres-physical-restore-smoke',
  });
  await store.updateRunStatus(run.id, 'succeeded', {
    progress: 100,
    result: { ok: true },
  });

  const outbox = await store.enqueueOutbox({
    productId,
    workspaceId,
    moduleId,
    name: 'physical.restore',
    payload: { runId: run.id },
    metadata: { source: 'postgres-physical-restore-smoke' },
    idempotencyKey: 'postgres-physical-restore-outbox',
  });
  await store.markOutbox(outbox.id, 'processed');

  const receipt = await store.createWebhookReceipt({
    productId,
    workspaceId,
    moduleId,
    webhookName: 'physical-restore',
    path: '/module-webhooks/physical-module/physical-restore',
    method: 'POST',
    idempotencyKey: 'postgres-physical-restore-webhook',
    signature: 'sha256=physical',
    headers: { 'x-provider-event': 'evt_physical_restore' },
    bodyText: '{"event":"physical.restore"}',
    bodyDigest: 'sha256:physical-restore-body',
  });
  await store.markWebhookReceipt(receipt.id, 'processed');

  const notification = await store.createNotification({
    productId,
    workspaceId,
    moduleId,
    userId,
    title: 'Physical restore seeded',
    body: 'pg_dump restore smoke data is ready.',
    source: 'postgres-physical-restore-smoke',
    category: 'system',
    status: 'unread',
    deliveryStatus: 'delivered',
    idempotencyKey: 'postgres-physical-restore-notification',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.recordNotificationDelivery({
    notificationId: notification.id,
    productId,
    workspaceId,
    userId,
    channel: 'inApp',
    provider: 'in-app',
    status: 'delivered',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.recordDelivery({
    productId,
    workspaceId,
    moduleId,
    kind: 'job',
    source: 'physical.restore',
    target: moduleId,
    status: 'delivered',
    attempts: 1,
    outboxId: outbox.id,
    runId: run.id,
    receiptId: receipt.id,
    workerId: 'physical-worker',
    correlationId: 'physical-correlation',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.upsertWorkerHeartbeat({
    productId,
    workspaceId,
    workerId: 'physical-worker',
    profile: 'default',
    queueProfile: 'jobs-events-webhooks-email',
    status: 'running',
    processed: 1,
    failed: 0,
    deadLettered: 0,
    metadata: { source: 'postgres-physical-restore-smoke' },
  });

  await store.recordAudit({
    productId,
    workspaceId,
    moduleId,
    actorId: 'system',
    type: 'physical.restore.seeded',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.recordUsage({
    productId,
    workspaceId,
    moduleId,
    meter: 'physical.restore',
    quantity: 1,
    unit: 'event',
    idempotencyKey: 'postgres-physical-restore-usage',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  const metering = await store.recordMetering({
    productId,
    workspaceId,
    moduleId,
    meter: 'physical.restore.cost',
    quantity: 2,
    unit: 'credit',
    idempotencyKey: 'postgres-physical-restore-metering',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.updateMeteringStatus(metering.id, 'committed', {
    source: 'postgres-physical-restore-smoke',
  });
  await store.recordCreditLedger({
    productId,
    workspaceId,
    userId,
    amount: 25,
    unit: 'credit',
    reason: 'physical-restore-grant',
    status: 'available',
    idempotencyKey: 'postgres-physical-restore-credit',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.grantEntitlement({
    productId,
    workspaceId,
    userId,
    entitlement: 'physical.restore',
    planId: 'restore-pro',
    source: 'postgres-physical-restore-smoke',
    status: 'active',
    idempotencyKey: 'postgres-physical-restore-entitlement',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });

  await store.upsertCommercialCatalogItem({
    productId,
    workspaceId,
    kind: 'sku',
    itemId: 'physical_restore_sku',
    version: 1,
    status: 'published',
    value: { amount: 1200, currency: 'usd' },
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  const order = await store.createCommercialOrder({
    productId,
    workspaceId,
    userId,
    sku: 'physical_restore_sku',
    amount: 1200,
    currency: 'usd',
    provider: 'local',
    providerRef: 'physical-restore-order',
    idempotencyKey: 'postgres-physical-restore-order',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.updateCommercialOrderStatus(order.id, 'paid', {
    source: 'postgres-physical-restore-smoke',
  });
  await store.upsertBillingAccount({
    productId,
    workspaceId,
    userId,
    status: 'active',
    customerProfile: { email: 'physical@example.com' },
    providerCustomers: { local: 'cus_physical_restore' },
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.upsertInvoice({
    id: 'physical-restore-invoice',
    productId,
    workspaceId,
    userId,
    orderId: order.id,
    number: 'INV-PHYSICAL-RESTORE',
    status: 'paid',
    subtotal: 1200,
    discount: 0,
    tax: 0,
    total: 1200,
    refunded: 0,
    fee: 0,
    net: 1200,
    currency: 'usd',
    provider: 'local',
    providerRef: 'physical-restore-invoice',
    lines: [{ sku: 'physical_restore_sku', amount: 1200 }],
    metadata: { source: 'postgres-physical-restore-smoke' },
    issuedAt: '2026-06-16T00:00:00.000Z',
    paidAt: '2026-06-16T00:01:00.000Z',
  });
  await store.upsertRevenueBucket({
    productId,
    workspaceId,
    bucketDate: '2026-06-16',
    currency: 'usd',
    gross: 1200,
    discount: 0,
    tax: 0,
    refund: 0,
    fee: 0,
    net: 1200,
    orders: 1,
    provider: 'local',
    metadata: { source: 'postgres-physical-restore-smoke' },
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
    serviceConnectionId: 'physical:ai',
    resourceBindingId: 'physical-binding',
    usage: { inputTokens: 1, outputTokens: 2 },
    cost: { credits: 1, unit: 'credit' },
    latencyMs: 7,
    correlationId: 'physical-correlation',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.upsertRagSource({
    productId,
    workspaceId,
    moduleId,
    sourceId: 'physical-source',
    status: 'indexed',
    contentDigest: 'sha256:physical-source',
    contentLength: 17,
    chunkCount: 1,
    indexedAt: '2026-06-16T00:02:00.000Z',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.upsertRagChunk({
    id: 'physical-rag-chunk',
    productId,
    workspaceId,
    moduleId,
    sourceId: 'physical-source',
    chunkIndex: 0,
    content: 'physical restore',
    embedding: [0.1, 0.2, 0.3],
    metadata: { source: 'postgres-physical-restore-smoke' },
  });

  const file = await store.createFile({
    productId,
    workspaceId,
    moduleId,
    actorId: userId,
    ownerId: userId,
    name: 'physical-restore.txt',
    purpose: 'result',
    status: 'uploading',
    visibility: 'private',
    contentType: 'text/plain',
    storageKey: 'physical-product/physical-workspace/physical-restore.txt',
    runId: run.id,
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.updateFile(file.id, {
    status: 'ready',
    sizeBytes: 17,
    checksum: 'sha256:physical-file',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.createApiKey({
    id: 'physical-api-key',
    productId,
    workspaceId,
    moduleId,
    name: 'Physical restore key',
    prefix: 'pk_phys',
    keyHash: 'hash:physical',
    ownerSubjectType: 'workspace',
    ownerSubjectId: workspaceId,
    permissions: ['files.read'],
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.recordRiskEvent({
    productId,
    workspaceId,
    moduleId,
    subjectType: 'user',
    subjectId: userId,
    type: 'physical.restore.seeded',
    severity: 'low',
    source: 'postgres-physical-restore-smoke',
    sourceId: 'physical-restore',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.upsertRiskBlock({
    id: 'physical-risk-block',
    productId,
    workspaceId,
    subjectType: 'user',
    subjectId: userId,
    scope: 'physical-restore',
    reason: 'restore smoke block',
    metadata: { source: 'postgres-physical-restore-smoke' },
  });
  await store.upsertCatalogState({
    productId,
    moduleId,
    status: 'enabled',
    bundleId: 'physical-restore',
    required: true,
  });
}

async function snapshotStore(store: RuntimeStore): Promise<unknown> {
  const runs = await store.listRuns({ productId });
  const outbox = await store.listOutbox({ productId });
  const deliveries = await store.listDeliveries({ productId });
  const workers = await store.listWorkers({ productId });
  const webhookReceipts = await store.listWebhookReceipts({ productId });
  const notifications = await store.listNotifications({ productId });
  const notificationDeliveries = await store.listNotificationDeliveries({ productId });
  const audit = await store.listAudit({ productId });
  const usage = await store.listUsage({ productId });
  const metering = await store.listMetering({ productId });
  const credits = await store.listCreditLedger({ productId });
  const balance = await store.getCreditBalance({ productId, workspaceId, userId });
  const entitlements = await store.listEntitlements({ productId });
  const catalog = await store.listCommercialCatalogItems({ productId });
  const orders = await store.listCommercialOrders({ productId });
  const billingAccount = await store.getBillingAccount(productId, userId, workspaceId);
  const invoices = await store.listInvoices({ productId });
  const revenueBuckets = await store.listRevenueBuckets({ productId });
  const providerInvocations = await store.listProviderInvocations({ productId });
  const ragSources = await store.listRagSources({ productId });
  const ragChunks = await store.listRagChunks({ productId });
  const files = await store.listFiles({ productId, includeDeleted: true });
  const apiKeys = await store.listApiKeys({ productId });
  const apiKey = await store.findApiKeyByHash({
    productId,
    prefix: 'pk_phys',
    keyHash: 'hash:physical',
  });
  const riskEvents = await store.listRiskEvents({ productId });
  const riskBlocks = await store.listRiskBlocks({ productId });
  const products = await store.listProductScopeProducts({ productId });
  const workspaces = await store.listProductScopeWorkspaces({ productId });
  const memberships = await store.listMemberships({ productId });
  const hostUser = await store.findHostUserByEmail('physical@example.com');
  const settings = await store.listSettings({ productId });
  const serviceConnections = await store.listServiceConnections({ productId });
  const resourceBindings = await store.listResourceBindings({ productId });
  const catalogStates = await store.listCatalogStates({ productId });

  return stable({
    counts: {
      runs: runs.length,
      outbox: outbox.length,
      deliveries: deliveries.length,
      workers: workers.length,
      webhookReceipts: webhookReceipts.length,
      notifications: notifications.length,
      notificationDeliveries: notificationDeliveries.length,
      audit: audit.length,
      usage: usage.length,
      metering: metering.length,
      credits: credits.length,
      entitlements: entitlements.length,
      catalog: catalog.length,
      orders: orders.length,
      billingAccount: billingAccount ? 1 : 0,
      invoices: invoices.length,
      revenueBuckets: revenueBuckets.length,
      providerInvocations: providerInvocations.length,
      ragSources: ragSources.length,
      ragChunks: ragChunks.length,
      files: files.length,
      apiKeys: apiKeys.length,
      riskEvents: riskEvents.length,
      riskBlocks: riskBlocks.length,
      products: products.length,
      workspaces: workspaces.length,
      memberships: memberships.length,
      hostUser: hostUser ? 1 : 0,
      settings: settings.length,
      serviceConnections: serviceConnections.length,
      resourceBindings: resourceBindings.length,
      catalogStates: catalogStates.length,
    },
    values: {
      runStatuses: sortStable(runs.map((run) => ({ name: run.name, status: run.status }))),
      outboxStatuses: sortStable(
        outbox.map((record) => ({ name: record.name, status: record.status }))
      ),
      webhookStatuses: sortStable(
        webhookReceipts.map((record) => ({
          webhookName: record.webhookName,
          status: record.status,
          idempotencyKey: record.idempotencyKey,
        }))
      ),
      workerStatuses: sortStable(
        workers.map((record) => ({ workerId: record.workerId, status: record.status }))
      ),
      creditBalance: balance.balance,
      entitlements: sortStable(
        entitlements.map((record) => ({
          entitlement: record.entitlement,
          status: record.status,
        }))
      ),
      orders: sortStable(
        orders.map((record) => ({
          sku: record.sku,
          status: record.status,
          total: record.amount,
        }))
      ),
      invoices: sortStable(
        invoices.map((record) => ({
          number: record.number,
          status: record.status,
          total: record.total,
        }))
      ),
      revenue: sortStable(
        revenueBuckets.map((record) => ({
          bucketDate: record.bucketDate,
          gross: record.gross,
          orders: record.orders,
        }))
      ),
      providerInvocations: sortStable(
        providerInvocations.map((record) => ({
          providerId: record.providerId,
          operation: record.operation,
          status: record.status,
        }))
      ),
      rag: sortStable(
        ragSources.map((record) => ({
          sourceId: record.sourceId,
          status: record.status,
          chunkCount: record.chunkCount,
        }))
      ),
      files: sortStable(
        files.map((record) => ({
          name: record.name,
          status: record.status,
          checksum: record.checksum,
        }))
      ),
      apiKeyId: apiKey?.id,
      riskBlocks: sortStable(
        riskBlocks.map((record) => ({
          subjectId: record.subjectId,
          scope: record.scope,
          reason: record.reason,
        }))
      ),
      hostUserStatus: hostUser?.status,
      productNames: sortStable(products.map((record) => record.name)),
      workspaceSlugs: sortStable(workspaces.map((record) => record.slug)),
      settingKeys: sortStable(settings.map((record) => `${record.namespace}:${record.key}`)),
      serviceConnections: sortStable(serviceConnections.map((record) => record.connectionId)),
      resourceBindings: sortStable(resourceBindings.map((record) => record.bindingId)),
      catalogStates: sortStable(catalogStates.map((record) => record.moduleId)),
    },
  });
}

async function cleanupContainers(): Promise<{
  ok: boolean;
  containers: string[];
  checks: MatrixCheck[];
}> {
  const cleanupChecks: MatrixCheck[] = [];
  for (const name of [...startedContainers].reverse()) {
    const result = runDocker(['rm', '-f', name]);
    cleanupChecks.push(checkFromCommand(`cleanup-${name}`, result, { container: name }));
  }
  return {
    ok: cleanupChecks.every((check) => check.ok),
    containers: [...startedContainers],
    checks: cleanupChecks,
  };
}

async function runSmoke(): Promise<Record<string, unknown>> {
  const dockerVersion = runDocker(['version', '--format', '{{.Server.Version}}']);
  pushCheck(
    checkFromCommand('docker-available', dockerVersion, {
      serverVersion: dockerVersion.stdout.trim(),
    })
  );

  const sourcePort = await findFreePort();
  const restorePort = await findFreePort();
  const sourceContainer = `ploykit-physical-restore-src-${safeTimestamp.toLowerCase()}`;
  const restoreContainer = `ploykit-physical-restore-dst-${safeTimestamp.toLowerCase()}`;
  const sourceDatabaseUrl = createDatabaseUrl(sourcePort);
  const restoreDatabaseUrl = createDatabaseUrl(restorePort);

  pushCheck(
    checkFromCommand('source-postgres-start', startContainer(sourceContainer, sourcePort), {
      container: sourceContainer,
      image: postgresImage,
      port: sourcePort,
    })
  );
  pushCheck(
    checkFromCommand('restore-postgres-start', startContainer(restoreContainer, restorePort), {
      container: restoreContainer,
      image: postgresImage,
      port: restorePort,
    })
  );

  const sourceReady = await waitForContainer(sourceContainer);
  pushCheck(
    checkFromCommand('source-postgres-ready', sourceReady.result, {
      attempts: sourceReady.attempts,
    })
  );
  const restoreReady = await waitForContainer(restoreContainer);
  pushCheck(
    checkFromCommand('restore-postgres-ready', restoreReady.result, {
      attempts: restoreReady.attempts,
    })
  );

  const sourceConnection = await waitForDatabaseUrl(sourceDatabaseUrl);
  pushCheck({
    id: 'source-host-connection',
    ok: sourceConnection.ok,
    detail: {
      attempts: sourceConnection.attempts,
      databaseUrl: redactDatabaseUrl(sourceDatabaseUrl),
    },
    error: sourceConnection.error,
  });
  const restoreConnection = await waitForDatabaseUrl(restoreDatabaseUrl);
  pushCheck({
    id: 'restore-host-connection',
    ok: restoreConnection.ok,
    detail: {
      attempts: restoreConnection.attempts,
      databaseUrl: redactDatabaseUrl(restoreDatabaseUrl),
    },
    error: restoreConnection.error,
  });

  let beforeSnapshot: unknown;
  let sourceSchema: unknown;
  await withStore(sourceDatabaseUrl, async ({ store, database }) => {
    await store.ensureSchema?.();
    const schema = await verifyRuntimeStoreSchema(database);
    sourceSchema = schema;
    pushCheck({
      id: 'source-runtime-schema',
      ok: schema.ok,
      detail: schema,
      error: schema.ok ? undefined : JSON.stringify(schema),
    });

    await seedRuntimeStore(store);
    beforeSnapshot = await snapshotStore(store);
    pushCheck({
      id: 'source-runtime-seeded',
      ok: true,
      detail: beforeSnapshot,
    });
  });

  const dump = runDocker(['exec', sourceContainer, 'pg_dump', '-U', dbUser, '-d', dbName, '-Fc'], {
    binaryStdout: true,
  });
  if (dump.ok && dump.stdoutBuffer) {
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(dumpPath, dump.stdoutBuffer);
  }
  const dumpBytes = dump.ok && fs.existsSync(dumpPath) ? fs.statSync(dumpPath).size : 0;
  pushCheck(
    checkFromCommand('pg-dump-created', dump, {
      dumpPath,
      bytes: dumpBytes,
    })
  );
  pushCheck({
    id: 'pg-dump-non-empty',
    ok: dumpBytes > 0,
    detail: { dumpPath, bytes: dumpBytes },
    error: dumpBytes > 0 ? undefined : 'pg_dump produced an empty dump file.',
  });

  const restore = runDocker(
    ['exec', '-i', restoreContainer, 'pg_restore', '-U', dbUser, '-d', dbName],
    {
      input: fs.readFileSync(dumpPath),
    }
  );
  pushCheck(checkFromCommand('pg-restore-applied', restore, { dumpPath, bytes: dumpBytes }));

  let afterSnapshot: unknown;
  let restoreSchema: unknown;
  await withStore(restoreDatabaseUrl, async ({ store, database }) => {
    const schema = await verifyRuntimeStoreSchema(database);
    restoreSchema = schema;
    pushCheck({
      id: 'restore-runtime-schema',
      ok: schema.ok,
      detail: schema,
      error: schema.ok ? undefined : JSON.stringify(schema),
    });
    afterSnapshot = await snapshotStore(store);
    pushCheck({
      id: 'restore-runtime-data-fingerprint',
      ok: sameStable(beforeSnapshot, afterSnapshot),
      detail: { before: beforeSnapshot, after: afterSnapshot },
      error: sameStable(beforeSnapshot, afterSnapshot)
        ? undefined
        : 'Restored runtime store data fingerprint differs from the source.',
    });

    await store.recordAudit({
      productId,
      workspaceId,
      moduleId,
      actorId: 'system',
      type: 'physical.restore.verified',
      metadata: { source: 'postgres-physical-restore-smoke' },
    });
    const writableAudit = await store.listAudit({
      productId,
      type: 'physical.restore.verified',
    });
    pushCheck({
      id: 'restore-runtime-writable',
      ok: writableAudit.length === 1,
      detail: { records: writableAudit.length },
      error: writableAudit.length === 1 ? undefined : 'Restored database was not writable.',
    });
  });

  return {
    profile: 'local-docker-pg-dump-restore',
    source: {
      container: sourceContainer,
      databaseUrl: redactDatabaseUrl(sourceDatabaseUrl),
      schema: sourceSchema,
      snapshot: beforeSnapshot,
    },
    restore: {
      container: restoreContainer,
      databaseUrl: redactDatabaseUrl(restoreDatabaseUrl),
      schema: restoreSchema,
      snapshot: afterSnapshot,
    },
    dump: {
      path: dumpPath,
      bytes: dumpBytes,
    },
  };
}

let failure: string | undefined;
let smokeDetail: Record<string, unknown> = {};
try {
  smokeDetail = await runSmoke();
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

const cleanup = await cleanupContainers();
const ok = !failure && checks.every((check) => check.ok) && cleanup.ok;
const report = {
  ok,
  required,
  checkedAt,
  mode: 'postgres-pg-dump-restore-local',
  ...smokeDetail,
  warnings,
  checks,
  cleanup,
  error: ok ? undefined : (failure ?? 'cleanup failed'),
  artifacts: {
    report: reportPath,
    latest: latestPath,
    dump: dumpPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = ok ? 0 : 1;
