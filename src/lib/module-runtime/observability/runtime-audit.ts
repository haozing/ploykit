import type { ModuleAuditApi, ModuleAuditRecordInput } from '@ploykit/module-sdk';
import { redactSensitive } from './redaction';

export interface RuntimeAuditRecord {
  id: string;
  at: string;
  moduleId?: string;
  type: string;
  metadata: Record<string, unknown>;
}

export interface RuntimeAuditLog extends ModuleAuditApi {
  list(query?: { moduleId?: string; type?: string }): RuntimeAuditRecord[];
}

export interface CreateInMemoryRuntimeAuditLogOptions {
  moduleId?: string;
  now?: () => Date;
}

export function createInMemoryRuntimeAuditLog(
  options: CreateInMemoryRuntimeAuditLogOptions = {}
): RuntimeAuditLog {
  const records: RuntimeAuditRecord[] = [];
  const now = options.now ?? (() => new Date());

  return {
    async record(typeOrInput, metadata = {}) {
      const normalized = normalizeAuditRecordInput(typeOrInput, metadata);
      records.push({
        id: `audit_${records.length + 1}`,
        at: now().toISOString(),
        moduleId: options.moduleId,
        type: normalized.type,
        metadata: redactSensitive(normalized.metadata),
      });
    },
    list(query = {}) {
      return records
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.type || record.type === query.type)
        .map((record) => ({ ...record, metadata: { ...record.metadata } }));
    },
  };
}

function normalizeAuditRecordInput(
  typeOrInput: string | ModuleAuditRecordInput,
  metadata: Record<string, unknown>
): { type: string; metadata: Record<string, unknown> } {
  if (typeof typeOrInput === 'string') {
    return { type: typeOrInput, metadata };
  }
  return {
    type: typeOrInput.action,
    metadata: {
      ...(typeOrInput.metadata ?? {}),
      actorKind: typeOrInput.actorKind,
      actorId: typeOrInput.actorId,
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
