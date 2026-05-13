import { randomUUID } from 'crypto';
import {
  Permission,
  PluginError,
  type PluginCreditBalance,
  type PluginCreditConsumeInput,
  type PluginCreditConsumeResult,
  type PluginCredits,
} from '@ploykit/plugin-sdk';
import { and, eq, gt, sql } from 'drizzle-orm';
import { usageHistory, userEntitlements, withSystemContext } from '@/lib/db';
import { invalidateUserEntitlementCache } from '@/lib/cache';
import {
  assertJsonSerializable,
  assertPluginNamespaced,
  enforceCapabilityPermission,
  type PluginCapabilityScope,
} from './guards.server';

const DEFAULT_CREDIT_METRIC = 'platform.apiCallsRemaining';
const DEFAULT_USAGE_UNIT = 'credit';

export interface PluginCreditsHostScope {
  pluginId: string;
  userId?: string;
  userRole?: 'admin' | 'user';
  requestId: string;
  system: boolean;
}

export interface PluginCreditsConsumeHostInput extends PluginCreditConsumeInput {
  userId: string;
  amount: number;
  idempotencyKey: string;
}

export interface PluginCreditsHost {
  getBalance(scope: PluginCreditsHostScope, metric: string): Promise<PluginCreditBalance>;
  consume(
    scope: PluginCreditsHostScope,
    input: PluginCreditsConsumeHostInput
  ): Promise<PluginCreditConsumeResult>;
}

export interface CreatePluginCreditsOptions {
  host?: Partial<PluginCreditsHost>;
  balanceMetric?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createInputError(label: string, details?: Record<string, unknown>): PluginError {
  return new PluginError({
    code: 'PLUGIN_CREDITS_INPUT_INVALID',
    message: `${label} is invalid.`,
    statusCode: 400,
    details,
  });
}

function readOptionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw createInputError(label, { label });
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length > maxLength) {
    throw createInputError(label, { label, maxLength });
  }

  return normalized;
}

function readAmount(value: unknown): number {
  if (value === undefined || value === null) {
    return 1;
  }

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw createInputError('Credit amount', { amount: value });
  }

  return value;
}

function assertMetadata(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw createInputError(label, { label });
  }

  assertJsonSerializable(value, label);
}

function readBalance(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : 0;
  }

  return 0;
}

function resolveTargetUserId(
  scope: PluginCapabilityScope,
  rawUserId: unknown,
  capability: string
): string {
  const requestedUserId = readOptionalString(rawUserId, 'Credit target user ID', 256);
  const targetUserId = requestedUserId ?? scope.user?.id;

  if (!targetUserId) {
    throw new PluginError({
      code: 'PLUGIN_CREDITS_USER_REQUIRED',
      message: `${capability} requires a target user.`,
      statusCode: 401,
      details: {
        pluginId: scope.contract.id,
        capability,
      },
    });
  }

  if (
    requestedUserId &&
    requestedUserId !== scope.user?.id &&
    !scope.system &&
    scope.user?.role !== 'admin'
  ) {
    throw new PluginError({
      code: 'PLUGIN_CREDITS_TARGET_FORBIDDEN',
      message: `${capability} cannot target another user from this context.`,
      statusCode: 403,
      details: {
        pluginId: scope.contract.id,
        capability,
        targetUserId,
      },
    });
  }

  return targetUserId;
}

function createHostScope(scope: PluginCapabilityScope): PluginCreditsHostScope {
  return {
    pluginId: scope.contract.id,
    userId: scope.user?.id,
    userRole: scope.user?.role,
    requestId: scope.requestId,
    system: Boolean(scope.system),
  };
}

export function createDefaultPluginCreditsHost(
  balanceMetric: string = DEFAULT_CREDIT_METRIC
): PluginCreditsHost {
  return {
    async getBalance(_scope, metric) {
      const requestedMetric = metric || balanceMetric;
      const userId = _scope.userId;

      if (!userId) {
        throw new PluginError({
          code: 'PLUGIN_CREDITS_USER_REQUIRED',
          message: 'ctx.credits.getBalance requires an authenticated user.',
          statusCode: 401,
          details: {
            pluginId: _scope.pluginId,
          },
        });
      }

      const entitlement = await withSystemContext(async (database) => {
        return database.query.userEntitlements.findFirst({
          where: and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active')),
          columns: {
            usageMetrics: true,
          },
        });
      });

      const metrics = isRecord(entitlement?.usageMetrics) ? entitlement.usageMetrics : {};
      return {
        balance: readBalance(metrics[requestedMetric]),
        metric: requestedMetric,
        userId,
      };
    },

    async consume(scope, input) {
      const metric = balanceMetric;
      const result = await withSystemContext(async (database) => {
        const metadata = {
          pluginId: scope.pluginId,
          requestId: scope.requestId,
          meter: input.meter,
          balanceMetric: metric,
          ...input.metadata,
        };

        const insertedUsage = await database
          .insert(usageHistory)
          .values({
            idempotencyKey: input.idempotencyKey,
            userId: input.userId,
            pluginId: scope.pluginId,
            metric: 'credit',
            value: input.amount,
            unit: DEFAULT_USAGE_UNIT,
            metadata,
            recordedAt: new Date(),
          })
          .onConflictDoNothing({ target: usageHistory.idempotencyKey })
          .returning();

        if (insertedUsage.length === 0) {
          const [existing] = await database
            .select({
              metadata: usageHistory.metadata,
              pluginId: usageHistory.pluginId,
              userId: usageHistory.userId,
              value: usageHistory.value,
            })
            .from(usageHistory)
            .where(eq(usageHistory.idempotencyKey, input.idempotencyKey))
            .limit(1);

          const existingMetadata = isRecord(existing?.metadata) ? existing.metadata : {};
          if (
            existing?.pluginId !== scope.pluginId ||
            existing?.userId !== input.userId ||
            existingMetadata.meter !== input.meter
          ) {
            throw new PluginError({
              code: 'PLUGIN_CREDITS_IDEMPOTENCY_CONFLICT',
              message: `Credit idempotency key "${input.idempotencyKey}" was already used for another credit operation.`,
              statusCode: 409,
              details: {
                pluginId: scope.pluginId,
                userId: input.userId,
                meter: input.meter,
              },
            });
          }

          const existingBalanceAfter = readBalance(existingMetadata.balanceAfter);
          const existingAmount = readBalance(existing?.value);

          return {
            idempotentReplay: true,
            balanceBefore: existingBalanceAfter + existingAmount,
            balanceAfter: existingBalanceAfter,
            usageMetadata: existingMetadata,
          };
        }

        const [updated] = await database
          .update(userEntitlements)
          .set({
            usageMetrics: sql`
              jsonb_set(
                jsonb_set(
                  jsonb_set(
                    COALESCE(${userEntitlements.usageMetrics}, '{}'::jsonb),
                    ${sql.raw(`'{${metric}}'`)},
                    to_jsonb(
                      (
                        COALESCE(
                          (${userEntitlements.usageMetrics}->>${metric})::int,
                          0
                        ) - ${input.amount}::int
                      )
                    )
                  ),
                  '{lastCreditConsumedAt}',
                  to_jsonb(${new Date().toISOString()}::text)
                ),
                '{lastCreditMeter}',
                to_jsonb(${input.meter}::text)
              )
            `,
            usageUpdatedAt: new Date(),
          })
          .where(
            and(
              eq(userEntitlements.userId, input.userId),
              eq(userEntitlements.status, 'active'),
              gt(
                sql<number>`COALESCE((${userEntitlements.usageMetrics}->>${metric})::int, 0)`,
                input.amount - 1
              )
            )
          )
          .returning();

        if (!updated) {
          await database
            .delete(usageHistory)
            .where(eq(usageHistory.idempotencyKey, input.idempotencyKey));
          return null;
        }

        const updatedMetrics = isRecord(updated.usageMetrics) ? updated.usageMetrics : {};
        const balanceAfter = readBalance(updatedMetrics[metric]);
        const balanceBefore = balanceAfter + input.amount;
        const finalMetadata = {
          ...metadata,
          balanceBefore,
          balanceAfter,
        };

        await database
          .update(usageHistory)
          .set({
            metadata: finalMetadata,
          })
          .where(eq(usageHistory.idempotencyKey, input.idempotencyKey));

        return {
          idempotentReplay: false,
          balanceBefore,
          balanceAfter,
          usageMetadata: finalMetadata,
        };
      });

      if (!result) {
        throw new PluginError({
          code: 'PLUGIN_CREDITS_INSUFFICIENT',
          message: `Not enough credits to consume ${input.amount} for "${input.meter}".`,
          statusCode: 402,
          details: {
            pluginId: scope.pluginId,
            userId: input.userId,
            meter: input.meter,
            amount: input.amount,
          },
        });
      }

      if (!result.idempotentReplay) {
        invalidateUserEntitlementCache(input.userId);
      }

      return {
        consumed: true,
        amount: input.amount,
        balanceBefore: result.balanceBefore,
        balanceAfter: result.balanceAfter,
        meter: input.meter,
        userId: input.userId,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      };
    },
  };
}

function resolveHost(
  host: Partial<PluginCreditsHost> | undefined,
  balanceMetric?: string
): PluginCreditsHost {
  return {
    ...createDefaultPluginCreditsHost(balanceMetric),
    ...host,
  };
}

export function createPluginCreditsCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginCreditsOptions = {}
): PluginCredits {
  const balanceMetric = options.balanceMetric ?? DEFAULT_CREDIT_METRIC;
  const host = resolveHost(options.host, balanceMetric);

  return {
    async getBalance(metric = balanceMetric) {
      enforceCapabilityPermission(scope, Permission.CreditsRead, 'ctx.credits.getBalance');
      const normalizedMetric =
        readOptionalString(metric, 'Credit balance metric', 120) ?? balanceMetric;

      if (normalizedMetric !== balanceMetric) {
        assertPluginNamespaced(scope, normalizedMetric, 'Credit balance metric');
      }

      return host.getBalance(createHostScope(scope), normalizedMetric);
    },

    async consume(input) {
      enforceCapabilityPermission(scope, Permission.CreditsConsume, 'ctx.credits.consume');

      if (!isRecord(input)) {
        throw createInputError('Credit consume input');
      }

      const meter = readOptionalString(input.meter, 'Credit meter', 120);
      if (!meter) {
        throw createInputError('Credit meter');
      }

      assertPluginNamespaced(scope, meter, 'Credit meter');

      const metadata = input.metadata;
      if (metadata !== undefined) {
        assertMetadata(metadata, 'Credit consume metadata');
      }

      const normalizedInput: PluginCreditsConsumeHostInput = {
        meter,
        amount: readAmount(input.amount),
        userId: resolveTargetUserId(scope, input.userId, 'ctx.credits.consume'),
        idempotencyKey:
          readOptionalString(input.idempotencyKey, 'Credit idempotency key', 160) ??
          `${scope.requestId}:credits:${meter}:${randomUUID()}`,
        metadata,
      };

      return host.consume(createHostScope(scope), normalizedInput);
    },
  };
}
