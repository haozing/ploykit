import type { ModuleAuditApi } from '@ploykit/module-sdk';
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
    async record(type, metadata = {}) {
      records.push({
        id: `audit_${records.length + 1}`,
        at: now().toISOString(),
        moduleId: options.moduleId,
        type,
        metadata: redactSensitive(metadata),
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
