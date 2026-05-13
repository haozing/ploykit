import { randomUUID } from 'crypto';
import { Permission, type PluginUsage } from '@ploykit/plugin-sdk';
import {
  getUsageLedger,
  type UsageCategory,
  type UsageLedger,
} from '@/lib/usage/usage-ledger.server';
import {
  assertJsonSerializable,
  assertPluginNamespaced,
  enforceCapabilityPermission,
  requireUser,
  type PluginCapabilityScope,
} from './guards.server';

const metricCategoryMap: Array<[RegExp, UsageCategory]> = [
  [/storage/i, 'storage'],
  [/job/i, 'job_executions'],
  [/credit/i, 'credit'],
  [/bandwidth/i, 'bandwidth'],
  [/compute/i, 'compute_time'],
];

export interface CreatePluginUsageOptions {
  usageLedger?: UsageLedger;
}

function metricToCategory(metric: string): UsageCategory {
  return metricCategoryMap.find(([pattern]) => pattern.test(metric))?.[1] ?? 'api_quota';
}

export function createPluginUsageCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginUsageOptions = {}
): PluginUsage {
  const usageLedger = options.usageLedger ?? getUsageLedger();

  return {
    async increment(metric, amount = 1, incrementOptions = {}) {
      enforceCapabilityPermission(scope, Permission.UsageWrite, 'ctx.usage.increment');
      assertPluginNamespaced(scope, metric, 'Usage metric');
      assertJsonSerializable(incrementOptions.metadata ?? {}, 'Usage metadata');
      const user = requireUser(scope, 'ctx.usage.increment');
      const idempotencyKey =
        incrementOptions.idempotencyKey ?? `${scope.requestId}:usage:${metric}:${randomUUID()}`;

      await usageLedger.record({
        id: randomUUID(),
        idempotencyKey,
        userId: user.id,
        category: metricToCategory(metric),
        amount,
        unit: incrementOptions.unit ?? 'count',
        metadata: {
          pluginId: scope.contract.id,
          metric,
          requestId: scope.requestId,
          apiKeyId: scope.apiKey?.id,
          apiKeyScope: scope.apiKey?.scope,
          ...incrementOptions.metadata,
        },
        timestamp: new Date(),
      });
    },
  };
}
