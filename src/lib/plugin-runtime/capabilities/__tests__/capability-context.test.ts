import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { definePlugin, Permission, PluginError, type PermissionValue } from '@ploykit/plugin-sdk';
import { normalizePluginRuntimeContract } from '../../contract';
import { createPluginRuntimeContext } from '../../context';
import { setDefaultPluginInternalServiceRegistry } from '..';
import type { AuditEvent, AuditPort } from '@/lib/audit/audit-port.server';
import type { UsageLedger, UsageRecord } from '@/lib/usage/usage-ledger.server';
import type { PluginArtifact } from '@/lib/db/schema/plugin-storage';
import type {
  PluginFile as PluginFileRow,
  PluginResourceBinding as PluginResourceBindingRow,
} from '@/lib/db/schema/plugin-platform';
import type {
  PluginArtifactsRepository,
  PluginAiHost,
  PluginConfigRepository,
  PluginConfigScope,
  PluginBillingHost,
  PluginCreditsHost,
  PluginFilesRepository,
  PluginFilesScope,
  PluginHttpHost,
  PluginNotificationsHost,
  PluginInternalServiceRegistry,
  PluginResourceBindingsRepository,
  PluginResourceBindingsScope,
  PluginServiceCallLogRepository,
  PluginSecretScope,
  PluginSecretsRepository,
} from '..';
import {
  withPluginResourceScopeAccessOverride,
  type NormalizedPluginResourceScope,
} from '../guards.server';

const ORDINARY_PERMISSIONS = Object.values(Permission).filter(
  (permission) => !permission.startsWith('unsafe.')
);

function createContract(
  permissions: PermissionValue[] = ORDINARY_PERMISSIONS,
  egress: readonly string[] = []
) {
  const events = permissions.includes(Permission.EventsSubscribe)
    ? {
        subscribes: {
          'platform.user.created': './events/user-created',
        },
      }
    : undefined;

  return normalizePluginRuntimeContract(
    definePlugin({
      id: 'capability-test',
      name: 'Capability Test',
      version: '1.0.0',
      permissions,
      meters: [
        {
          id: 'capability-test.ocr.page',
          unit: 'page',
          defaultCreditCost: 2,
          billable: true,
        },
      ],
      egress,
      config: {
        defaults: {
          theme: 'light',
        },
      },
      data: {
        collections: {
          capability_items: {
            fields: {
              title: 'string',
            },
          },
        },
      },
      events,
    })
  );
}

function mapKey(scope: { pluginId: string; userId: string }, key: string): string {
  return `${scope.pluginId}:${scope.userId}:${key}`;
}

class MemoryConfigRepository implements PluginConfigRepository {
  readonly values = new Map<string, unknown>();

  async get(scope: PluginConfigScope, key: string): Promise<unknown | null> {
    return this.values.get(mapKey(scope, key)) ?? null;
  }

  async set(scope: PluginConfigScope, key: string, value: unknown): Promise<void> {
    this.values.set(mapKey(scope, key), value);
  }

  async delete(scope: PluginConfigScope, key: string): Promise<void> {
    this.values.delete(mapKey(scope, key));
  }
}

class MemorySecretsRepository implements PluginSecretsRepository {
  readonly values = new Map<string, string>();

  async get(scope: PluginSecretScope, name: string): Promise<string | null> {
    return this.values.get(mapKey(scope, name)) ?? null;
  }

  async set(scope: PluginSecretScope, name: string, value: string): Promise<void> {
    this.values.set(mapKey(scope, name), value);
  }

  async delete(scope: PluginSecretScope, name: string): Promise<void> {
    this.values.delete(mapKey(scope, name));
  }
}

class MemoryArtifactsRepository implements PluginArtifactsRepository {
  readonly values = new Map<string, PluginArtifact>();

  private key(
    scope: { pluginId: string; userId: string },
    resourceScope: NormalizedPluginResourceScope,
    path: string
  ) {
    const ownerKey = resourceScope.type === 'workspace' ? '*' : scope.userId;
    return `${scope.pluginId}:${ownerKey}:${resourceScope.type}:${resourceScope.id}:${path}`;
  }

  async upsert(
    scope: Parameters<PluginArtifactsRepository['upsert']>[0],
    input: Parameters<PluginArtifactsRepository['upsert']>[1]
  ) {
    const key = this.key(scope, input.scope, input.path);
    const existing = this.values.get(key);
    const now = new Date();
    const row = {
      id: existing?.id ?? 'artifact-1',
      pluginId: scope.pluginId,
      userId: scope.userId,
      scopeType: input.scope.type,
      scopeId: input.scope.id,
      path: input.path,
      contentType: input.contentType,
      content: input.content,
      metadata: input.metadata,
      version: (existing?.version ?? 0) + 1,
      size: Buffer.byteLength(input.content, 'utf8'),
      hash: 'hash-1',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    };
    this.values.set(key, row);
    return row;
  }

  async read(
    scope: Parameters<PluginArtifactsRepository['read']>[0],
    input: Parameters<PluginArtifactsRepository['read']>[1]
  ) {
    return this.values.get(this.key(scope, input.scope, input.path)) ?? null;
  }

  async list(
    scope: Parameters<PluginArtifactsRepository['list']>[0],
    input: Parameters<PluginArtifactsRepository['list']>[1]
  ) {
    return Array.from(this.values.values())
      .filter(
        (row) =>
          row.pluginId === scope.pluginId &&
          (input.scope.type === 'workspace' || row.userId === scope.userId) &&
          row.scopeType === input.scope.type &&
          row.scopeId === input.scope.id &&
          (!input.prefix || row.path.startsWith(input.prefix))
      )
      .sort((left, right) => left.path.localeCompare(right.path))
      .slice(input.offset, input.offset + input.limit);
  }

  async updateMetadata(
    scope: Parameters<PluginArtifactsRepository['updateMetadata']>[0],
    input: Parameters<PluginArtifactsRepository['updateMetadata']>[1]
  ) {
    const key = this.key(scope, input.scope, input.path);
    const existing = this.values.get(key);
    if (!existing) {
      throw new Error('not found');
    }
    const row = {
      ...existing,
      metadata: input.merge ? { ...existing.metadata, ...input.metadata } : input.metadata,
      version: existing.version + 1,
      updatedAt: new Date(),
    };
    this.values.set(key, row);
    return row;
  }

  async softDelete(
    scope: Parameters<PluginArtifactsRepository['softDelete']>[0],
    input: Parameters<PluginArtifactsRepository['softDelete']>[1]
  ) {
    this.values.delete(this.key(scope, input.scope, input.path));
  }
}

class MemoryFilesRepository implements PluginFilesRepository {
  readonly values = new Map<string, PluginFileRow>();

  async createPending(
    scope: PluginFilesScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      fileName: string;
      contentType: string;
      size: number;
      purpose: 'source' | 'result' | 'temp';
      storageKey: string;
      runId?: string;
      expiresAt?: Date;
      metadata: Record<string, unknown>;
    }
  ) {
    const now = new Date();
    const row = {
      id: `file-${this.values.size + 1}`,
      pluginId: scope.pluginId,
      userId: scope.userId,
      scopeType: input.resourceScope.type,
      scopeId: input.resourceScope.id,
      ownerUserId: scope.userId,
      fileName: input.fileName,
      contentType: input.contentType,
      size: input.size,
      hash: null,
      purpose: input.purpose,
      status: 'pending_upload',
      storageKey: input.storageKey,
      storageProvider: 'local',
      runId: input.runId ?? null,
      metadata: input.metadata,
      expiresAt: input.expiresAt ?? null,
      uploadedAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.values.set(row.id, row);
    return row;
  }

  async complete(
    _scope: PluginFilesScope,
    input: {
      fileId: string;
      storageKey?: string;
      size: number;
      hash?: string;
      contentType?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    const existing = this.values.get(input.fileId);
    if (!existing) {
      throw new Error('not found');
    }
    const row = {
      ...existing,
      storageKey: input.storageKey ?? existing.storageKey,
      size: input.size,
      hash: input.hash ?? null,
      contentType: input.contentType ?? existing.contentType,
      metadata: input.metadata ? { ...existing.metadata, ...input.metadata } : existing.metadata,
      status: 'ready',
      uploadedAt: new Date(),
      updatedAt: new Date(),
    };
    this.values.set(input.fileId, row);
    return row;
  }

  async get(_scope: PluginFilesScope, id: string) {
    return this.values.get(id) ?? null;
  }

  async list(
    _scope: PluginFilesScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      purpose?: 'source' | 'result' | 'temp';
      status?: 'pending_upload' | 'ready' | 'archived' | 'deleted';
      runId?: string;
      limit: number;
      offset: number;
    }
  ) {
    return Array.from(this.values.values()).filter(
      (row) =>
        row.scopeType === input.resourceScope.type &&
        row.scopeId === input.resourceScope.id &&
        (!input.purpose || row.purpose === input.purpose) &&
        (!input.status || row.status === input.status) &&
        (!input.runId || row.runId === input.runId)
    );
  }

  async getUsage(
    _scope: PluginFilesScope,
    input: Parameters<PluginFilesRepository['getUsage']>[1]
  ) {
    const rows = Array.from(this.values.values()).filter(
      (row) =>
        row.scopeType === input.resourceScope.type &&
        row.scopeId === input.resourceScope.id &&
        !row.deletedAt
    );
    const dailyRows = input.uploadedSince
      ? rows.filter((row) => row.createdAt >= input.uploadedSince!)
      : rows;

    return {
      fileCount: rows.length,
      storageBytes: rows.reduce((sum, row) => sum + row.size, 0),
      dailyUploadBytes: dailyRows.reduce((sum, row) => sum + row.size, 0),
    };
  }

  async archive(_scope: PluginFilesScope, id: string) {
    const existing = this.values.get(id);
    if (!existing) throw new Error('not found');
    const row = { ...existing, status: 'archived', archivedAt: new Date(), updatedAt: new Date() };
    this.values.set(id, row);
    return row;
  }

  async softDelete(_scope: PluginFilesScope, id: string) {
    const existing = this.values.get(id);
    if (!existing) throw new Error('not found');
    const row = { ...existing, status: 'deleted', deletedAt: new Date(), updatedAt: new Date() };
    this.values.set(id, row);
    return row;
  }
}

class MemoryResourceBindingsRepository implements PluginResourceBindingsRepository {
  readonly values = new Map<string, PluginResourceBindingRow>();

  async get(
    scope: PluginResourceBindingsScope,
    input: Parameters<PluginResourceBindingsRepository['get']>[1]
  ) {
    return (
      Array.from(this.values.values()).find(
        (row) =>
          row.pluginId === scope.pluginId &&
          row.scopeType === input.resourceScope.type &&
          row.scopeId === input.resourceScope.id &&
          row.resourceType === input.resourceType &&
          (!input.resourceId || row.resourceId === input.resourceId) &&
          (!input.status || row.status === input.status)
      ) ?? null
    );
  }

  async list(
    scope: PluginResourceBindingsScope,
    input: Parameters<PluginResourceBindingsRepository['list']>[1]
  ) {
    return Array.from(this.values.values())
      .filter(
        (row) =>
          row.pluginId === scope.pluginId &&
          row.scopeType === input.resourceScope.type &&
          row.scopeId === input.resourceScope.id &&
          (!input.resourceType || row.resourceType === input.resourceType) &&
          (!input.status || row.status === input.status)
      )
      .slice(input.offset, input.offset + input.limit);
  }

  async upsert(
    scope: PluginResourceBindingsScope,
    input: Parameters<PluginResourceBindingsRepository['upsert']>[1]
  ) {
    const now = new Date();
    if (input.cardinality === 'one') {
      for (const row of this.values.values()) {
        if (
          row.pluginId === scope.pluginId &&
          row.scopeType === input.resourceScope.type &&
          row.scopeId === input.resourceScope.id &&
          row.resourceType === input.resourceType
        ) {
          row.status = 'archived';
          row.archivedAt = now;
          row.updatedAt = now;
        }
      }
    }

    const existing = Array.from(this.values.values()).find(
      (row) =>
        row.pluginId === scope.pluginId &&
        row.scopeType === input.resourceScope.type &&
        row.scopeId === input.resourceScope.id &&
        row.resourceType === input.resourceType &&
        row.resourceId === input.resourceId
    );
    const row: PluginResourceBindingRow = {
      id: existing?.id ?? `binding-${this.values.size + 1}`,
      pluginId: scope.pluginId,
      scopeType: input.resourceScope.type,
      scopeId: input.resourceScope.id,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      displayName: input.displayName ?? null,
      status: input.status,
      metadata: input.metadata,
      createdByUserId: existing?.createdByUserId ?? scope.userId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      archivedAt: null,
    };
    this.values.set(row.id, row);
    return row;
  }

  async getById(scope: PluginResourceBindingsScope, id: string) {
    const row = this.values.get(id);
    return row?.pluginId === scope.pluginId ? row : null;
  }

  async archive(scope: PluginResourceBindingsScope, id: string) {
    const row = await this.getById(scope, id);
    if (!row) {
      throw new Error('not found');
    }
    const archived = {
      ...row,
      status: 'archived',
      archivedAt: new Date(),
      updatedAt: new Date(),
    } satisfies PluginResourceBindingRow;
    this.values.set(id, archived);
    return archived;
  }
}

describe('plugin capability context', () => {
  const auditEvents: AuditEvent[] = [];
  const usageRecords: UsageRecord[] = [];
  const eventHandlers = new Map<string, (payload: unknown) => void | Promise<void>>();
  const registeredJobs = new Map<
    string,
    (payload?: Record<string, unknown>) => void | Promise<void>
  >();
  const webhookReceipts: unknown[] = [];

  const auditPort: AuditPort = {
    async log(event) {
      auditEvents.push(event);
    },
    async query() {
      return auditEvents;
    },
  };

  const usageLedger: UsageLedger = {
    async record(usage) {
      usageRecords.push(usage);
    },
    async query() {
      return usageRecords;
    },
    async getQuotaUsage() {
      return usageRecords.reduce((sum, record) => sum + record.amount, 0);
    },
  };

  beforeEach(() => {
    auditEvents.length = 0;
    usageRecords.length = 0;
    eventHandlers.clear();
    registeredJobs.clear();
    webhookReceipts.length = 0;
    setDefaultPluginInternalServiceRegistry(undefined);
  });

  it('wires files, events, jobs, audit, usage, credits, billing, notifications, config, secrets, and webhooks with gates', async () => {
    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        const payload = 'hello webhook';
        const secret = 'signing-secret';
        const signature = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
        const configRepository = new MemoryConfigRepository();
        const secretsRepository = new MemorySecretsRepository();
        const artifactsRepository = new MemoryArtifactsRepository();
        const filesRepository = new MemoryFilesRepository();
        const httpFetch = vi.fn<PluginHttpHost['fetch']>(async () => Response.json({ ok: true }));
        const generateText = vi.fn<PluginAiHost['generateText']>(async (_scope, input) => ({
          text: `Generated ${input.messages.at(-1)?.content}`,
          model: input.model,
          provider: 'test-provider',
        }));
        const embedText = vi.fn<PluginAiHost['embedText']>(async (_scope, input) => ({
          embeddings: input.input.map((_value, index) => ({ index, embedding: [index, 1] })),
          model: input.model,
          provider: 'test-provider',
        }));
        const getCurrentPlan = vi.fn<PluginBillingHost['getCurrentPlan']>(async () => ({
          id: 'pro',
          name: 'Pro',
        }));
        const hasEntitlement = vi.fn<PluginBillingHost['hasEntitlement']>(
          async (_scope, feature) => feature === 'feature.export'
        );
        const grantPlan = vi.fn<PluginBillingHost['grantPlan']>(async (_scope, input) => ({
          entitlementId: 'entitlement-1',
          userId: input.userId,
          planId: input.planId,
          status: 'active',
        }));
        const redeemCode = vi.fn<PluginBillingHost['redeemCode']>(async (_scope, input) => ({
          redeemed: true,
          redemptionId: 'redemption-1',
          entitlement: {
            entitlementId: 'entitlement-1',
            userId: input.userId,
            planId: 'pro',
            status: 'active',
          },
        }));
        const getCreditBalance = vi.fn<PluginCreditsHost['getBalance']>(async (scope, metric) => ({
          balance: 10,
          metric,
          userId: scope.userId ?? 'user-1',
        }));
        const consumeCredits = vi.fn<PluginCreditsHost['consume']>(async (_scope, input) => ({
          consumed: true,
          amount: input.amount,
          balanceBefore: 10,
          balanceAfter: 10 - input.amount,
          meter: input.meter,
          userId: input.userId,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata,
        }));
        const sendNotification = vi.fn<PluginNotificationsHost['send']>(async () => ({
          id: 'notification-1',
          queued: true,
        }));
        const request = new Request('https://test.local/api/plugins/capability-test/webhook', {
          method: 'POST',
          headers: {
            'x-ploykit-signature': signature,
          },
          body: payload,
        });

        const context = createPluginRuntimeContext({
          contract: createContract(ORDINARY_PERMISSIONS, ['https://api.example.test']),
          request,
          user: { id: 'user-1', role: 'user', email: 'user@example.test' },
          requestId: 'request-1',
          capabilities: {
            files: {
              auditPort,
              repository: filesRepository,
              host: {
                getBlobStore: () => ({
                  put: vi.fn(async () => ({ key: 'stored', size: 5 })),
                  get: vi.fn(async () => ({
                    body: Buffer.from('hello'),
                    contentType: 'text/plain',
                  })),
                  delete: vi.fn(async () => undefined),
                  exists: vi.fn(async () => true),
                }),
                createSignedUrl: vi.fn(
                  async ({ file, operation }) => `/api/plugin-files/${file.id}/${operation}`
                ),
                getQuota: vi.fn(async () => ({ maxFileSizeBytes: 1024 * 1024 })),
              },
            },
            artifacts: { repository: artifactsRepository, auditPort },
            events: {
              host: {
                emit: async (event, _pluginId, eventPayload) => {
                  await eventHandlers.get(event)?.(eventPayload);
                },
                on: (event, _pluginId, handler) => {
                  eventHandlers.set(event, (eventPayload) =>
                    handler(eventPayload, {
                      emitterId: 'platform',
                      timestamp: new Date('2026-05-08T00:00:00.000Z'),
                      eventId: 'event-1',
                      correlationId: 'request-1',
                    })
                  );
                },
                off: (event) => {
                  eventHandlers.delete(event);
                },
              },
            },
            jobs: {
              host: {
                registerJob: (definition) => {
                  const handler = definition.handler as (
                    payload?: Record<string, unknown>
                  ) => void | Promise<void>;
                  registeredJobs.set(definition.name, handler);
                },
                runJob: async (name, jobPayload) => {
                  await registeredJobs.get(name)?.(jobPayload as Record<string, unknown>);
                  return {
                    id: 'job-run-1',
                    jobName: name,
                    status: 'succeeded',
                    attempts: 1,
                    startedAt: new Date(),
                    completedAt: new Date(),
                  };
                },
              },
            },
            http: { host: { fetch: httpFetch } },
            ai: {
              host: { generateText, embedText },
              creditsHost: { consume: consumeCredits },
              usageLedger,
              auditPort,
            },
            audit: { auditPort },
            usage: { usageLedger },
            credits: { host: { getBalance: getCreditBalance, consume: consumeCredits } },
            metering: {
              usageLedger,
              creditsHost: { getBalance: getCreditBalance, consume: consumeCredits },
            },
            billing: { host: { getCurrentPlan, hasEntitlement, grantPlan, redeemCode } },
            notifications: { host: { send: sendNotification } },
            config: { repository: configRepository, auditPort },
            secrets: { repository: secretsRepository, auditPort },
            webhooks: {
              secret,
              writeReceipt: async (receipt) => {
                webhookReceipts.push(receipt);
                return { id: 'receipt-1', status: 'received', createdAt: new Date() };
              },
            },
          },
        });

        const userFileScope = { type: 'user' as const, id: 'user-1' };
        const uploaded = await context.files.createUpload({
          scope: userFileScope,
          fileName: 'note.txt',
          body: Buffer.from('hello'),
          contentType: 'text/plain',
          size: 5,
          purpose: 'source',
        });
        const file = await context.files.read(uploaded.id);
        const listedFiles = await context.files.list({ scope: userFileScope, status: 'ready' });
        const signedDownloadUrl = await context.files.createSignedDownloadUrl(uploaded.id);
        await context.files.delete(uploaded.id);
        const workspaceScope = { type: 'workspace' as const, id: 'workspace-1' };
        const artifact = await context.artifacts.writeText({
          scope: workspaceScope,
          path: 'docs/outline.md',
          content: '# Outline',
          contentType: 'text/markdown',
          metadata: { artifactType: 'outline' },
        });
        const artifactRead = await context.artifacts.readText({
          scope: workspaceScope,
          path: 'docs/outline.md',
        });
        const artifactList = await context.artifacts.list({ scope: workspaceScope });
        const artifactTree = await context.artifacts.tree({ scope: workspaceScope });
        const artifactMeta = await context.artifacts.updateMetadata({
          scope: workspaceScope,
          path: 'docs/outline.md',
          metadata: { indexed: true },
        });
        await context.artifacts.delete({ scope: workspaceScope, path: 'docs/outline.md' });

        let eventPayload: unknown;
        context.events.on?.('platform.user.created', (received) => {
          eventPayload = received;
        });
        await context.events.emit('capability-test.created', { ok: true });
        await eventHandlers.get('platform.user.created')?.({ userId: 'user-2' });

        let jobPayload: unknown;
        context.jobs.register?.('capability-test.cleanup', (received) => {
          jobPayload = received;
        });
        const job = await context.jobs.enqueue('capability-test.cleanup', { run: true });

        expect(await context.config.get('theme')).toBe('light');
        await context.config.set?.('theme', 'dark');
        expect(await context.config.get('theme')).toBe('dark');
        await context.secrets.set?.('api-key', 'secret-value');
        expect(await context.secrets.get('api-key')).toBe('secret-value');

        await context.audit.record('capability-test.audit', { ok: true });
        await context.usage.increment('capability-test.api.calls', 2, {
          idempotencyKey: 'usage-1',
        });
        const creditBalance = await context.credits.getBalance();
        const creditConsumption = await context.credits.consume({
          meter: 'capability-test.external-api',
          amount: 2,
          idempotencyKey: 'credits-1',
          metadata: { provider: 'example' },
        });
        const meterAuthorization = await context.metering.authorize({
          meter: 'capability-test.ocr.page',
          amount: 3,
          idempotencyKey: 'meter-auth-1',
        });
        const meterCommit = await context.metering.commit({
          meter: 'capability-test.ocr.page',
          amount: 2,
          idempotencyKey: 'meter-commit-1',
          runId: 'run-1',
          metadata: { source: 'test' },
        });
        const meterReconcile = await context.metering.reconcile({
          meter: 'capability-test.ocr.page',
        });
        const plan = await context.billing.getCurrentPlan();
        const entitled = await context.billing.hasEntitlement('feature.export');
        const granted = await context.billing.grantPlan({ planId: 'pro', reason: 'redeemed-code' });
        const redemption = await context.billing.redeemCode({ code: 'WELCOME-2026' });
        const notification = await context.notifications.send({
          message: 'Ready',
          channel: 'in-app',
        });
        const aiText = await context.ai.generateText({
          prompt: 'outline',
          meter: 'capability-test.ai.generate',
          idempotencyKey: 'ai-generate-1',
          creditAmount: 1,
        });
        const aiEmbedding = await context.ai.embedText({
          input: 'outline',
          meter: 'capability-test.ai.embed',
          idempotencyKey: 'ai-embed-1',
          creditAmount: 1,
        });
        const httpResponse = await context.http.fetch('https://api.example.test/v1/items');

        const verification = await context.webhooks.verify('hmac-sha256');
        const accepted = context.webhooks.respondAccepted();

        expect(uploaded).toMatchObject({
          id: 'file-1',
          scope: userFileScope,
          fileName: 'note.txt',
          contentType: 'text/plain',
          status: 'ready',
          purpose: 'source',
        });
        expect(file.record.contentType).toBe('text/plain');
        expect(listedFiles).toHaveLength(1);
        expect(signedDownloadUrl).toBe('/api/plugin-files/file-1/download');
        expect(artifact).toMatchObject({
          id: 'artifact-1',
          scope: workspaceScope,
          path: 'docs/outline.md',
          content: '# Outline',
          contentType: 'text/markdown',
          metadata: { artifactType: 'outline' },
          version: 1,
        });
        expect(artifactRead).toMatchObject({ content: '# Outline' });
        expect(artifactList).toHaveLength(1);
        expect(artifactTree[0]).toMatchObject({ name: 'outline.md', parentPath: 'docs' });
        expect(artifactMeta).toMatchObject({
          metadata: { artifactType: 'outline', indexed: true },
          version: 2,
        });
        expect(eventPayload).toEqual({ userId: 'user-2' });
        expect(job).toEqual({ id: 'job-run-1' });
        expect(jobPayload).toEqual({ run: true });
        expect(await httpResponse.json()).toEqual({ ok: true });
        expect(String(httpFetch.mock.calls[0]?.[0])).toBe('https://api.example.test/v1/items');
        expect(plan).toEqual({ id: 'pro', name: 'Pro' });
        expect(entitled).toBe(true);
        expect(creditBalance).toEqual({
          balance: 10,
          metric: 'platform.apiCallsRemaining',
          userId: 'user-1',
        });
        expect(creditConsumption).toEqual({
          consumed: true,
          amount: 2,
          balanceBefore: 10,
          balanceAfter: 8,
          meter: 'capability-test.external-api',
          userId: 'user-1',
          idempotencyKey: 'credits-1',
          metadata: { provider: 'example' },
        });
        expect(getCreditBalance).toHaveBeenCalledWith(
          expect.objectContaining({
            pluginId: 'capability-test',
            userId: 'user-1',
          }),
          'platform.apiCallsRemaining'
        );
        expect(consumeCredits).toHaveBeenCalledWith(
          expect.objectContaining({
            pluginId: 'capability-test',
            userId: 'user-1',
          }),
          expect.objectContaining({
            meter: 'capability-test.external-api',
            amount: 2,
            userId: 'user-1',
            idempotencyKey: 'credits-1',
            metadata: { provider: 'example' },
          })
        );
        expect(meterAuthorization).toMatchObject({
          authorized: true,
          meter: 'capability-test.ocr.page',
          amount: 3,
          unit: 'page',
          creditCost: 6,
        });
        expect(meterCommit).toMatchObject({
          meter: 'capability-test.ocr.page',
          amount: 2,
          unit: 'page',
          creditCost: 4,
          credits: { amount: 4 },
        });
        expect(meterReconcile).toMatchObject({
          meter: 'capability-test.ocr.page',
          userId: 'user-1',
          usageAmount: 2,
          unit: 'page',
        });
        expect(consumeCredits).toHaveBeenCalledWith(
          expect.objectContaining({
            pluginId: 'capability-test',
            userId: 'user-1',
          }),
          expect.objectContaining({
            meter: 'capability-test.ocr.page',
            amount: 4,
            userId: 'user-1',
            idempotencyKey: 'meter-commit-1:credits',
            metadata: { runId: 'run-1', source: 'test' },
          })
        );
        expect(granted).toEqual({
          entitlementId: 'entitlement-1',
          userId: 'user-1',
          planId: 'pro',
          status: 'active',
        });
        expect(redemption).toMatchObject({
          redeemed: true,
          redemptionId: 'redemption-1',
          entitlement: {
            userId: 'user-1',
            planId: 'pro',
          },
        });
        expect(grantPlan).toHaveBeenCalledWith(
          expect.objectContaining({
            pluginId: 'capability-test',
            userId: 'user-1',
          }),
          expect.objectContaining({
            planId: 'pro',
            userId: 'user-1',
            reason: 'redeemed-code',
          })
        );
        expect(redeemCode).toHaveBeenCalledWith(
          expect.objectContaining({
            pluginId: 'capability-test',
            userId: 'user-1',
          }),
          expect.objectContaining({
            code: 'WELCOME-2026',
            userId: 'user-1',
          })
        );
        expect(notification).toEqual({ id: 'notification-1', queued: true });
        expect(aiText).toMatchObject({
          text: 'Generated outline',
          provider: 'test-provider',
          usage: { creditsConsumed: 1 },
        });
        expect(aiEmbedding).toMatchObject({
          embeddings: [{ index: 0, embedding: [0, 1] }],
          provider: 'test-provider',
          usage: { creditsConsumed: 1 },
        });
        expect(generateText).toHaveBeenCalled();
        expect(embedText).toHaveBeenCalled();
        expect(sendNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            pluginId: 'capability-test',
            recipientUserId: 'user-1',
            channel: 'in-app',
            message: 'Ready',
          })
        );
        expect(usageRecords[0]).toMatchObject({
          idempotencyKey: 'usage-1',
          userId: 'user-1',
          amount: 2,
          metadata: {
            pluginId: 'capability-test',
            metric: 'capability-test.api.calls',
          },
        });
        expect(usageRecords).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              idempotencyKey: 'meter-commit-1:usage',
              userId: 'user-1',
              amount: 2,
              unit: 'page',
              metadata: expect.objectContaining({
                pluginId: 'capability-test',
                meter: 'capability-test.ocr.page',
                runId: 'run-1',
              }),
            }),
          ])
        );
        expect(verification).toMatchObject({
          verified: true,
          policy: 'hmac-sha256',
          provider: 'custom',
          receiptId: 'receipt-1',
        });
        expect(accepted.status).toBe(202);
        expect(webhookReceipts).toHaveLength(1);
        expect(auditEvents.map((event) => event.action)).toEqual(
          expect.arrayContaining([
            'capability-test.files.createUpload',
            'capability-test.files.delete',
            'capability-test.artifacts.write',
            'capability-test.artifacts.updateMetadata',
            'capability-test.artifacts.delete',
            'capability-test.config.set',
            'capability-test.secrets.set',
            'capability-test.audit',
            'capability-test.ai.generateText',
            'capability-test.ai.embedText',
          ])
        );
        expect(JSON.stringify(auditEvents)).not.toContain('secret-value');
      }
    );
  }, 30_000);

  it('propagates runtime API key identity into audit, usage, and metering records', async () => {
    const consumeCredits = vi.fn<PluginCreditsHost['consume']>(async (_scope, input) => ({
      consumed: true,
      amount: input.amount,
      balanceBefore: 10,
      balanceAfter: 10 - input.amount,
      meter: input.meter,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata,
    }));
    const context = createPluginRuntimeContext({
      contract: createContract([
        Permission.AuditWrite,
        Permission.UsageWrite,
        Permission.MeteringWrite,
      ]),
      request: new Request('https://test.local/api/plugins/capability-test/machine', {
        method: 'POST',
      }),
      user: { id: 'user-1', role: 'user', email: 'user@example.test' },
      apiKey: {
        id: 'api-key-1',
        scope: { type: 'user', id: 'user-1' },
        permissions: ['POST:/machine'],
      },
      requestId: 'request-1',
      capabilities: {
        audit: { auditPort },
        usage: { usageLedger },
        metering: {
          usageLedger,
          creditsHost: {
            getBalance: vi.fn(async () => ({
              balance: 10,
              metric: 'platform.apiCallsRemaining',
              userId: 'user-1',
            })),
            consume: consumeCredits,
          },
        },
      },
    });

    await context.audit.record('capability-test.machine.audit', { ok: true });
    await context.usage.increment('capability-test.machine.calls', 1, {
      idempotencyKey: 'usage-machine-1',
    });
    await context.metering.commit({
      meter: 'capability-test.ocr.page',
      amount: 1,
      idempotencyKey: 'meter-machine-1',
    });

    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'capability-test.machine.audit',
          details: expect.objectContaining({
            apiKeyId: 'api-key-1',
            apiKeyScope: { type: 'user', id: 'user-1' },
          }),
        }),
      ])
    );
    expect(usageRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          idempotencyKey: 'usage-machine-1',
          metadata: expect.objectContaining({
            apiKeyId: 'api-key-1',
            apiKeyScope: { type: 'user', id: 'user-1' },
          }),
        }),
        expect.objectContaining({
          idempotencyKey: 'meter-machine-1:usage',
          metadata: expect.objectContaining({
            apiKeyId: 'api-key-1',
            meter: 'capability-test.ocr.page',
          }),
        }),
      ])
    );
    expect(consumeCredits).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: 'capability-test', userId: 'user-1' }),
      expect.objectContaining({
        idempotencyKey: 'meter-machine-1:credits',
        metadata: expect.objectContaining({ apiKeyId: 'api-key-1' }),
      })
    );
  });

  it('rejects metering authorization when credits are insufficient', async () => {
    const getCreditBalance = vi.fn<PluginCreditsHost['getBalance']>(async (scope, metric) => ({
      balance: 1,
      metric,
      userId: scope.userId ?? 'user-1',
    }));
    const context = createPluginRuntimeContext({
      contract: createContract(),
      request: new Request('https://test.local/api/plugins/capability-test/meters'),
      requestId: 'request-1',
      user: { id: 'user-1', role: 'user' },
      capabilities: {
        metering: {
          usageLedger,
          creditsHost: { getBalance: getCreditBalance },
        },
      },
    });

    await expect(
      context.metering.authorize({
        meter: 'capability-test.ocr.page',
        amount: 2,
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_METERING_CREDITS_INSUFFICIENT',
      statusCode: 402,
    });
  });

  it('rejects capability calls when the plugin did not declare the permission', async () => {
    const context = createPluginRuntimeContext({
      contract: createContract([Permission.FilesRead]),
      request: new Request('https://test.local/api/plugins/capability-test/files'),
      user: { id: 'user-1', role: 'user' },
    });

    await expect(
      context.files.createUpload({
        scope: { type: 'user' },
        fileName: 'note.txt',
        body: Buffer.from('hello'),
        contentType: 'text/plain',
        size: 5,
        purpose: 'source',
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
    });

    await expect(
      context.artifacts.readText({
        scope: { type: 'workspace', id: 'workspace-1' },
        path: 'docs/outline.md',
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.ArtifactsRead,
        capability: 'ctx.artifacts.readText',
      },
    });

    await expect(
      context.artifacts.writeText({
        scope: { type: 'workspace', id: 'workspace-1' },
        path: 'docs/outline.md',
        content: '# Outline',
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.ArtifactsWrite,
        capability: 'ctx.artifacts.writeText',
      },
    });

    await expect(context.billing.getCurrentPlan()).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.BillingRead,
        capability: 'ctx.billing.getCurrentPlan',
      },
    });

    await expect(context.credits.getBalance()).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.CreditsRead,
        capability: 'ctx.credits.getBalance',
      },
    });

    await expect(
      context.credits.consume({ meter: 'capability-test.external-api' })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.CreditsConsume,
        capability: 'ctx.credits.consume',
      },
    });

    await expect(
      context.metering.commit({ meter: 'capability-test.ocr.page' })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.MeteringWrite,
        capability: 'ctx.metering.commit',
      },
    });

    await expect(context.billing.grantPlan({ planId: 'pro' })).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.BillingWrite,
        capability: 'ctx.billing.grantPlan',
      },
    });

    await expect(context.notifications.send({ message: 'Hello' })).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.NotificationsSend,
        capability: 'ctx.notifications.send',
      },
    });

    await expect(context.ai.generateText({ prompt: 'Hello' })).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.AiGenerate,
        capability: 'ctx.ai.generateText',
      },
    });

    await expect(context.ai.embedText({ input: 'Hello' })).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.AiEmbed,
        capability: 'ctx.ai.embedText',
      },
    });
  });

  it('rejects http calls without permission or matching egress', async () => {
    const noPermissionContext = createPluginRuntimeContext({
      contract: createContract([], ['https://api.example.test']),
      request: new Request('https://test.local/api/plugins/capability-test/http'),
      user: { id: 'user-1', role: 'user' },
    });

    await expect(
      noPermissionContext.http.fetch('https://api.example.test/v1')
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.ExternalHttp,
        capability: 'ctx.http.fetch',
      },
    });

    const missingEgressContext = createPluginRuntimeContext({
      contract: createContract([Permission.ExternalHttp]),
      request: new Request('https://test.local/api/plugins/capability-test/http'),
      user: { id: 'user-1', role: 'user' },
    });

    await expect(
      missingEgressContext.http.fetch('https://api.example.test/v1')
    ).rejects.toMatchObject({
      code: 'PLUGIN_HTTP_EGRESS_FORBIDDEN',
      details: {
        origin: 'https://api.example.test',
      },
    });

    const ssrfContext = createPluginRuntimeContext({
      contract: createContract([Permission.ExternalHttp], ['http://127.0.0.1', 'http://localhost']),
      request: new Request('https://test.local/api/plugins/capability-test/http'),
      user: { id: 'user-1', role: 'user' },
    });

    await expect(ssrfContext.http.fetch('http://127.0.0.1:80/admin')).rejects.toMatchObject({
      code: 'PLUGIN_HTTP_SSRF_FORBIDDEN',
      details: { host: '127.0.0.1' },
    });
    await expect(ssrfContext.http.fetch('http://localhost/status')).rejects.toMatchObject({
      code: 'PLUGIN_HTTP_SSRF_FORBIDDEN',
      details: { host: 'localhost' },
    });

    const metadataContext = createPluginRuntimeContext({
      contract: createContract([Permission.ExternalHttp], ['http://169.254.169.254']),
      request: new Request('https://test.local/api/plugins/capability-test/http'),
      user: { id: 'user-1', role: 'user' },
    });

    await expect(
      metadataContext.http.fetch('http://169.254.169.254/latest/meta-data')
    ).rejects.toMatchObject({
      code: 'PLUGIN_HTTP_SSRF_FORBIDDEN',
      details: { host: '169.254.169.254' },
    });
  });

  it('invokes host internal services with declared paths and signed actor claims', async () => {
    const serviceLogs: unknown[] = [];
    const serviceFetch = vi.fn<PluginHttpHost['fetch']>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      return Response.json({
        ok: true,
        authorization: headers.get('authorization'),
        claims: headers.get('ploykit-actor-claims'),
        signature: headers.get('ploykit-actor-signature'),
        spoofed: headers.get('ploykit-actor-jwt'),
      });
    });
    const registry: PluginInternalServiceRegistry = {
      get(name) {
        return {
          name,
          baseUrl: 'https://internal.example.test',
          auth: { type: 'bearer', token: 'service-token' },
          actorClaims: { enabled: true, secret: 'actor-secret', ttlSeconds: 60 },
        };
      },
    };
    const logRepository: PluginServiceCallLogRepository = {
      async record(input) {
        serviceLogs.push(input);
      },
    };
    const contract = normalizePluginRuntimeContract(
      definePlugin({
        id: 'capability-test',
        name: 'Capability Test',
        version: '1.0.0',
        permissions: [Permission.ServicesInvoke],
        services: [
          {
            name: 'core-api',
            methods: ['GET'],
            paths: ['/v1/projects/:projectId'],
            actorClaims: true,
          },
        ],
      })
    );
    const context = createPluginRuntimeContext({
      contract,
      request: new Request('https://test.local/api/plugins/capability-test/projects/project-1'),
      user: { id: 'user-1', role: 'user', email: 'user@example.test' },
      requestId: 'request-1',
      capabilities: {
        services: {
          registry,
          httpHost: { fetch: serviceFetch },
          logRepository,
          auditPort,
          usageLedger,
        },
      },
    });

    const payload = await context.services.json<{
      authorization: string;
      claims: string;
      signature: string;
      spoofed: string | null;
    }>('core-api', '/v1/projects/project-1', {
      headers: {
        authorization: 'Bearer spoof',
        'ploykit-actor-jwt': 'spoof',
      },
    });
    await context.services.fetch('core-api', '/v1/projects/project-1');

    expect(serviceFetch).toHaveBeenCalledWith(
      'https://internal.example.test/v1/projects/project-1',
      expect.objectContaining({ method: 'GET' })
    );
    expect(payload.authorization).toBe('Bearer service-token');
    expect(payload.claims).toBeTruthy();
    expect(payload.signature).toMatch(/^v1=/);
    expect(payload.spoofed).toBeNull();
    expect(serviceLogs[0]).toMatchObject({
      pluginId: 'capability-test',
      serviceName: 'core-api',
      method: 'GET',
      path: '/v1/projects/project-1',
      pathTemplate: '/v1/projects/:projectId',
      status: 200,
    });
    expect(serviceLogs).toHaveLength(2);
    expect(usageRecords).toHaveLength(2);
    expect(new Set(usageRecords.map((record) => record.idempotencyKey)).size).toBe(2);
  });

  it('uses the host default internal service registry when no per-context registry is passed', async () => {
    const serviceFetch = vi.fn<PluginHttpHost['fetch']>(async () =>
      Response.json({ ok: true, source: 'default-registry' })
    );
    setDefaultPluginInternalServiceRegistry({
      get(name) {
        return {
          name,
          baseUrl: 'https://default.internal.test',
        };
      },
    });
    const contract = normalizePluginRuntimeContract(
      definePlugin({
        id: 'capability-test',
        name: 'Capability Test',
        version: '1.0.0',
        permissions: [Permission.ServicesInvoke],
        services: [{ name: 'core-api', methods: ['GET'], paths: ['/v1/projects'] }],
      })
    );
    const context = createPluginRuntimeContext({
      contract,
      request: new Request('https://test.local/api/plugins/capability-test/projects'),
      user: { id: 'user-1', role: 'user' },
      capabilities: {
        services: {
          httpHost: { fetch: serviceFetch },
          logRepository: { record: async () => undefined },
        },
      },
    });

    await expect(context.services.json('core-api', '/v1/projects')).resolves.toMatchObject({
      source: 'default-registry',
    });
    expect(serviceFetch).toHaveBeenCalledWith(
      'https://default.internal.test/v1/projects',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('manages declared resource bindings with scoped archive checks', async () => {
    await withPluginResourceScopeAccessOverride(
      async () => true,
      async () => {
        const repository = new MemoryResourceBindingsRepository();
        const contract = normalizePluginRuntimeContract(
          definePlugin({
            id: 'capability-test',
            name: 'Capability Test',
            version: '1.0.0',
            permissions: [Permission.ResourceBindingsRead, Permission.ResourceBindingsWrite],
            resourceBindings: [
              {
                type: 'project',
                scope: 'workspace',
                cardinality: 'one',
                permissions: {
                  read: ['owner', 'admin', 'editor', 'viewer'],
                  write: ['owner', 'admin'],
                },
              },
            ],
          })
        );
        const context = createPluginRuntimeContext({
          contract,
          request: new Request('https://test.local/api/plugins/capability-test/bindings'),
          user: { id: 'user-1', role: 'user' },
          requestId: 'request-1',
          capabilities: {
            resourceBindings: { repository, auditPort },
          },
        });

        const binding = await context.resourceBindings.upsert({
          scope: { type: 'workspace', id: 'workspace-1' },
          resourceType: 'project',
          resourceId: 'project-1',
          displayName: 'Project 1',
        });
        const found = await context.resourceBindings.get({
          scope: { type: 'workspace', id: 'workspace-1' },
          resourceType: 'project',
        });
        const archived = await context.resourceBindings.archive(binding.id);

        expect(found?.id).toBe(binding.id);
        expect(archived.status).toBe('archived');
        expect(auditEvents.map((event) => event.action)).toEqual(
          expect.arrayContaining([
            'capability-test.resourceBindings.upsert',
            'capability-test.resourceBindings.archive',
          ])
        );
      }
    );
  });

  it('enforces declared resource binding workspace roles exactly', async () => {
    const repository = new MemoryResourceBindingsRepository();
    const roleForUser = new Map<string, 'owner' | 'admin' | 'editor' | 'viewer'>([
      ['owner-user', 'owner'],
      ['editor-user', 'editor'],
      ['viewer-user', 'viewer'],
    ]);
    const contract = normalizePluginRuntimeContract(
      definePlugin({
        id: 'capability-test',
        name: 'Capability Test',
        version: '1.0.0',
        permissions: [Permission.ResourceBindingsRead, Permission.ResourceBindingsWrite],
        resourceBindings: [
          {
            type: 'project',
            scope: 'workspace',
            permissions: {
              read: ['editor'],
              write: ['editor'],
            },
          },
        ],
      })
    );
    const contextFor = (userId: string) =>
      createPluginRuntimeContext({
        contract,
        request: new Request('https://test.local/api/plugins/capability-test/bindings'),
        user: { id: userId, role: 'user' },
        capabilities: {
          resourceBindings: { repository },
        },
      });

    await withPluginResourceScopeAccessOverride(
      async (scope, resourceScope, action, capability, requiredRoles) => {
        if (resourceScope.type === 'user') {
          return resourceScope.id === scope.user?.id;
        }
        const role = roleForUser.get(scope.user?.id ?? '');
        if (role && requiredRoles?.includes(role)) {
          return true;
        }
        throw new PluginError({
          code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
          message: `${capability} cannot ${action} workspace in test.`,
          statusCode: 403,
          details: { requiredRoles, role },
        });
      },
      async () => {
        const editorContext = contextFor('editor-user');
        await expect(
          editorContext.resourceBindings.upsert({
            scope: { type: 'workspace', id: 'workspace-1' },
            resourceType: 'project',
            resourceId: 'project-1',
          })
        ).resolves.toMatchObject({ resourceId: 'project-1' });
        await expect(
          editorContext.resourceBindings.get({
            scope: { type: 'workspace', id: 'workspace-1' },
            resourceType: 'project',
          })
        ).resolves.toMatchObject({ resourceId: 'project-1' });

        await expect(
          contextFor('viewer-user').resourceBindings.upsert({
            scope: { type: 'workspace', id: 'workspace-1' },
            resourceType: 'project',
            resourceId: 'project-2',
          })
        ).rejects.toMatchObject({
          code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
          details: { role: 'viewer', requiredRoles: ['editor'] },
        });
        await expect(
          contextFor('owner-user').resourceBindings.get({
            scope: { type: 'workspace', id: 'workspace-1' },
            resourceType: 'project',
          })
        ).rejects.toMatchObject({
          code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
          details: { role: 'owner', requiredRoles: ['editor'] },
        });
      }
    );
  });

  it('returns structured errors for invalid notification input', async () => {
    const context = createPluginRuntimeContext({
      contract: createContract([Permission.NotificationsSend]),
      request: new Request('https://test.local/api/plugins/capability-test/notifications'),
      user: { id: 'user-1', role: 'user' },
    });

    await expect(context.notifications.send({ message: '   ' })).rejects.toMatchObject({
      code: 'PLUGIN_NOTIFICATION_MESSAGE_REQUIRED',
    });

    await expect(
      context.notifications.send({ message: 'Ready', channel: 'sms' as never })
    ).rejects.toMatchObject({
      code: 'PLUGIN_NOTIFICATION_CHANNEL_INVALID',
      details: {
        channel: 'sms',
      },
    });
  });

  it('rejects storage calls when read or write permissions are missing', async () => {
    const noStorageContext = createPluginRuntimeContext({
      contract: createContract([]),
      request: new Request('https://test.local/api/plugins/capability-test/storage'),
      user: { id: 'user-1', role: 'user' },
    });

    await expect(
      noStorageContext.storage.collection('capability_items').findMany()
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.StorageRead,
        capability: 'ctx.storage.collection("capability_items").findMany',
      },
    });

    const readOnlyContext = createPluginRuntimeContext({
      contract: createContract([Permission.StorageRead]),
      request: new Request('https://test.local/api/plugins/capability-test/storage'),
      user: { id: 'user-1', role: 'user' },
    });

    await expect(
      readOnlyContext.storage.collection('capability_items').insert({ title: 'Denied' })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.StorageWrite,
        capability: 'ctx.storage.collection("capability_items").insert',
      },
    });

    await expect(readOnlyContext.storage.ensureCollections()).rejects.toMatchObject({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      details: {
        permission: Permission.StorageWrite,
        capability: 'ctx.storage.ensureCollections',
      },
    });
  });

  it('verifies provider-specific plugin webhook signatures', async () => {
    const payload = '{"id":"evt_test","type":"payment.created"}';
    const secret = 'stripe-webhook-secret';
    const timestamp = '1778160000';
    const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
    const receipts: unknown[] = [];
    const context = createPluginRuntimeContext({
      contract: createContract([Permission.WebhookReceive]),
      request: new Request('https://test.local/api/plugins/capability-test/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': `t=${timestamp},v1=${signature}`,
        },
        body: payload,
      }),
      user: { id: 'user-1', role: 'user' },
      capabilities: {
        webhooks: {
          secret,
          writeReceipt: async (receipt) => {
            receipts.push(receipt);
            return { id: 'stripe-receipt-1', status: 'received', createdAt: new Date() };
          },
        },
      },
    });

    await expect(context.webhooks.verify('stripe')).resolves.toMatchObject({
      verified: true,
      policy: 'stripe',
      provider: 'stripe',
      receiptId: 'stripe-receipt-1',
    });
    expect(receipts[0]).toMatchObject({
      provider: 'stripe',
      eventId: 'evt_test',
      status: 'received',
    });
  });
});
