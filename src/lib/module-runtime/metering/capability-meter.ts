import type { ModuleUsageApi, ModuleUsageRecord } from '@ploykit/module-sdk';

export type ModuleCapabilityMeterKind =
  | 'api.call'
  | 'action.call'
  | 'job.run'
  | 'data.read'
  | 'data.write'
  | 'egress.call'
  | 'ai.call';

export interface ModuleCapabilityMeter {
  record(input: {
    kind: ModuleCapabilityMeterKind;
    quantity?: number;
    idempotencyKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ModuleUsageRecord>;
}

export function createModuleCapabilityMeter(usage: ModuleUsageApi): ModuleCapabilityMeter {
  return {
    record(input) {
      return usage.record({
        meter: input.kind,
        quantity: input.quantity ?? 1,
        unit: 'count',
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      });
    },
  };
}
