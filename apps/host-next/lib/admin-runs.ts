import { createAdminOperationsCenter } from '@/lib/module-runtime/admin/admin-operations';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type { ModuleArtifactRecord } from '@ploykit/module-sdk';
import type { ModuleRunRecord } from '@/lib/module-runtime/runs/run-runtime';
import type {
  RuntimeStoreAuditRecord,
  RuntimeStoreDeliveryRecord,
  RuntimeStoreFileRecord,
  RuntimeStoreOutboxRecord,
  RuntimeStoreUsageRecord,
} from '@/lib/module-runtime/stores/runtime-store-types';
import { ensureAdminStoreSeeded } from './admin-store-seed';
import { getHostRuntime } from './create-host';
import { DEFAULT_HOST_PRODUCT_ID } from './default-scope';
import { listHostWorkerArtifactsForRun } from './worker';

const DEMO_PRODUCT_ID = DEFAULT_HOST_PRODUCT_ID;

export interface AdminRunDetailView {
  run: ModuleRunRecord | null;
  outbox: RuntimeStoreOutboxRecord[];
  deliveries: RuntimeStoreDeliveryRecord[];
  usage: RuntimeStoreUsageRecord[];
  files: RuntimeStoreFileRecord[];
  artifacts: ModuleArtifactRecord[];
  audit: RuntimeStoreAuditRecord[];
}

async function getAdminOperationsCenter() {
  const hostRuntime = await getHostRuntime();
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    hostRuntime.moduleHost.runtime.contracts.map((contract) => contract.id)
  );

  return createAdminOperationsCenter({
    host: hostRuntime.moduleHost.runtime,
    store: hostRuntime.runtimeStore.store,
  });
}

function valueHasRunId(value: unknown, runId: string): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.runId === runId || record.correlationId === runId || record.causationId === runId;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function outboxRunId(record: RuntimeStoreOutboxRecord): string | undefined {
  return stringMetadata(metadataRecord(record.payload).runId);
}

function uniqueById<TRecord extends { id: string }>(records: readonly TRecord[]): TRecord[] {
  const seen = new Set<string>();
  const unique: TRecord[] = [];
  for (const record of records) {
    if (seen.has(record.id)) {
      continue;
    }
    seen.add(record.id);
    unique.push(record);
  }
  return unique;
}

export async function requeueAdminRun(session: ModuleHostSession, runId: string) {
  const admin = await getAdminOperationsCenter();
  return admin.requeueRun(session, runId);
}

export async function cancelAdminRun(session: ModuleHostSession, runId: string, reason?: string) {
  const admin = await getAdminOperationsCenter();
  return admin.cancelRun(session, runId, reason);
}

export async function getAdminRunDetail(runId: string): Promise<AdminRunDetailView> {
  const hostRuntime = await getHostRuntime();
  await ensureAdminStoreSeeded(
    hostRuntime.runtimeStore.store,
    hostRuntime.moduleHost.runtime.contracts.map((contract) => contract.id)
  );
  const run = await hostRuntime.runtimeStore.store.getRun(runId);
  if (!run) {
    return {
      run: null,
      outbox: [],
      deliveries: [],
      usage: [],
      files: [],
      artifacts: [],
      audit: [],
    };
  }

  const productId = run.productId ?? DEMO_PRODUCT_ID;
  const [outbox, usage, files, artifacts, audit] = await Promise.all([
    hostRuntime.runtimeStore.store.listOutbox({
      productId,
    }),
    hostRuntime.runtimeStore.store.listUsage({
      productId,
      moduleId: run.moduleId,
    }),
    hostRuntime.runtimeStore.store.listFiles({
      productId,
      moduleId: run.moduleId,
      runId: run.id,
      includeDeleted: true,
    }),
    listHostWorkerArtifactsForRun({
      moduleId: run.moduleId,
      runId: run.id,
    }),
    hostRuntime.runtimeStore.store.listAudit({
      productId,
      moduleId: run.moduleId,
    }),
  ]);

  const relatedOutbox = outbox.filter(
    (record) =>
      record.moduleId === run.moduleId &&
      (record.name === run.name ||
        record.name.endsWith(`:${run.name}`) ||
        valueHasRunId(record.payload, run.id) ||
        valueHasRunId(record.metadata, run.id) ||
        outboxRunId(record) === run.id)
  );
  const deliveryGroups = await Promise.all([
    hostRuntime.runtimeStore.store.listDeliveries({
      productId,
      runId: run.id,
    }),
    ...relatedOutbox.map((record) =>
      hostRuntime.runtimeStore.store.listDeliveries({
        productId,
        outboxId: record.id,
      })
    ),
  ]);
  const relatedDeliveries = uniqueById(deliveryGroups.flat());
  const relatedUsage = usage.filter(
    (record) =>
      valueHasRunId(record.metadata, run.id) ||
      (Boolean(run.idempotencyKey) && record.idempotencyKey === run.idempotencyKey)
  );
  const relatedAudit = audit.filter(
    (record) =>
      valueHasRunId(record.metadata, run.id) ||
      (record.type.startsWith('admin.run.') && record.metadata.runId === run.id)
  );

  return {
    run,
    outbox: relatedOutbox,
    deliveries: relatedDeliveries,
    usage: relatedUsage,
    files,
    artifacts,
    audit: relatedAudit,
  };
}
