/**
 * user Entitlement Service
 *
 * Manages user subscriptions, entitlements, and usage tracking
 *
 * Core responsibilities:
 * - Create and manage user subscriptions
 * - Check entitlement permissions
 * - Track usage metrics (API calls, storage, hooks, etc.)
 * - Handle subscription lifecycle (activate, cancel, expire)
 */

import { db, withSystemContext } from '@/lib/db';
import {
  userEntitlements,
  entitlementPlans,
  type UserEntitlement,
  type NewUserEntitlement,
} from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { NotFoundError, ValidationError } from '@/lib/_core/errors';
import { CACHE_TTL } from '@/lib/_core/constants';
import { userEntitlementCache, CACHE_KEYS, invalidateUserEntitlementCache } from '@/lib/cache';
import { auditLogDurable } from '../audit/audit-service';
import { logger } from '@/lib/_core/logger';

export type EntitlementFeatureValue = boolean | string | number | Record<string, unknown> | null;
export type EntitlementLimitInterval = 'monthly' | 'yearly';

const SCOPED_ENTITLEMENT_KEY_PATTERN =
  /^[a-zA-Z][a-zA-Z0-9_-]{0,63}(?:\.[a-zA-Z][a-zA-Z0-9_-]{0,63})+$/;
const ENTITLEMENT_KEY_MAX_LENGTH = 120;

function validateEntitlementKey(key: string, kind: 'feature' | 'limit' | 'metric'): void {
  if (!key || typeof key !== 'string') {
    throw new ValidationError(`${kind} key is required and must be a string`, { key });
  }

  if (key.length > ENTITLEMENT_KEY_MAX_LENGTH) {
    throw new ValidationError(`Invalid ${kind} key: "${key}". Key is too long`, { key });
  }

  const isValid = SCOPED_ENTITLEMENT_KEY_PATTERN.test(key);

  if (!isValid) {
    throw new ValidationError(
      `Invalid ${kind} key: "${key}". Use "${'${pluginId}'}.keyName" format`,
      { key }
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeLimitInterval(interval?: string | null): EntitlementLimitInterval | undefined {
  return interval === 'monthly' || interval === 'yearly' ? interval : undefined;
}

function findNumericLimit(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = toFiniteNumber(record[key]);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function mergeNumericLimits(target: Record<string, number>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    if (key === 'monthly' || key === 'yearly') {
      continue;
    }

    const numericValue = toFiniteNumber(value);
    if (numericValue !== null) {
      target[key] = numericValue;
    }
  }
}

export function readPlanFeatureValue(featuresInput: unknown, key: string): EntitlementFeatureValue {
  validateEntitlementKey(key, 'feature');

  const features = asRecord(featuresInput);
  const value = features[key];

  if (
    value === null ||
    value === undefined ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    return value ?? null;
  }

  return asRecord(value);
}

export function readPlanLimitValue(
  limitsInput: unknown,
  key: string,
  interval?: string | null
): number | null {
  validateEntitlementKey(key, 'limit');

  const limits = asRecord(limitsInput);
  const keys = [key];
  const preferredInterval = normalizeLimitInterval(interval);
  const intervalOrder: EntitlementLimitInterval[] =
    preferredInterval === 'yearly' ? ['yearly', 'monthly'] : ['monthly', 'yearly'];

  if (preferredInterval) {
    const intervalLimits = asRecord(limits[preferredInterval]);
    const intervalValue = findNumericLimit(intervalLimits, keys);
    if (intervalValue !== null) {
      return intervalValue;
    }
  }

  for (const intervalKey of intervalOrder) {
    if (intervalKey === preferredInterval) {
      continue;
    }

    const intervalLimits = asRecord(limits[intervalKey]);
    const intervalValue = findNumericLimit(intervalLimits, keys);
    if (intervalValue !== null) {
      return intervalValue;
    }
  }

  return null;
}

export function readEffectivePlanLimits(
  limitsInput: unknown,
  interval?: string | null
): Record<string, number> {
  const limits = asRecord(limitsInput);
  const preferredInterval = normalizeLimitInterval(interval);
  const fallbackInterval: EntitlementLimitInterval =
    preferredInterval === 'yearly' ? 'monthly' : 'yearly';
  const result: Record<string, number> = {};

  mergeNumericLimits(result, asRecord(limits[fallbackInterval]));

  if (preferredInterval) {
    mergeNumericLimits(result, asRecord(limits[preferredInterval]));
  } else {
    mergeNumericLimits(result, asRecord(limits.monthly));
  }

  return result;
}

function deriveUsageMetricKey(limitKey: string): string {
  return limitKey;
}

function validateFiniteUsageNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${label} must be a finite number`, { value });
  }
}

// ?// Query Functions
// ?
/**
 * Get user's active entitlement
 *
 *
 * @param userId - user ID
 * @returns Active entitlement with plan details, or null if none
 */
// Marker for cached null results to distinguish from cache miss
const CACHED_NULL = { __cachedNull__: true } as const;
const NULL_ENTITLEMENT_CACHE_TTL_MS = Math.min(60, CACHE_TTL.USER_ENTITLEMENT_SECONDS) * 1000;

export async function getUserEntitlement(
  userId: string
): Promise<(UserEntitlement & { plan: typeof entitlementPlans.$inferSelect }) | null> {
  // Check cache
  const cacheKey = CACHE_KEYS.user.entitlement(userId);
  const cached = userEntitlementCache.get(cacheKey);

  if (cached !== undefined) {
    // Check if this is a cached null result
    if ('__cachedNull__' in cached) {
      return null;
    }
    // Type assertion is safe here because we control what we cache
    return cached as UserEntitlement & { plan: typeof entitlementPlans.$inferSelect };
  }

  // Query database
  const entitlement = await db.query.userEntitlements.findFirst({
    where: and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active')),
    with: {
      plan: true,
    },
  });

  // Write to cache (including null results to avoid repeated queries)
  if (entitlement) {
    userEntitlementCache.set(cacheKey, entitlement as unknown as Record<string, unknown>);
  } else {
    // Cache null result to prevent cache penetration
    userEntitlementCache.set(
      cacheKey,
      CACHED_NULL as unknown as Record<string, unknown>,
      NULL_ENTITLEMENT_CACHE_TTL_MS
    );
  }

  return entitlement || null;
}

/**
 * Get user's entitlement plan details
 *
 * @param userId - user ID
 * @returns Entitlement plan or null
 */
export async function getUserPlan(userId: string) {
  const entitlement = await getUserEntitlement(userId);
  return entitlement?.plan || null;
}

/**
 * Get all entitlements for a user (including expired/cancelled)
 *
 * @param userId - user ID
 * @returns Array of entitlements
 */
export async function getUserEntitlementHistory(userId: string) {
  return await db.query.userEntitlements.findMany({
    where: eq(userEntitlements.userId, userId),
    with: {
      plan: true,
    },
    orderBy: (entitlements, { desc }) => [desc(entitlements.createdAt)],
  });
}

// ?// Permission Checks (Feature-based)
// ?

/**
 * Feature key constants for type-safe feature checks.
 * Add new features here to enable type-safe checks.
 */
export const FEATURE_KEYS = {
  API_ACCESS: 'platform.apiAccess',
  WEBHOOKS_ACCESS: 'platform.webhooksAccess',
  PREMIUM_TOOLS: 'platform.premiumTools',
  ADVANCED_FEATURES: 'platform.advancedFeatures',
  PRIORITY_SUPPORT: 'platform.prioritySupport',
  HOOK_CREATE: 'platform.hookCreate',
  PLUGIN_INSTALL: 'platform.pluginInstall',
  TOOLS_ACCESS: 'platform.toolsAccess',
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

/**
 * Get a raw feature value. Parameterized features can be booleans, strings,
 * numbers, or small JSON objects, which lets plugins use keys such as
 * `seo-plus.outputResolution` without custom entitlement code.
 */
export async function getFeatureValue(
  userId: string,
  feature: string
): Promise<EntitlementFeatureValue> {
  const entitlement = await getUserEntitlement(userId);
  if (!entitlement) return null;

  return readPlanFeatureValue(entitlement.plan.features, feature);
}

/**
 * Check if user has a specific feature
 *
 * @param userId - user ID
 * @param feature - Feature key from FEATURE_KEYS or custom string
 * @returns True if user has the feature enabled
 */
export async function hasFeature(userId: string, feature: string): Promise<boolean> {
  return (await getFeatureValue(userId, feature)) === true;
}

/**
 * Check if user has API access feature.
 * For quota check, use canCallAPI() which checks both feature and quota.
 */
export const hasAPIAccess = (userId: string) => hasFeature(userId, FEATURE_KEYS.API_ACCESS);

/** Check if user can create webhooks */
export const canCreateWebhook = (userId: string) =>
  hasFeature(userId, FEATURE_KEYS.WEBHOOKS_ACCESS);

/** Check if user can use premium tools */
export const canUsePremiumTools = (userId: string) =>
  hasFeature(userId, FEATURE_KEYS.PREMIUM_TOOLS);

/** Check if user has advanced features */
export const hasAdvancedFeatures = (userId: string) =>
  hasFeature(userId, FEATURE_KEYS.ADVANCED_FEATURES);

/** Check if user has priority support */
export const hasPrioritySupport = (userId: string) =>
  hasFeature(userId, FEATURE_KEYS.PRIORITY_SUPPORT);

/**
 * Get user's tools access level
 *
 * @param userId - user ID
 * @returns Tools access level: 'basic' | 'premium' | 'enterprise' | null
 */
export async function getToolsAccessLevel(
  userId: string
): Promise<'basic' | 'premium' | 'enterprise' | null> {
  const toolsAccess = await getFeatureValue(userId, FEATURE_KEYS.TOOLS_ACCESS);

  if (toolsAccess === 'basic' || toolsAccess === 'premium' || toolsAccess === 'enterprise') {
    return toolsAccess;
  }
  return null;
}

/**
 * Check if user can perform an action based on usage limits
 *
 * @param userId - user ID
 * @param limitKey - Limit key (e.g., 'platform.apiCalls')
 * @param currentUsageKey - Usage metric key (e.g., 'platform.apiCalls')
 * @returns True if user is under the limit
 */
export async function canPerformAction(
  userId: string,
  limitKey: string,
  currentUsageKey: string
): Promise<boolean> {
  const entitlement = await getUserEntitlement(userId);

  if (!entitlement) {
    return false;
  }

  const usage = entitlement.usageMetrics as Record<string, number>;

  const limit = readPlanLimitValue(entitlement.plan.limits, limitKey, entitlement.billingInterval);
  const currentUsage = usage[currentUsageKey] || 0;

  // No limit defined = unlimited
  if (limit === undefined || limit === null) {
    return true;
  }

  return currentUsage < limit;
}

// ?// Permission Checks (Feature + Quota Combined)
// ?
/**
 * Check if user can make API calls
 *
 * Checks both:
 * 1. Feature permission (platform.apiAccess)
 * 2. Usage quota (platform.apiCalls)
 *
 * @param userId - user ID
 * @returns True if user has API access feature AND hasn't exceeded quota
 */
export async function canCallAPI(userId: string): Promise<boolean> {
  // First check feature permission
  const hasPermission = await hasAPIAccess(userId);
  if (!hasPermission) {
    return false;
  }

  // Then check quota
  return canPerformAction(userId, 'platform.apiCalls', 'platform.apiCalls');
}

/**
 * Check if user can create more hooks
 * Checks both feature permission and quota.
 */
export async function canCreateHook(userId: string): Promise<boolean> {
  const hasPermission = await hasFeature(userId, FEATURE_KEYS.HOOK_CREATE);
  if (!hasPermission) return false;
  return canPerformAction(userId, 'platform.hooks', 'platform.hooksCreated');
}

/**
 * Check if user can install more plugins
 * Checks both feature permission and quota.
 */
export async function canInstallPlugin(userId: string): Promise<boolean> {
  const hasPermission = await hasFeature(userId, FEATURE_KEYS.PLUGIN_INSTALL);
  if (!hasPermission) return false;
  return canPerformAction(userId, 'platform.plugins', 'platform.pluginsInstalled');
}

/**
 * Get user's remaining quota for a specific resource
 *
 * @param userId - user ID
 * @param limitKey - Limit key
 * @param currentUsageKey - Usage metric key
 * @returns Remaining quota, or -1 if unlimited
 */
export async function getRemainingQuota(
  userId: string,
  limitKey: string,
  currentUsageKey: string
): Promise<number> {
  const entitlement = await getUserEntitlement(userId);

  if (!entitlement) {
    return 0;
  }

  const usage = entitlement.usageMetrics as Record<string, number>;

  const limit = readPlanLimitValue(entitlement.plan.limits, limitKey, entitlement.billingInterval);
  const currentUsage = usage[currentUsageKey] || 0;

  if (limit === undefined || limit === null) {
    return -1; // Unlimited
  }

  return Math.max(0, limit - currentUsage);
}

export async function getLimitValue(
  userId: string,
  limitKey: string,
  interval?: string | null
): Promise<number | null> {
  const entitlement = await getUserEntitlement(userId);
  if (!entitlement) {
    return null;
  }

  return readPlanLimitValue(
    entitlement.plan.limits,
    limitKey,
    interval ?? entitlement.billingInterval
  );
}

// ?// Usage Tracking
// ?

/**
 * Generic metric tracking function
 *
 * Tracks any usage metric with atomic increment and cache invalidation.
 * This is the recommended method for all usage tracking.
 *
 * Uses database-level atomic operation to prevent race conditions.
 * The JSONB update is performed in a single SQL statement, ensuring
 * concurrent requests don't overwrite each other's changes.
 *
 * @param userId - user ID
 * @param metricKey - The metric key to track (e.g., 'platform.apiCalls', 'seo-plus.auditRuns')
 * @param delta - Amount to increment (default: 1, use negative for decrement)
 * @returns true if metric was tracked, false if no active entitlement found
 *
 * @example
 * // Track a single API call
 * await trackMetric(userId, 'platform.apiCalls');
 *
 * // Track multiple items at once
 * await trackMetric(userId, 'seo-plus.exports', 5);
 *
 * // Track decrement (e.g., when deleting a channel)
 * await trackMetric(userId, 'seo-plus.channels', -1);
 */
export async function trackMetric(
  userId: string,
  metricKey: string,
  delta: number = 1
): Promise<boolean> {
  validateEntitlementKey(metricKey, 'metric');
  validateFiniteUsageNumber(delta, 'Metric delta');

  const now = new Date();
  const nowIso = now.toISOString();

  // Atomic database-level update using PostgreSQL JSONB functions
  // This prevents race conditions by performing the increment in a single SQL statement
  const result = await db
    .update(userEntitlements)
    .set({
      usageMetrics: sql`
        jsonb_set(
          jsonb_set(
            COALESCE(${userEntitlements.usageMetrics}, '{}'::jsonb),
            ${sql.raw(`'{${metricKey}}'`)},
            to_jsonb(
              GREATEST(
                0::double precision,
                COALESCE(
                  (${userEntitlements.usageMetrics}->>${metricKey})::double precision,
                  0::double precision
                ) + ${delta}::double precision
              )
            )
          ),
          '{lastUsedAt}',
          to_jsonb(${nowIso}::text)
        )
      `,
      usageUpdatedAt: now,
    })
    .where(and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active')))
    .returning();

  if (!result || result.length === 0) {
    logger.warn({ userId, metricKey }, 'No active entitlement found for tracking');
    return false;
  }

  // Invalidate cache to ensure fresh data on next permission check
  invalidateUserEntitlementCache(userId);
  return true;
}

/**
 * Set a metric to a specific value (not increment)
 *
 * Uses database-level atomic operation to prevent race conditions.
 *
 * @param userId - user ID
 * @param metricKey - The metric key to set
 * @param value - The value to set
 * @returns true if metric was set, false if no active entitlement found
 */
export async function setMetric(
  userId: string,
  metricKey: string,
  value: number
): Promise<boolean> {
  validateEntitlementKey(metricKey, 'metric');
  validateFiniteUsageNumber(value, 'Metric value');

  const now = new Date();
  const nowIso = now.toISOString();

  // Atomic database-level update using PostgreSQL JSONB functions
  const result = await db
    .update(userEntitlements)
    .set({
      usageMetrics: sql`
        jsonb_set(
          jsonb_set(
            COALESCE(${userEntitlements.usageMetrics}, '{}'::jsonb),
            ${sql.raw(`'{${metricKey}}'`)},
            to_jsonb(${value}::double precision)
          ),
          '{lastUsedAt}',
          to_jsonb(${nowIso}::text)
        )
      `,
      usageUpdatedAt: now,
    })
    .where(and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active')))
    .returning();

  if (!result || result.length === 0) {
    logger.warn({ userId, metricKey }, 'No active entitlement found for setting metric');
    return false;
  }

  invalidateUserEntitlementCache(userId);
  return true;
}

/**
 * Reset usage metrics for a user
 *
 * Call this at the start of each billing period or when needed.
 * Resets specified metrics to their initial values.
 *
 * @param userId - user ID
 * @param metricsToReset - Array of metric keys to reset (optional, defaults to all numeric metrics)
 *
 * @example
 * // Reset specific metrics
 * await resetUsageMetrics(userId, ['platform.apiCalls', 'platform.storageBytes']);
 *
 * // Reset all metrics to empty object
 * await resetUsageMetrics(userId);
 */
export async function resetUsageMetrics(userId: string, metricsToReset?: string[]): Promise<void> {
  if (metricsToReset && metricsToReset.length > 0) {
    // Build dynamic reset object
    const resetValues: Record<string, number | null> = {};
    for (const metric of metricsToReset) {
      resetValues[metric] = 0;
    }

    // Get current metrics and merge with reset values
    const entitlement = await db.query.userEntitlements.findFirst({
      where: and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active')),
      columns: { usageMetrics: true },
    });

    const currentMetrics = (entitlement?.usageMetrics as Record<string, unknown>) || {};
    const updatedMetrics = {
      ...currentMetrics,
      ...resetValues,
      lastResetAt: new Date().toISOString(),
    };

    await db
      .update(userEntitlements)
      .set({
        usageMetrics: updatedMetrics,
        usageUpdatedAt: new Date(),
      })
      .where(and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active')));
  } else {
    // Reset all metrics to empty state
    await db
      .update(userEntitlements)
      .set({
        usageMetrics: { lastResetAt: new Date().toISOString() },
        usageUpdatedAt: new Date(),
      })
      .where(and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active')));
  }
}

// ?// Subscription Management
// ?
/**
 * Create a new entitlement for a user
 *
 *
 * @param data - Entitlement data
 * @param options - Additional options
 * @param options.skipAudit - Skip audit logging (default: false)
 * @param options.operatorId - ID of operator performing the action
 * @returns Created entitlement
 */
export async function createUserEntitlement(
  data: NewUserEntitlement,
  options?: {
    skipAudit?: boolean;
    operatorId?: string;
  }
): Promise<UserEntitlement> {
  // ?Execute in system context with transaction protection
  const newEntitlement = await withSystemContext(async (db) => {
    return db.transaction(async (tx) => {
      // Step 1: Deactivate all existing active entitlements
      await tx
        .update(userEntitlements)
        .set({ status: 'inactive', updatedAt: new Date() })
        .where(
          and(eq(userEntitlements.userId, data.userId), eq(userEntitlements.status, 'active'))
        );

      // Step 2: Create new entitlement
      const [created] = await tx.insert(userEntitlements).values(data).returning();

      return created;
    });
    // ?Transaction ends - either both steps succeed or both rollback
  });

  // ?Only invalidate cache after successful transaction
  invalidateUserEntitlementCache(data.userId);

  // ?Audit log (optional)
  if (!options?.skipAudit) {
    await auditLogDurable({
      action: 'entitlement.created',
      resource: 'user_entitlement',
      resourceId: newEntitlement.id,
      userId: options?.operatorId || data.userId,
      status: 'success',
      metadata: {
        userId: data.userId,
        planId: data.planId,
        status: data.status,
      },
    });
  }

  return newEntitlement;
}

// Internal helper type for database client
type DbClient = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Internal helper to execute the default entitlement creation logic
 * @internal
 */
async function executeCreateDefaultEntitlement(
  userId: string,
  client: DbClient
): Promise<UserEntitlement> {
  // Step 1: Find the default free plan
  const freePlan = await client
    .select()
    .from(entitlementPlans)
    .where(and(eq(entitlementPlans.isDefault, true), eq(entitlementPlans.isActive, true)))
    .limit(1);

  if (!freePlan || freePlan.length === 0) {
    throw new NotFoundError('No default entitlement plan found');
  }

  // Step 2: Deactivate any existing active entitlements (shouldn't exist for new user)
  await client
    .update(userEntitlements)
    .set({ status: 'inactive', updatedAt: new Date() })
    .where(and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active')));

  // Step 3: Create new entitlement
  const [created] = await client
    .insert(userEntitlements)
    .values({
      userId,
      planId: freePlan[0].id,
      status: 'active',
      startDate: new Date(),
      usageMetrics: {},
    })
    .returning();

  return created;
}

/**
 * Create default free entitlement for a new user
 *
 * @param userId - user ID
 * @param dbClient - Database client or transaction object (optional)
 *                   If provided, uses the given transaction; otherwise creates a new one
 * @returns Created entitlement
 */
export async function createDefaultEntitlement(
  userId: string,
  dbClient?: DbClient
): Promise<UserEntitlement> {
  // If dbClient is provided, use it directly (within an existing transaction)
  if (dbClient) {
    // Note: Cache invalidation should be done by the caller after transaction commit
    return executeCreateDefaultEntitlement(userId, dbClient);
  }

  // If no dbClient provided, create a new transaction (standalone usage)
  const entitlement = await withSystemContext(async (db) => {
    return db.transaction(async (tx) => {
      return executeCreateDefaultEntitlement(userId, tx);
    });
  });

  // Invalidate cache after successful transaction
  invalidateUserEntitlementCache(userId);

  return entitlement;
}

/**
 * Upgrade user to a new plan
 *
 *
 * @param userId - user ID
 * @param newPlanId - New plan ID
 * @param stripeSubscriptionId - Stripe subscription ID (optional)
 * @param stripeCustomerId - Stripe customer ID (optional)
 * @param options - Additional options
 * @param options.operatorId - ID of operator performing the action
 * @param options.reason - Reason for the plan change
 * @returns Updated entitlement
 */
export async function upgradeUserPlan(
  userId: string,
  newPlanId: string,
  stripeSubscriptionId?: string,
  stripeCustomerId?: string,
  options?: { operatorId?: string; reason?: string }
): Promise<UserEntitlement> {
  logger.debug({ userId, newPlanId, operatorId: options?.operatorId }, 'upgradeUserPlan called');

  const result = await withSystemContext(async (db) => {
    return db.transaction(async (tx) => {
      // Step 1: Verify plan exists and lock the row (prevents concurrent deletion)
      const plan = await tx
        .select()
        .from(entitlementPlans)
        .where(eq(entitlementPlans.id, newPlanId))
        .for('update')
        .limit(1);

      if (!plan || plan.length === 0) {
        logger.error({ newPlanId, userId }, 'Plan not found in database');
        throw new NotFoundError(`Plan not found: ${newPlanId}`);
      }

      if (!plan[0].isActive) {
        logger.error(
          { planId: newPlanId, planName: plan[0].name },
          'Cannot upgrade to inactive plan'
        );
        throw new ValidationError('Cannot upgrade to an inactive plan');
      }

      logger.debug({ planId: plan[0].id, planSlug: plan[0].slug }, 'Plan validated');

      // Step 2: Check if user has an existing entitlement
      const existingEntitlements = await tx
        .select()
        .from(userEntitlements)
        .where(and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active')))
        .limit(1);

      let newEntitlement: UserEntitlement;

      if (existingEntitlements.length > 0) {
        // Step 3a: Update existing entitlement (keeps one record per user)
        const existingId = existingEntitlements[0].id;
        const oldPlanId = existingEntitlements[0].planId;

        const [updated] = await tx
          .update(userEntitlements)
          .set({
            planId: newPlanId,
            stripeSubscriptionId,
            stripeCustomerId,
            notes: options?.reason,
            updatedAt: new Date(),
          })
          .where(eq(userEntitlements.id, existingId))
          .returning();

        newEntitlement = updated;

        logger.info(
          { userId, entitlementId: updated.id, oldPlanId, newPlanId, planName: plan[0].name },
          'Entitlement upgraded'
        );
      } else {
        // Step 3b: Create new entitlement (first time subscription)
        const [created] = await tx
          .insert(userEntitlements)
          .values({
            userId,
            planId: newPlanId,
            status: 'active',
            startDate: new Date(),
            stripeSubscriptionId,
            stripeCustomerId,
            notes: options?.reason,
            usageMetrics: {},
          })
          .returning();

        newEntitlement = created;

        logger.info(
          { userId, entitlementId: created.id, planId: newPlanId, planName: plan[0].name },
          'New entitlement created'
        );
      }

      return { plan: plan[0], entitlement: newEntitlement };
    });
  });

  // ?Invalidate cache after successful transaction
  invalidateUserEntitlementCache(userId);

  // ?Audit log
  await auditLogDurable({
    action: 'entitlement.upgraded',
    resource: 'user_entitlement',
    resourceId: result.entitlement.id,
    userId: options?.operatorId || userId,
    status: 'success',
    metadata: {
      userId,
      newPlanId,
      planName: result.plan.name,
      stripeSubscriptionId,
      reason: options?.reason,
    },
  });

  return result.entitlement;
}

/**
 * Cancel user's subscription
 *
 *
 * @param userId - user ID
 * @param immediately - If true, deactivate immediately; if false, mark for end of period
 * @param options - Additional options
 * @param options.operatorId - ID of operator performing the action
 * @param options.reason - Reason for cancellation
 */
export async function cancelSubscription(
  userId: string,
  immediately = false,
  options?: {
    entitlementId?: string;
    operatorId?: string;
    reason?: string;
  }
): Promise<UserEntitlement> {
  const cancelled = await withSystemContext(async (db) => {
    return db.transaction(async (tx) => {
      const update = immediately
        ? { status: 'cancelled' as const, cancelledAt: new Date(), updatedAt: new Date() }
        : { cancelledAt: new Date(), updatedAt: new Date() };

      const whereClause = options?.entitlementId
        ? and(
            eq(userEntitlements.userId, userId),
            eq(userEntitlements.id, options.entitlementId),
            eq(userEntitlements.status, 'active')
          )
        : and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active'));

      const result = await tx
        .update(userEntitlements)
        .set({
          ...update,
          notes: options?.reason,
        })
        .where(whereClause)
        .returning();

      if (!result || result.length === 0) {
        throw new NotFoundError('No active subscription found for user');
      }

      return result[0];
    });
  });

  invalidateUserEntitlementCache(userId);

  await auditLogDurable({
    action: immediately ? 'entitlement.cancelled_immediately' : 'entitlement.cancel_scheduled',
    resource: 'user_entitlement',
    resourceId: cancelled.id,
    userId: options?.operatorId || userId,
    status: 'success',
    metadata: {
      userId,
      entitlementId: cancelled.id,
      immediately,
      reason: options?.reason,
    },
  });

  return cancelled;
}

/**
 * Reactivate a cancelled subscription
 *
 *
 * @param userId - user ID
 * @param options - Additional options
 * @param options.operatorId - ID of operator performing the action
 */
export async function reactivateSubscription(
  userId: string,
  entitlementId: string,
  options?: { operatorId?: string; reason?: string }
): Promise<UserEntitlement> {
  const reactivated = await withSystemContext(async (db) => {
    return db.transaction(async (tx) => {
      const activeEntitlements = await tx
        .select({ id: userEntitlements.id })
        .from(userEntitlements)
        .where(and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active')))
        .limit(1);

      if (activeEntitlements.length > 0) {
        throw new ValidationError('User already has an active subscription');
      }

      const result = await tx
        .update(userEntitlements)
        .set({
          status: 'active',
          cancelledAt: null,
          cancelAtPeriodEnd: false,
          notes: options?.reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userEntitlements.userId, userId),
            eq(userEntitlements.id, entitlementId),
            eq(userEntitlements.status, 'cancelled')
          )
        )
        .returning();

      if (!result || result.length === 0) {
        throw new NotFoundError('No cancelled subscription found for user');
      }

      return result[0];
    });
  });

  invalidateUserEntitlementCache(userId);

  await auditLogDurable({
    action: 'entitlement.reactivated',
    resource: 'user_entitlement',
    resourceId: reactivated.id,
    userId: options?.operatorId || userId,
    status: 'success',
    metadata: {
      userId,
      entitlementId: reactivated.id,
      reason: options?.reason,
    },
  });

  return reactivated;
}

/**
 * Mark subscription as expired
 *
 * Called by cron job or webhook when subscription period ends
 *
 *
 * @param userId - user ID
 * @param options - Additional options
 * @param options.operatorId - ID of operator performing the action (usually 'cron' or 'webhook')
 */
export async function expireSubscription(
  userId: string,
  options?: { operatorId?: string }
): Promise<void> {
  await withSystemContext(async (db) => {
    return db.transaction(async (tx) => {
      const result = await tx
        .update(userEntitlements)
        .set({ status: 'expired', updatedAt: new Date() })
        .where(and(eq(userEntitlements.userId, userId), eq(userEntitlements.status, 'active')))
        .returning();

      // ?Check if user has active subscription
      if (!result || result.length === 0) {
        throw new NotFoundError('No active subscription found for user');
      }
    });
  });

  // ?Invalidate cache after successful transaction
  invalidateUserEntitlementCache(userId);

  // ?Audit log
  await auditLogDurable({
    action: 'entitlement.expired',
    resource: 'user_entitlement',
    userId: options?.operatorId || 'system',
    status: 'success',
    metadata: {
      userId,
    },
  });
}

// ?// Summary Functions
// ?
/**
 * Get user's entitlement summary
 *
 * Returns detailed information about user's subscription,
 * including limits, usage, and remaining quotas
 *
 * @param userId - user ID
 * @returns Entitlement summary
 */
export async function getUserEntitlementSummary(userId: string) {
  const entitlement = await getUserEntitlement(userId);

  if (!entitlement) {
    return {
      hasEntitlement: false,
      plan: null,
      features: {},
      limits: {},
      usage: {},
      quotas: {},
    };
  }

  const features = asRecord(entitlement.plan.features);
  const limits = readEffectivePlanLimits(entitlement.plan.limits, entitlement.billingInterval);
  const usage = (entitlement.usageMetrics as Record<string, number>) || {};

  // Calculate remaining quotas for all limits
  const quotas: Record<string, number> = {};
  for (const [key, limit] of Object.entries(limits)) {
    const usageKey = deriveUsageMetricKey(key);
    const currentUsage = usage[usageKey] || 0;

    quotas[key] = Math.max(0, limit - currentUsage);
  }

  return {
    hasEntitlement: true,
    plan: {
      id: entitlement.plan.id,
      name: entitlement.plan.name,
      slug: entitlement.plan.slug,
    },
    features,
    limits,
    usage,
    quotas,
    status: entitlement.status,
    startDate: entitlement.startDate,
    endDate: entitlement.endDate,
  };
}

// ?// Plan Tier Checking (for Plugin Permissions)
// ?

/**
 * Check if user's plan meets or exceeds a required plan tier
 *
 * Uses the `sortOrder` field from the database to determine plan hierarchy.
 * This is a dynamic comparison that doesn't hardcode plan names.
 *
 * @param userId - user ID
 * @param requiredPlanSlug - Required plan slug (e.g., 'free', 'pro', 'lifetime')
 * @returns True if user's plan sortOrder >= required plan's sortOrder
 *
 * @example
 * // Check if user has at least 'pro' plan
 * const canAccess = await hasRequiredPlanTier(userId, 'pro');
 *
 * @example
 * // Check if user has at least 'free' plan (always true for active users)
 * const hasAnyPlan = await hasRequiredPlanTier(userId, 'free');
 */
export async function hasRequiredPlanTier(
  userId: string,
  requiredPlanSlug: string
): Promise<boolean> {
  const entitlement = await getUserEntitlement(userId);

  // No entitlement = check if required is the default/free plan
  if (!entitlement) {
    // User without entitlement can only access plans with sortOrder 0 (default/free)
    const requiredPlan = await db.query.entitlementPlans.findFirst({
      where: eq(entitlementPlans.slug, requiredPlanSlug),
      columns: { sortOrder: true, isDefault: true },
    });
    return requiredPlan?.isDefault === true || requiredPlan?.sortOrder === 0;
  }

  // Get required plan's sortOrder from database
  const requiredPlan = await db.query.entitlementPlans.findFirst({
    where: eq(entitlementPlans.slug, requiredPlanSlug),
    columns: { sortOrder: true },
  });

  if (!requiredPlan) {
    // Unknown plan slug - deny access for safety
    logger.warn({ requiredPlanSlug }, 'Unknown plan slug in hasRequiredPlanTier');
    return false;
  }

  // User's plan sortOrder must be >= required plan's sortOrder
  const userSortOrder = entitlement.plan.sortOrder ?? 0;
  const requiredSortOrder = requiredPlan.sortOrder ?? 0;

  return userSortOrder >= requiredSortOrder;
}

// ?// Statistics Functions
// ?
/**
 * Get user entitlement statistics
 *
 * Returns counts of user subscriptions by status.
 * Uses a single optimized query with conditional aggregation.
 *
 * @returns Statistics object with counts
 * @throws Error if database query fails (errors are logged and re-thrown)
 */
export async function getUserEntitlementStats(): Promise<{
  total: number;
  active: number;
  trial: number;
  cancelled: number;
  expired: number;
}> {
  try {
    // Optimized: Single query with conditional aggregation instead of 5 separate queries
    const result = await db.execute<{
      total: string;
      active: string;
      trial: string;
      cancelled: string;
      expired: string;
    }>(sql`
      SELECT
        COUNT(*)::text as total,
        COUNT(CASE WHEN ${userEntitlements.status} = 'active' THEN 1 END)::text as active,
        COUNT(CASE WHEN ${userEntitlements.status} = 'trial' THEN 1 END)::text as trial,
        COUNT(CASE WHEN ${userEntitlements.status} = 'cancelled' THEN 1 END)::text as cancelled,
        COUNT(CASE WHEN ${userEntitlements.status} = 'expired' THEN 1 END)::text as expired
      FROM ${userEntitlements}
    `);

    // Handle different return types from db.execute (Neon vs standard Postgres)
    const statsRow = 'rows' in result ? result.rows[0] : result[0];

    return {
      total: Number(statsRow?.total || 0),
      active: Number(statsRow?.active || 0),
      trial: Number(statsRow?.trial || 0),
      cancelled: Number(statsRow?.cancelled || 0),
      expired: Number(statsRow?.expired || 0),
    };
  } catch (error) {
    logger.error({ error }, 'Failed to get user entitlement stats');
    throw error;
  }
}
