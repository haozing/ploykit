import { redactSensitive } from '../observability';

export interface ModuleConnectorCallRecord {
  id: string;
  moduleId: string;
  connector: string;
  operation: string;
  status: 'succeeded' | 'failed';
  durationMs: number;
  request: unknown;
  response?: unknown;
  error?: string;
  createdAt: string;
}

export interface ModuleConnectorOperations {
  record(input: Omit<ModuleConnectorCallRecord, 'id' | 'createdAt'>): ModuleConnectorCallRecord;
  list(query?: { moduleId?: string; connector?: string }): ModuleConnectorCallRecord[];
}

export function createInMemoryModuleConnectorOperations(
  now: () => Date = () => new Date()
): ModuleConnectorOperations {
  const records: ModuleConnectorCallRecord[] = [];

  return {
    record(input) {
      const record: ModuleConnectorCallRecord = {
        ...input,
        id: `connector_call_${records.length + 1}`,
        request: redactSensitive(input.request),
        response: input.response ? redactSensitive(input.response) : undefined,
        createdAt: now().toISOString(),
      };
      records.push(record);
      return { ...record };
    },
    list(query = {}) {
      return records
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.connector || record.connector === query.connector)
        .map((record) => ({ ...record }));
    },
  };
}
