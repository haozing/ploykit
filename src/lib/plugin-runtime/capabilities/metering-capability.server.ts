import { randomUUID } from 'crypto';
import {
  Permission,
  PluginError,
  type PluginMeterDefinition,
  type PluginMetering,
  type PluginMeteringActionInput,
  type PluginMeteringAdjustmentResult,
  type PluginMeteringAuthorizeResult,
  type PluginMeteringCommitResult,
  type PluginMeteringReconcileResult,
} from '@ploykit/plugin-sdk';
import {
  getUsageLedger,
  type UsageCategory,
  type UsageLedger,
} from '@/lib/usage/usage-ledger.server';
import { env } from '@/lib/_core/env';
import {
  assertJsonSerializable,
  assertPluginNamespaced,
  currentApiKeyId,
  enforceCapabilityPermission,
  normalizeResourceScope,
  requireUser,
  type PluginCapabilityScope,
} from './guards.server';
import {
  createDefaultPluginCreditsHost,
  type PluginCreditsHost,
  type PluginCreditsConsumeHostInput,
} from './credits-capability.server';

export interface CreatePluginMeteringOptions {
  usageLedger?: UsageLedger;
  creditsHost?: Partial<PluginCreditsHost>;
  balanceMetric?: string;
  entitlementHost?: {
    getLimitValue(userId: string, meter: string): Promise<number | null>;
  };
}

const meterCategoryMap: Array<[RegExp, UsageCategory]> = [
  [/storage|file/i, 'storage'],
  [/job|run|task/i, 'job_executions'],
  [/credit/i, 'credit'],
  [/bandwidth|byte|download|upload/i, 'bandwidth'],
  [/compute|minute|video|image|ocr|ai/i, 'compute_time'],
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readAmount(value: unknown): number {
  if (value === undefined || value === null) return 1;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new PluginError({
      code: 'PLUGIN_METERING_AMOUNT_INVALID',
      message: 'Metering amount must be a positive number.',
      statusCode: 400,
      details: { amount: value },
    });
  }
  return value;
}

function resolveMeter(scope: PluginCapabilityScope, meterId: string): PluginMeterDefinition {
  const normalized = meterId.trim();
  if (!normalized) {
    throw new PluginError({
      code: 'PLUGIN_METERING_METER_INVALID',
      message: 'Metering calls require a meter id.',
      statusCode: 400,
    });
  }

  assertPluginNamespaced(scope, normalized, 'Meter');
  const meter = scope.contract.meters.find((entry) => entry.id === normalized);
  if (!meter) {
    throw new PluginError({
      code: 'PLUGIN_METERING_METER_UNDECLARED',
      message: `Meter "${normalized}" is not declared by plugin "${scope.contract.id}".`,
      statusCode: 400,
      fix: 'Declare the meter in plugin.ts meters before using ctx.metering.',
      details: {
        pluginId: scope.contract.id,
        meter: normalized,
      },
    });
  }

  return meter;
}

function resolveIdempotencyKey(
  scope: PluginCapabilityScope,
  action: string,
  meter: string,
  inputKey?: string
): string {
  const key = inputKey?.trim();
  return key || `${scope.requestId}:metering:${action}:${meter}:${randomUUID()}`;
}

function meterToCategory(meter: PluginMeterDefinition): UsageCategory {
  return (
    meterCategoryMap.find(([pattern]) => pattern.test(`${meter.id}.${meter.unit}`))?.[1] ??
    'api_quota'
  );
}

function creditCost(meter: PluginMeterDefinition, amount: number): number {
  if (meter.billable === false) return 0;
  const unitCost = meter.defaultCreditCost ?? 0;
  return Math.ceil(unitCost * amount);
}

function resolveCreditsHost(
  host: Partial<PluginCreditsHost> | undefined,
  balanceMetric?: string
): PluginCreditsHost {
  return {
    ...createDefaultPluginCreditsHost(balanceMetric),
    ...host,
  };
}

function createCreditScope(scope: PluginCapabilityScope) {
  return {
    pluginId: scope.contract.id,
    userId: scope.user?.id,
    userRole: scope.user?.role,
    requestId: scope.requestId,
    system: Boolean(scope.system),
  };
}

function createCreditInput(
  userId: string,
  meter: string,
  amount: number,
  idempotencyKey: string,
  metadata: Record<string, unknown> | undefined
): PluginCreditsConsumeHostInput {
  return {
    meter,
    amount,
    userId,
    idempotencyKey,
    metadata,
  };
}

function resolveUserId(scope: PluginCapabilityScope, input: PluginMeteringActionInput): string {
  if (input.scope) {
    normalizeResourceScope(scope, input.scope, 'ctx.metering');
  }
  return requireUser(scope, 'ctx.metering').id;
}

function prepare(
  scope: PluginCapabilityScope,
  input: PluginMeteringActionInput,
  action: string
): {
  meter: PluginMeterDefinition;
  meterId: string;
  amount: number;
  userId: string;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  apiKeyId?: string;
} {
  if (!isRecord(input)) {
    throw new PluginError({
      code: 'PLUGIN_METERING_INPUT_INVALID',
      message: 'Metering input must be an object.',
      statusCode: 400,
    });
  }

  const meter = resolveMeter(scope, input.meter);
  const amount = readAmount(input.amount);
  const metadata = input.metadata;
  if (metadata !== undefined) {
    if (!isRecord(metadata)) {
      throw new PluginError({
        code: 'PLUGIN_METERING_METADATA_INVALID',
        message: 'Metering metadata must be an object.',
        statusCode: 400,
      });
    }
    assertJsonSerializable(metadata, 'Metering metadata');
  }

  const apiKeyId = resolveApiKeyId(scope, input.apiKeyId);

  return {
    meter,
    meterId: meter.id,
    amount,
    userId: resolveUserId(scope, input),
    idempotencyKey: resolveIdempotencyKey(scope, action, meter.id, input.idempotencyKey),
    metadata,
    apiKeyId,
  };
}

function resolveApiKeyId(
  scope: PluginCapabilityScope,
  requestedApiKeyId?: string
): string | undefined {
  const runtimeApiKeyId = currentApiKeyId(scope);
  const normalized = requestedApiKeyId?.trim();

  if (runtimeApiKeyId && normalized && normalized !== runtimeApiKeyId) {
    throw new PluginError({
      code: 'PLUGIN_METERING_API_KEY_FORBIDDEN',
      message: 'Metering input cannot spoof another API key id.',
      statusCode: 403,
      details: {
        pluginId: scope.contract.id,
        runtimeApiKeyId,
        requestedApiKeyId: normalized,
      },
    });
  }

  return runtimeApiKeyId ?? normalized;
}

async function enforceCreditBalance(
  scope: PluginCapabilityScope,
  creditsHost: PluginCreditsHost,
  balanceMetric: string,
  userId: string,
  meter: string,
  cost: number
): Promise<void> {
  if (cost <= 0) {
    return;
  }

  const balance = await creditsHost.getBalance(createCreditScope(scope), balanceMetric);
  if (balance.unlimited || balance.balance >= cost) {
    return;
  }

  throw new PluginError({
    code: 'PLUGIN_METERING_CREDITS_INSUFFICIENT',
    message: `Not enough credits to authorize "${meter}".`,
    statusCode: 402,
    details: {
      pluginId: scope.contract.id,
      userId,
      meter,
      requiredCredits: cost,
      balance: balance.balance,
      metric: balance.metric,
    },
  });
}

async function enforcePlanMeterLimit(
  scope: PluginCapabilityScope,
  usageLedger: UsageLedger,
  prepared: ReturnType<typeof prepare>,
  entitlementHost?: CreatePluginMeteringOptions['entitlementHost']
): Promise<void> {
  if (!entitlementHost && env.NODE_ENV === 'test') {
    return;
  }

  const limit = entitlementHost
    ? await entitlementHost.getLimitValue(prepared.userId, prepared.meterId)
    : await (async () => {
        const { getLimitValue } = await import('@/lib/services/user/user-entitlement-service');
        return getLimitValue(prepared.userId, prepared.meterId);
      })();
  if (limit === null || limit === -1) {
    return;
  }

  const records = await usageLedger.query({ userId: prepared.userId, limit: 1000 });
  const used = records
    .filter((record) => record.metadata?.pluginId === scope.contract.id)
    .filter((record) => record.metadata?.meter === prepared.meterId)
    .reduce((sum, record) => sum + record.amount, 0);

  if (used + prepared.amount <= limit) {
    return;
  }

  throw new PluginError({
    code: 'PLUGIN_METERING_LIMIT_EXCEEDED',
    message: `Meter "${prepared.meterId}" exceeds the current plan limit.`,
    statusCode: 402,
    details: {
      pluginId: scope.contract.id,
      userId: prepared.userId,
      meter: prepared.meterId,
      used,
      requested: prepared.amount,
      limit,
    },
  });
}

function authorizeResult(
  prepared: ReturnType<typeof prepare>,
  cost: number
): PluginMeteringAuthorizeResult {
  return {
    authorized: true,
    meter: prepared.meterId,
    amount: prepared.amount,
    unit: prepared.meter.unit,
    billable: prepared.meter.billable !== false,
    creditCost: cost,
    userId: prepared.userId,
    idempotencyKey: prepared.idempotencyKey,
  };
}

export function createPluginMeteringCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginMeteringOptions = {}
): PluginMetering {
  const usageLedger = options.usageLedger ?? getUsageLedger();
  const creditsHost = resolveCreditsHost(options.creditsHost, options.balanceMetric);

  return {
    async authorize(input) {
      enforceCapabilityPermission(scope, Permission.MeteringWrite, 'ctx.metering.authorize');
      const prepared = prepare(scope, input, 'authorize');
      const cost = creditCost(prepared.meter, prepared.amount);
      await enforcePlanMeterLimit(scope, usageLedger, prepared, options.entitlementHost);
      await enforceCreditBalance(
        scope,
        creditsHost,
        options.balanceMetric ?? 'platform.apiCallsRemaining',
        prepared.userId,
        prepared.meterId,
        cost
      );
      return authorizeResult(prepared, cost);
    },

    async commit(input) {
      enforceCapabilityPermission(scope, Permission.MeteringWrite, 'ctx.metering.commit');
      const prepared = prepare(scope, input, 'commit');
      const cost = creditCost(prepared.meter, prepared.amount);
      await enforcePlanMeterLimit(scope, usageLedger, prepared, options.entitlementHost);
      await enforceCreditBalance(
        scope,
        creditsHost,
        options.balanceMetric ?? 'platform.apiCallsRemaining',
        prepared.userId,
        prepared.meterId,
        cost
      );
      const usageId = randomUUID();
      await usageLedger.record({
        id: usageId,
        idempotencyKey: `${prepared.idempotencyKey}:usage`,
        userId: prepared.userId,
        category: meterToCategory(prepared.meter),
        amount: prepared.amount,
        unit: prepared.meter.unit,
        metadata: {
          pluginId: scope.contract.id,
          meter: prepared.meterId,
          runId: input.runId,
          apiKeyId: prepared.apiKeyId,
          connectorCallId: input.connectorCallId,
          ...prepared.metadata,
        },
        timestamp: new Date(),
      });

      const credits =
        cost > 0
          ? await creditsHost.consume(
              createCreditScope(scope),
              createCreditInput(
                prepared.userId,
                prepared.meterId,
                cost,
                `${prepared.idempotencyKey}:credits`,
                {
                  runId: input.runId,
                  apiKeyId: prepared.apiKeyId,
                  connectorCallId: input.connectorCallId,
                  ...prepared.metadata,
                }
              )
            )
          : undefined;

      return {
        ...authorizeResult(prepared, cost),
        usageId,
        credits,
      } satisfies PluginMeteringCommitResult;
    },

    async refund(input) {
      enforceCapabilityPermission(scope, Permission.MeteringWrite, 'ctx.metering.refund');
      const prepared = prepare(scope, input, 'refund');
      await usageLedger.record({
        id: randomUUID(),
        idempotencyKey: `${prepared.idempotencyKey}:usage`,
        userId: prepared.userId,
        category: 'credit',
        amount: -prepared.amount,
        unit: prepared.meter.unit,
        metadata: {
          pluginId: scope.contract.id,
          meter: prepared.meterId,
          adjustment: 'refund',
          apiKeyId: prepared.apiKeyId,
          ...prepared.metadata,
        },
        timestamp: new Date(),
      });
      return adjustmentResult(prepared);
    },

    async void(input) {
      enforceCapabilityPermission(scope, Permission.MeteringWrite, 'ctx.metering.void');
      const prepared = prepare(scope, input, 'void');
      await usageLedger.record({
        id: randomUUID(),
        idempotencyKey: `${prepared.idempotencyKey}:usage`,
        userId: prepared.userId,
        category: meterToCategory(prepared.meter),
        amount: -prepared.amount,
        unit: prepared.meter.unit,
        metadata: {
          pluginId: scope.contract.id,
          meter: prepared.meterId,
          adjustment: 'void',
          apiKeyId: prepared.apiKeyId,
          ...prepared.metadata,
        },
        timestamp: new Date(),
      });
      return adjustmentResult(prepared);
    },

    async reconcile(input = {}) {
      enforceCapabilityPermission(scope, Permission.MeteringWrite, 'ctx.metering.reconcile');
      const userId = input.userId ?? requireUser(scope, 'ctx.metering.reconcile').id;
      const meter = input.meter ? resolveMeter(scope, input.meter) : undefined;
      const records = await usageLedger.query({ userId, limit: 1000 });
      const relevant = meter
        ? records.filter((record) => record.metadata?.meter === meter.id)
        : records.filter((record) => record.metadata?.pluginId === scope.contract.id);
      return {
        meter: meter?.id,
        userId,
        usageAmount: relevant.reduce((sum, record) => sum + record.amount, 0),
        unit: meter?.unit,
      } satisfies PluginMeteringReconcileResult;
    },
  };
}

function adjustmentResult(prepared: ReturnType<typeof prepare>): PluginMeteringAdjustmentResult {
  return {
    adjusted: true,
    meter: prepared.meterId,
    amount: prepared.amount,
    unit: prepared.meter.unit,
    userId: prepared.userId,
    idempotencyKey: prepared.idempotencyKey,
  };
}
