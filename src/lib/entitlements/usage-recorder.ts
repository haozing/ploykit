import 'server-only';
import { db } from '@/lib/db';
import { userEntitlements, usageHistory } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RecordUsageOptions, RecordUsageResult, ResetUsageOptions } from './types';
import { logger } from '@/lib/_core/logger';
import { ValidationError, NotFoundError, DatabaseError } from '@/lib/_core/errors';

/**
 * Metric name validation pattern
 *
 * Metric names must use a dot-scoped namespace:
 * - Start each segment with a letter (a-z, A-Z)
 * - Contain only letters, numbers, hyphens, and underscores
 * - Include at least two segments, e.g. `plugin.metric`
 * - Be at most 120 characters long
 *
 * Examples of valid metric names:
 * - platform.apiCalls
 * - platform.storageBytes
 * - runlynk.jobExecutionsPerMonth
 * - seo-plus.auditRuns
 */
// Dot-separated segments, starts with letter, allows hyphen/underscore, max 120 chars total.
const SCOPED_METRIC_NAME_PATTERN =
  /^[a-zA-Z][a-zA-Z0-9_-]{0,63}(?:\.[a-zA-Z][a-zA-Z0-9_-]{0,63})+$/;
const METRIC_NAME_MAX_LENGTH = 120;

/**
 * Validates that a metric name follows the required format.
 *
 * This is a generic validation that allows any scoped metric name as long as it
 * follows the naming convention. This keeps framework metrics and plugin
 * metrics in one clean namespace without accepting old unscoped aliases.
 *
 * @param metric - The metric name to validate
 * @throws ValidationError if the metric name is invalid
 *
 * @example
 * validateMetric('platform.apiCalls');       // Valid
 * validateMetric('seo-plus.auditRuns');      // Valid
 * validateMetric('apiCalls');                // Throws - missing namespace
 * validateMetric('123invalid');              // Throws - starts with number
 * validateMetric('');                        // Throws - empty string
 */
function validateMetric(metric: string): void {
  if (!metric || typeof metric !== 'string') {
    throw new ValidationError('Metric name is required and must be a string', {
      metric,
    });
  }

  if (metric.length > METRIC_NAME_MAX_LENGTH) {
    throw new ValidationError(`Invalid metric name: "${metric}". Metric name is too long`, {
      metric,
    });
  }

  const isValid = SCOPED_METRIC_NAME_PATTERN.test(metric);

  if (!isValid) {
    logger.error({ metric }, 'Invalid metric name format');
    throw new ValidationError(
      `Invalid metric name: "${metric}". Use "${'${pluginId}'}.metric_name" format (max 120 chars)`,
      { metric }
    );
  }
}

// Usage Record API

/**
 * Record usage for a specific metric
 *
 * @param options - Record options
 *
 * @example
 * ```typescript
 * await recordUsage({
 *   userId: 'uuid',
 *   entitlementId: 'uuid',
 *   metric: 'platform.apiCalls',
 *   delta: 1
 * })
 * ```
 *
 * @example
 * ```typescript
 * await recordUsage({
 *   userId: 'uuid',
 *   entitlementId: 'uuid',
 *   metric: 'runlynk.channels',
 *   delta: 1,
 *   metadata: { pluginId: 'my-plugin' }
 * })
 * ```
 */
export async function recordUsage(options: RecordUsageOptions): Promise<RecordUsageResult> {
  const { userId, entitlementId, metric, delta, metadata } = options;

  validateMetric(metric);

  // 1. Get user entitlement
  const entitlement = await db.query.userEntitlements.findFirst({
    where: and(eq(userEntitlements.userId, userId), eq(userEntitlements.id, entitlementId)),
  });

  if (!entitlement) {
    logger.error({ userId, entitlementId }, 'Entitlement not found');
    throw new NotFoundError('Entitlement', entitlementId);
  }

  const currentMetrics = (entitlement.usageMetrics as Record<string, unknown>) || {};

  const currentValue = typeof currentMetrics[metric] === 'number' ? currentMetrics[metric] : 0;
  const newValue = currentValue + delta;
  currentMetrics[metric] = newValue;

  currentMetrics.lastUsedAt = new Date().toISOString();

  if (metadata) {
    currentMetrics[`${metric}_metadata`] = metadata;
  }

  try {
    await db.transaction(async (tx) => {
      // Update usageMetrics
      await tx
        .update(userEntitlements)
        .set({
          usageMetrics: currentMetrics,
          usageUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(userEntitlements.id, entitlementId));

      // Record to history if pluginId is provided
      if (metadata?.pluginId) {
        await tx.insert(usageHistory).values({
          idempotencyKey: `${entitlementId}:${metadata.pluginId as string}:${metric}:${Date.now()}:${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          userId,
          pluginId: metadata.pluginId as string,
          metric,
          value: newValue,
          unit: 'count',
          metadata,
          recordedAt: new Date(),
        });
      }
    });

    logger.info(
      {
        userId,
        entitlementId,
        metric,
        delta,
        previousValue: currentValue,
        newValue,
        timestamp: new Date().toISOString(),
      },
      'Usage recorded'
    );

    return {
      success: true,
      newValue,
      metric,
    };
  } catch (error) {
    logger.error(
      {
        userId,
        entitlementId,
        metric,
        delta,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to record usage'
    );

    throw new DatabaseError('Failed to record usage', {
      userId,
      entitlementId,
      metric,
      operation: 'recordUsage',
    });
  }
}

/**
 * Reset usage metric for all users or specific plan
 *
 * @param options - Reset options
 *
 * @example
 * ```typescript
 * // Reset all users
 * await resetUsage({
 *   metric: 'platform.apiCalls',
 *   value: 0
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Reset for specific plan
 * await resetUsage({
 *   metric: 'runlynk.channels',
 *   value: 0,
 *   planId: 'plan-uuid'
 * })
 * ```
 */
export async function resetUsage(options: ResetUsageOptions): Promise<void> {
  const { metric, value = 0, planId } = options;

  validateMetric(metric);

  try {
    await db.transaction(async (tx) => {
      // Build where condition
      const whereConditions = planId
        ? and(eq(userEntitlements.planId, planId), eq(userEntitlements.status, 'active'))
        : eq(userEntitlements.status, 'active');

      // Fetch all affected entitlements
      const entitlements = await tx
        .select({ id: userEntitlements.id, usageMetrics: userEntitlements.usageMetrics })
        .from(userEntitlements)
        .where(whereConditions);

      // Update each entitlement safely (no sql.raw)
      let affectedCount = 0;
      for (const entitlement of entitlements) {
        const currentMetrics = (entitlement.usageMetrics as Record<string, unknown>) || {};
        const updatedMetrics = {
          ...currentMetrics,
          [metric]: value,
          lastResetAt: new Date().toISOString(),
        };

        await tx
          .update(userEntitlements)
          .set({
            usageMetrics: updatedMetrics,
            updatedAt: new Date(),
          })
          .where(eq(userEntitlements.id, entitlement.id));

        affectedCount++;
      }

      logger.info(
        {
          metric,
          value,
          planId: planId || 'all',
          affectedRecords: affectedCount,
          timestamp: new Date().toISOString(),
        },
        'Usage reset completed'
      );
    });
  } catch (error) {
    logger.error(
      {
        metric,
        value,
        planId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to reset usage'
    );

    throw new DatabaseError('Failed to reset usage', {
      metric,
      planId,
      operation: 'resetUsage',
    });
  }
}
