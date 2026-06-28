import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type { RuntimeStore } from '@/lib/module-runtime/stores/runtime-store-types';
import type { ModuleAuditApi, ModuleAuditRecordInput } from '@ploykit/module-sdk';
import { DEFAULT_HOST_PRODUCT_ID } from '../default-scope';

export type HostModuleAuditWriter = (record: {
  moduleId: string;
  type: string;
  actorId?: string;
  metadata?: Record<string, unknown>;
}) => Promise<void>;

export function createHostAuditWriter(input: {
  store: RuntimeStore;
  hostSession: ModuleHostSession;
}): HostModuleAuditWriter {
  return async (record) => {
    await input.store.recordAudit({
      productId: input.hostSession.productId ?? DEFAULT_HOST_PRODUCT_ID,
      workspaceId: input.hostSession.workspaceId ?? null,
      moduleId: record.moduleId,
      actorId:
        record.actorId ??
        input.hostSession.actorId ??
        input.hostSession.userId ??
        input.hostSession.user?.id,
      type: record.type,
      metadata: record.metadata,
    });
  };
}

export function normalizeModuleAuditInput(
  typeOrInput: string | ModuleAuditRecordInput,
  metadata?: Record<string, unknown>
): { type: string; actorId?: string; metadata?: Record<string, unknown> } {
  if (typeof typeOrInput === 'string') {
    return { type: typeOrInput, metadata };
  }
  return {
    type: typeOrInput.action,
    actorId: typeOrInput.actorId,
    metadata: {
      ...(typeOrInput.metadata ?? {}),
      actorKind: typeOrInput.actorKind,
      action: typeOrInput.action,
      category: typeOrInput.category,
      targetKind: typeOrInput.targetKind,
      targetId: typeOrInput.targetId,
      decision: typeOrInput.decision,
      reasonCode: typeOrInput.reasonCode,
      requestId: typeOrInput.requestId,
      traceId: typeOrInput.traceId,
      beforeHash: typeOrInput.beforeHash,
      afterHash: typeOrInput.afterHash,
      sync: typeOrInput.sync,
    },
  };
}

export function createHostModuleAuditApi(input: {
  moduleId: string;
  writeAudit: HostModuleAuditWriter;
}): ModuleAuditApi {
  return {
    async record(typeOrInput, metadata) {
      const normalized = normalizeModuleAuditInput(typeOrInput, metadata);
      await input.writeAudit({
        moduleId: input.moduleId,
        type: normalized.type,
        actorId: normalized.actorId,
        metadata: normalized.metadata,
      });
    },
  };
}
