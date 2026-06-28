import type { ModuleRuntimeHost } from '@/lib/module-runtime/host';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type {
  RuntimeStore,
  RuntimeStoreAuditRecord,
  RuntimeStoreNotificationDeliveryRecord,
  RuntimeStoreNotificationRecord,
  RuntimeStoreOutboxRecord,
  RuntimeStoreOutboxStatus,
  RuntimeStoreResourceBindingRecord,
  RuntimeStoreServiceConnectionRecord,
  RuntimeStoreUsageRecord,
  RuntimeStoreWebhookReceipt,
} from '@/lib/module-runtime/stores';
import type { ModuleRunRecord } from '@/lib/module-runtime/runs';
import type {
  ModuleCatalogModuleState,
  ModuleCatalogModuleStatus,
} from '@/lib/module-runtime/catalog';
import { assertAdminSession } from '../admin-session';

export interface AdminOperationsCenterOptions {
  host: ModuleRuntimeHost;
  store: RuntimeStore;
}

export interface AdminOperationsSnapshot {
  modules: {
    id: string;
    name: string;
    version: string;
    permissions: readonly string[];
  }[];
  routes: {
    moduleId: string;
    kind: string;
    path: string;
    auth: string;
  }[];
  counts: {
    modules: number;
    routes: number;
    runs: number;
    outbox: number;
    webhookReceipts: number;
    notifications: number;
    notificationDeliveries: number;
    auditLogs: number;
    usageRecords: number;
    catalogStates: number;
    memberships: number;
  };
  recent: {
    runs: ModuleRunRecord[];
    outbox: RuntimeStoreOutboxRecord[];
    webhookReceipts: RuntimeStoreWebhookReceipt[];
    notifications: RuntimeStoreNotificationRecord[];
    notificationDeliveries: RuntimeStoreNotificationDeliveryRecord[];
    auditLogs: RuntimeStoreAuditRecord[];
    usageRecords: RuntimeStoreUsageRecord[];
    catalogStates: ModuleCatalogModuleState[];
  };
}

export interface AdminOutboxBulkPreview {
  action: 'replay' | 'discard' | 'archive';
  matched: number;
  selected: number;
  limit: number;
  impact: {
    byStatus: Record<string, number>;
    byKind: Record<string, number>;
    byModule: Record<string, number>;
    oldestCreatedAt: string | null;
    newestCreatedAt: string | null;
  };
  records: Pick<
    RuntimeStoreOutboxRecord,
    'id' | 'name' | 'moduleId' | 'status' | 'attempts' | 'createdAt' | 'scheduledAt'
  >[];
}

function serviceConnectionUsable(record: RuntimeStoreServiceConnectionRecord): boolean {
  return record.status === 'active' && record.health.status === 'ready';
}

function serviceConnectionSatisfiesRequirement(input: {
  contract: ModuleRuntimeHost['contracts'][number];
  name: string;
  provider: string;
  record: RuntimeStoreServiceConnectionRecord;
}): boolean {
  const moduleScopedId = `${input.contract.id}:service:${input.name}`;
  if (!serviceConnectionUsable(input.record)) {
    return false;
  }
  return (
    input.record.connectionId === input.name ||
    input.record.connectionId === moduleScopedId ||
    (input.record.moduleId === input.contract.id && input.record.service === input.name) ||
    input.record.service === input.name ||
    input.record.provider === input.provider
  );
}

function resourceBindingSatisfiesRequirement(input: {
  contract: ModuleRuntimeHost['contracts'][number];
  name: string;
  kind: string;
  record: RuntimeStoreResourceBindingRecord;
}): boolean {
  if (input.record.status !== 'active') {
    return false;
  }
  if (input.record.moduleId && input.record.moduleId !== input.contract.id) {
    return false;
  }
  if (input.record.name !== input.name) {
    return false;
  }
  return !input.record.kind || input.record.kind === input.kind;
}

export function countMissingRequiredModuleRequirements(input: {
  contract: ModuleRuntimeHost['contracts'][number];
  serviceConnections?: readonly RuntimeStoreServiceConnectionRecord[];
  resourceBindings?: readonly RuntimeStoreResourceBindingRecord[];
}): number {
  let gaps = 0;

  for (const [name, requirement] of Object.entries(input.contract.serviceRequirements)) {
    if (!requirement.required) {
      continue;
    }
    const provider = requirement.provider ?? name;
    const satisfied = (input.serviceConnections ?? []).some((record) =>
      serviceConnectionSatisfiesRequirement({ contract: input.contract, name, provider, record })
    );
    if (!satisfied) {
      gaps += 1;
    }
  }

  for (const [name, binding] of Object.entries(input.contract.resourceBindings)) {
    if (!binding.required) {
      continue;
    }
    const satisfied = (input.resourceBindings ?? []).some((record) =>
      resourceBindingSatisfiesRequirement({
        contract: input.contract,
        name,
        kind: binding.kind,
        record,
      })
    );
    if (!satisfied) {
      gaps += 1;
    }
  }

  return gaps;
}

export function createAdminOperationsCenter(options: AdminOperationsCenterOptions) {
  const { host, store } = options;

  async function setModuleStatus(
    session: ModuleHostSession,
    productId: string,
    moduleId: string,
    status: ModuleCatalogModuleStatus,
    reason?: string
  ) {
    assertAdminSession(session);
    const contract = host.contracts.find((item) => item.id === moduleId);
    if (!contract) {
      throw new Error(`ADMIN_MODULE_NOT_FOUND: ${moduleId}`);
    }
    const existing = (await store.listCatalogStates({ productId })).find(
      (state) => state.moduleId === moduleId
    );
    if (existing?.required && status !== 'enabled') {
      throw new Error(`ADMIN_MODULE_REQUIRED_STATUS_FORBIDDEN: ${moduleId}`);
    }
    const [runs, outbox, receipts] = await Promise.all([
      store.listRuns({ productId, moduleId }),
      store.listOutbox({ productId }),
      store.listWebhookReceipts({ productId, moduleId }),
    ]);
    const activeRuns = runs.filter((record) =>
      ['queued', 'running', 'cancel_requested'].includes(record.status)
    ).length;
    const pendingOutbox = outbox.filter(
      (record) =>
        record.moduleId === moduleId &&
        ['queued', 'processing', 'failed', 'dead_letter'].includes(record.status)
    ).length;
    const failedWebhookReceipts = receipts.filter((record) =>
      ['failed', 'rejected'].includes(record.status)
    ).length;
    const state = await store.upsertCatalogState({
      ...existing,
      productId,
      moduleId,
      status,
      updatedAt: new Date().toISOString(),
    });
    await store.recordAudit({
      productId,
      moduleId,
      actorId: session.actorId ?? session.user?.id,
      type: `admin.module.${status}`,
      metadata: {
        moduleId,
        previousStatus: existing?.status,
        nextStatus: status,
        reason,
        required: Boolean(state.required),
        bundleId: state.bundleId,
        scopeProfile: state.scopeProfile,
        impact: {
          activeRuns,
          pendingOutbox,
          failedWebhookReceipts,
        },
      },
    });
    return state;
  }

  async function retryOutbox(
    session: ModuleHostSession,
    id: string,
    reason = 'Retried by admin'
  ) {
    assertAdminSession(session);
    const previous = (await store.listOutbox()).find((candidate) => candidate.id === id);
    if (!previous) {
      throw new Error(`ADMIN_OUTBOX_NOT_FOUND: ${id}`);
    }
    const record = await store.markOutbox(id, 'queued');
    await store.recordAudit({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      actorId: session.actorId ?? session.user?.id,
      type: 'admin.outbox.retried',
      metadata: {
        outboxId: record.id,
        name: record.name,
        previousStatus: previous.status,
        nextStatus: record.status,
        previousAttempts: previous.attempts,
        attempts: record.attempts,
        reason,
      },
    });
    return record;
  }

  async function discardOutbox(
    session: ModuleHostSession,
    id: string,
    reason = 'Discarded by admin'
  ) {
    assertAdminSession(session);
    const previous = (await store.listOutbox()).find((candidate) => candidate.id === id);
    if (!previous) {
      throw new Error(`ADMIN_OUTBOX_NOT_FOUND: ${id}`);
    }
    const record = await store.markOutbox(id, 'dead_letter', reason);
    await store.recordAudit({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      actorId: session.actorId ?? session.user?.id,
      type: 'admin.outbox.discarded',
      metadata: {
        outboxId: record.id,
        name: record.name,
        previousStatus: previous.status,
        nextStatus: record.status,
        previousAttempts: previous.attempts,
        attempts: record.attempts,
        reason,
      },
    });
    return record;
  }

  async function archiveOutbox(
    session: ModuleHostSession,
    id: string,
    reason = 'Archived by admin'
  ) {
    assertAdminSession(session);
    const previous = (await store.listOutbox()).find((candidate) => candidate.id === id);
    if (!previous) {
      throw new Error(`ADMIN_OUTBOX_NOT_FOUND: ${id}`);
    }
    const record = await store.markOutbox(id, 'archived', reason);
    await store.recordAudit({
      productId: record.productId,
      workspaceId: record.workspaceId,
      moduleId: record.moduleId,
      actorId: session.actorId ?? session.user?.id,
      type: 'admin.outbox.archived',
      metadata: {
        outboxId: record.id,
        name: record.name,
        previousStatus: previous.status,
        nextStatus: record.status,
        previousAttempts: previous.attempts,
        attempts: record.attempts,
        reason,
      },
    });
    return record;
  }

  async function findBulkOutboxCandidates(input: {
    productId?: string;
    status?: RuntimeStoreOutboxStatus;
    namePrefix?: string;
    ids?: readonly string[];
    limit?: number;
  }) {
    const idSet = input.ids ? new Set(input.ids) : null;
    const candidates = await store.listOutbox({
      productId: input.productId,
      status: input.status,
      namePrefix: input.namePrefix,
    });
    const matched = idSet
      ? candidates.filter((record) => idSet.has(record.id))
      : candidates;
    return {
      matched: matched.length,
      records: matched.slice(0, Math.min(Math.max(input.limit ?? 50, 1), 200)),
    };
  }

  function outboxKind(record: RuntimeStoreOutboxRecord): string {
    if (record.name.startsWith('job:')) {
      return 'job';
    }
    if (record.name.startsWith('event:')) {
      return 'event';
    }
    if (record.name.startsWith('webhook:')) {
      return 'webhook';
    }
    if (record.name.startsWith('email:')) {
      return 'email';
    }
    return 'other';
  }

  function increment(bucket: Record<string, number>, key: string | null | undefined) {
    const normalized = key || 'none';
    bucket[normalized] = (bucket[normalized] ?? 0) + 1;
  }

  function previewOutboxBulkAction(
    action: AdminOutboxBulkPreview['action'],
    selected: { matched: number; records: RuntimeStoreOutboxRecord[] },
    limit: number
  ): AdminOutboxBulkPreview {
    const byStatus: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    const byModule: Record<string, number> = {};
    for (const record of selected.records) {
      increment(byStatus, record.status);
      increment(byKind, outboxKind(record));
      increment(byModule, record.moduleId);
    }
    const createdAt = selected.records.map((record) => record.createdAt).sort();
    return {
      action,
      matched: selected.matched,
      selected: selected.records.length,
      limit,
      impact: {
        byStatus,
        byKind,
        byModule,
        oldestCreatedAt: createdAt[0] ?? null,
        newestCreatedAt: createdAt[createdAt.length - 1] ?? null,
      },
      records: selected.records.map((record) => ({
        id: record.id,
        name: record.name,
        moduleId: record.moduleId,
        status: record.status,
        attempts: record.attempts,
        createdAt: record.createdAt,
        scheduledAt: record.scheduledAt,
      })),
    };
  }

  return {
    async snapshot(query: { productId?: string } = {}): Promise<AdminOperationsSnapshot> {
      const [
        runs,
        outbox,
        webhookReceipts,
        notifications,
        notificationDeliveries,
        auditLogs,
        usageRecords,
        catalogStates,
        memberships,
      ] = await Promise.all([
          store.listRuns({ productId: query.productId }),
          store.listOutbox({ productId: query.productId }),
          store.listWebhookReceipts({ productId: query.productId }),
          store.listNotifications({ productId: query.productId }),
          store.listNotificationDeliveries({ productId: query.productId }),
          store.listAudit({ productId: query.productId }),
          store.listUsage({ productId: query.productId }),
          store.listCatalogStates({ productId: query.productId }),
          store.listMemberships({ productId: query.productId }),
        ]);

      const modules = host.contracts.map((contract) => ({
        id: contract.id,
        name: contract.name,
        version: contract.version,
        permissions: contract.permissions,
      }));
      const routes = host.routes.map((route) => ({
        moduleId: route.moduleId,
        kind: route.kind,
        path: route.path,
        auth: route.auth,
      }));

      return {
        modules,
        routes,
        counts: {
          modules: modules.length,
          routes: routes.length,
          runs: runs.length,
          outbox: outbox.length,
          webhookReceipts: webhookReceipts.length,
          notifications: notifications.length,
          notificationDeliveries: notificationDeliveries.length,
          auditLogs: auditLogs.length,
          usageRecords: usageRecords.length,
          catalogStates: catalogStates.length,
          memberships: memberships.length,
        },
        recent: {
          runs: runs.slice(0, 10),
          outbox: outbox.slice(0, 10),
          webhookReceipts: webhookReceipts.slice(0, 10),
          notifications: notifications.slice(0, 10),
          notificationDeliveries: notificationDeliveries.slice(0, 10),
          auditLogs: auditLogs.slice(0, 10),
          usageRecords: usageRecords.slice(0, 10),
          catalogStates: catalogStates.slice(0, 10),
        },
      };
    },
    setModuleStatus,
    async enableModule(session: ModuleHostSession, productId: string, moduleId: string) {
      return setModuleStatus(session, productId, moduleId, 'enabled');
    },
    async disableModule(session: ModuleHostSession, productId: string, moduleId: string) {
      return setModuleStatus(session, productId, moduleId, 'disabled');
    },
    retryOutbox,
    discardOutbox,
    archiveOutbox,
    async previewBulkOutbox(
      session: ModuleHostSession,
      input: {
        action: AdminOutboxBulkPreview['action'];
        productId?: string;
        status?: RuntimeStoreOutboxStatus;
        namePrefix?: string;
        ids?: readonly string[];
        limit?: number;
      }
    ) {
      assertAdminSession(session);
      const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
      const selected = await findBulkOutboxCandidates({
        ...input,
        limit,
      });
      return previewOutboxBulkAction(input.action, selected, limit);
    },
    async bulkRetryOutbox(
      session: ModuleHostSession,
      input: {
        productId?: string;
        status?: RuntimeStoreOutboxStatus;
        namePrefix?: string;
        ids?: readonly string[];
        limit?: number;
        reason?: string;
      } = {}
    ) {
      assertAdminSession(session);
      const selected = await findBulkOutboxCandidates({
        ...input,
        status: input.status ?? 'dead_letter',
      });
      const records: RuntimeStoreOutboxRecord[] = [];
      for (const record of selected.records) {
        records.push(await retryOutbox(session, record.id, input.reason));
      }
      return {
        matched: selected.matched,
        processed: records.length,
        records,
      };
    },
    async bulkDiscardOutbox(
      session: ModuleHostSession,
      input: {
        productId?: string;
        status?: RuntimeStoreOutboxStatus;
        namePrefix?: string;
        ids?: readonly string[];
        limit?: number;
        reason?: string;
      } = {}
    ) {
      assertAdminSession(session);
      const selected = await findBulkOutboxCandidates({
        ...input,
        status: input.status ?? 'failed',
      });
      const records: RuntimeStoreOutboxRecord[] = [];
      for (const record of selected.records) {
        records.push(await discardOutbox(session, record.id, input.reason));
      }
      return {
        matched: selected.matched,
        processed: records.length,
        records,
      };
    },
    async bulkArchiveOutbox(
      session: ModuleHostSession,
      input: {
        productId?: string;
        status?: RuntimeStoreOutboxStatus;
        namePrefix?: string;
        ids?: readonly string[];
        limit?: number;
        reason?: string;
      } = {}
    ) {
      assertAdminSession(session);
      const selected = await findBulkOutboxCandidates({
        ...input,
        status: input.status ?? 'processed',
      });
      const records: RuntimeStoreOutboxRecord[] = [];
      for (const record of selected.records) {
        records.push(await archiveOutbox(session, record.id, input.reason));
      }
      return {
        matched: selected.matched,
        processed: records.length,
        records,
      };
    },
    async requeueRun(session: ModuleHostSession, id: string) {
      assertAdminSession(session);
      const previous = await store.getRun(id);
      if (!previous) {
        throw new Error(`ADMIN_RUN_NOT_FOUND: ${id}`);
      }
      if (previous.status !== 'failed' && previous.status !== 'canceled') {
        throw new Error(`ADMIN_RUN_REQUEUE_FORBIDDEN: ${previous.status}`);
      }
      const record = await store.updateRunStatus(id, 'queued', { progress: 0 });
      await store.appendRunLog(id, 'warn', 'Run requeued by admin.', {
        actorId: session.actorId ?? session.user?.id,
        previousStatus: previous.status,
      });
      await store.recordAudit({
        productId: record.productId ?? previous.productId ?? 'unknown',
        workspaceId: record.workspaceId ?? previous.workspaceId,
        moduleId: record.moduleId,
        actorId: session.actorId ?? session.user?.id,
        type: 'admin.run.requeued',
        metadata: { runId: record.id, previousStatus: previous.status },
      });
      return record;
    },
    async cancelRun(session: ModuleHostSession, id: string, reason = 'Canceled by admin') {
      assertAdminSession(session);
      const previous = await store.getRun(id);
      if (!previous) {
        throw new Error(`ADMIN_RUN_NOT_FOUND: ${id}`);
      }
      if (previous.status !== 'queued' && previous.status !== 'running') {
        throw new Error(`ADMIN_RUN_CANCEL_FORBIDDEN: ${previous.status}`);
      }
      const record = await store.updateRunStatus(id, 'cancel_requested', {
        error: { code: 'ADMIN_RUN_CANCEL_REQUESTED', message: reason },
      });
      await store.appendRunLog(id, 'warn', 'Run cancellation requested by admin.', {
        actorId: session.actorId ?? session.user?.id,
        reason,
        previousStatus: previous.status,
      });
      await store.recordAudit({
        productId: record.productId ?? previous.productId ?? 'unknown',
        workspaceId: record.workspaceId ?? previous.workspaceId,
        moduleId: record.moduleId,
        actorId: session.actorId ?? session.user?.id,
        type: 'admin.run.cancel_requested',
        metadata: { runId: record.id, previousStatus: previous.status, reason },
      });
      return record;
    },
  };
}
