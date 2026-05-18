/**
 * Credit Log Service
 *
 * Service for recording credit/quota changes to provide:
 * - User transparency (visible credit history)
 * - Audit trail for disputes
 * - Compliance evidence
 *
 * Important: Only log significant events, NOT every API call
 */

import { requireUserContext, withSystemContext } from '@/lib/db';
import { creditLogs, creditReconciliationRuns, type CreditLogType } from '@/lib/db/schema';
import { desc, eq, and, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import {
  applyCreditChange,
  getUserCreditLedgerBalance,
} from '@/lib/services/billing/credit-account-service';
import { PLATFORM_PRIMARY_CREDIT_METRIC } from '@/lib/billing/billing-metrics';

// ============================================================================
// TYPES
// ============================================================================

export interface LogCreditChangeParams {
  userId: string;
  logType: CreditLogType;
  changeAmount: number;
  balanceAfter: Record<string, unknown>;
  balanceBefore?: Record<string, unknown>;
  balanceDelta?: Record<string, unknown>;
  reason?: string;
  relatedOrderId?: string;
  entitlementId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreditReconciliationMismatch {
  userId: string;
  entitlementId: string | null;
  ledgerBalance: number;
  entitlementBalance: number;
  difference: number;
}

// ============================================================================
// CREDIT LOG FUNCTIONS
// ============================================================================

/**
 * Log a credit/quota change event
 *
 * @example Grant credits on subscription creation
 * ```ts
 * await logCreditChange({
 *   userId,
 *   logType: 'grant',
 *   changeAmount: 10000,
 *   balanceAfter: { apiCallsRemaining: 10000 },
 *   reason: 'Subscription created - Pro Plan',
 *   relatedOrderId: orderId
 * });
 * ```
 *
 * @example Monthly reset
 * ```ts
 * await logCreditChange({
 *   userId,
 *   logType: 'reset',
 *   changeAmount: 10000,
 *   balanceAfter: { apiCallsRemaining: 10000 },
 *   reason: 'Monthly billing cycle reset'
 * });
 * ```
 */
export async function logCreditChange(params: LogCreditChangeParams): Promise<void> {
  const {
    userId,
    logType,
    changeAmount,
    balanceAfter,
    balanceBefore,
    balanceDelta,
    reason,
    relatedOrderId,
    entitlementId,
    metadata,
  } = params;

  const checksum = buildCreditLogChecksum({
    userId,
    logType,
    changeAmount,
    balanceBefore,
    balanceAfter,
    balanceDelta,
    relatedOrderId,
    entitlementId,
  });

  await withSystemContext(async (database) => {
    await database.insert(creditLogs).values({
      userId,
      logType,
      changeAmount,
      balanceAfter,
      balanceBefore,
      balanceDelta,
      reason: reason || undefined,
      relatedOrderId: relatedOrderId || undefined,
      entitlementId: entitlementId || undefined,
      metadata: metadata || {},
      checksum,
    });
  });
}

/**
 * Get user's credit history
 *
 * Returns most recent changes first
 *
 * @param userId - User ID
 * @param limit - Maximum number of logs to return (default: 50)
 * @param offset - Number of rows to skip for pagination (default: 0)
 */
export async function getUserCreditLogs(userId: string, limit = 50, offset = 0) {
  return await requireUserContext(userId, async (database) => {
    return await database.query.creditLogs.findMany({
      where: eq(creditLogs.userId, userId),
      orderBy: desc(creditLogs.createdAt),
      limit,
      offset,
      with: {
        relatedOrder: {
          columns: {
            id: true,
            orderType: true,
            amount: true,
            currency: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });
  });
}

/**
 * Get credit logs for a specific order
 *
 * Useful for viewing all credit changes related to a specific transaction
 */
export async function getOrderCreditLogs(orderId: string) {
  return await withSystemContext(async (database) => {
    return await database.query.creditLogs.findMany({
      where: eq(creditLogs.relatedOrderId, orderId),
      orderBy: desc(creditLogs.createdAt),
    });
  });
}

/**
 * Get credit logs for an order owned by the current user.
 */
export async function getUserOrderCreditLogs(userId: string, orderId: string) {
  return await requireUserContext(userId, async (database) => {
    return await database.query.creditLogs.findMany({
      where: and(eq(creditLogs.userId, userId), eq(creditLogs.relatedOrderId, orderId)),
      orderBy: desc(creditLogs.createdAt),
    });
  });
}

/**
 * Get credit logs by type
 *
 * For analytics and reporting
 */
export async function getCreditLogsByType(userId: string, logType: CreditLogType, limit = 50) {
  return await requireUserContext(userId, async (database) => {
    return await database
      .select()
      .from(creditLogs)
      .where(and(eq(creditLogs.userId, userId), eq(creditLogs.logType, logType)))
      .orderBy(desc(creditLogs.createdAt))
      .limit(limit);
  });
}

export async function getCreditLedgerBalance(userId: string): Promise<number> {
  return getUserCreditLedgerBalance(userId);
}

export async function runCreditReconciliation(): Promise<{
  runId: string;
  checkedUsers: number;
  mismatchCount: number;
  mismatches: CreditReconciliationMismatch[];
}> {
  const startedAt = new Date();

  return withSystemContext(async (database) => {
    const [run] = await database
      .insert(creditReconciliationRuns)
      .values({
        status: 'running',
        startedAt,
        report: {},
      })
      .returning();

    try {
      const rows = await database.execute<{
        user_id: string;
        entitlement_id: string | null;
        ledger_balance: string | number;
        entitlement_balance: string | number;
      }>(sql`
        WITH account_balance AS (
          SELECT scope_id AS user_id, COALESCE(balance, 0)::int AS ledger_balance
          FROM credit_accounts
          WHERE scope_type = 'user'
            AND metric = ${PLATFORM_PRIMARY_CREDIT_METRIC}
        ),
        active_entitlement AS (
          SELECT DISTINCT ON (user_id)
            user_id,
            id AS entitlement_id,
            COALESCE((usage_metrics->>${PLATFORM_PRIMARY_CREDIT_METRIC})::int, 0) AS entitlement_balance
          FROM user_entitlements
          WHERE status = 'active'
          ORDER BY user_id, created_at DESC
        )
        SELECT
          COALESCE(account_balance.user_id, active_entitlement.user_id) AS user_id,
          active_entitlement.entitlement_id,
          COALESCE(account_balance.ledger_balance, 0) AS ledger_balance,
          COALESCE(active_entitlement.entitlement_balance, 0) AS entitlement_balance
        FROM account_balance
        FULL OUTER JOIN active_entitlement ON active_entitlement.user_id = account_balance.user_id
      `);

      const normalizedRows = Array.isArray(rows) ? rows : rows.rows;
      const mismatches = normalizedRows
        .map((row) => ({
          userId: row.user_id,
          entitlementId: row.entitlement_id,
          ledgerBalance: Number(row.ledger_balance || 0),
          entitlementBalance: Number(row.entitlement_balance || 0),
          difference: Number(row.ledger_balance || 0) - Number(row.entitlement_balance || 0),
        }))
        .filter((row) => row.difference !== 0);

      await database
        .update(creditReconciliationRuns)
        .set({
          status: mismatches.length === 0 ? 'passed' : 'mismatch',
          checkedUsers: normalizedRows.length,
          mismatchCount: mismatches.length,
          completedAt: new Date(),
          report: { mismatches },
        })
        .where(eq(creditReconciliationRuns.id, run.id));

      return {
        runId: run.id,
        checkedUsers: normalizedRows.length,
        mismatchCount: mismatches.length,
        mismatches,
      };
    } catch (error) {
      await database
        .update(creditReconciliationRuns)
        .set({
          status: 'failed',
          completedAt: new Date(),
          error: error instanceof Error ? error.message : String(error),
        })
        .where(eq(creditReconciliationRuns.id, run.id));

      throw error;
    }
  });
}

function buildCreditLogChecksum(input: {
  userId: string;
  logType: CreditLogType;
  changeAmount: number;
  balanceBefore?: Record<string, unknown>;
  balanceAfter: Record<string, unknown>;
  balanceDelta?: Record<string, unknown>;
  relatedOrderId?: string;
  entitlementId?: string;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function readSnapshotBalance(
  snapshot: Record<string, unknown>,
  metric = PLATFORM_PRIMARY_CREDIT_METRIC
) {
  const direct = snapshot[metric];
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return Math.trunc(direct);
  }
  if (typeof direct === 'string' && Number.isFinite(Number(direct))) {
    return Math.trunc(Number(direct));
  }

  const firstNumeric = Object.values(snapshot).find(
    (value) =>
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && Number.isFinite(Number(value)))
  );
  return typeof firstNumeric === 'number'
    ? Math.trunc(firstNumeric)
    : typeof firstNumeric === 'string'
      ? Math.trunc(Number(firstNumeric))
      : 0;
}

// ============================================================================
// CONVENIENCE FUNCTIONS
// ============================================================================

/**
 * Log subscription creation credit grant
 */
export async function logSubscriptionCreated(params: {
  userId: string;
  creditsGranted: number;
  currentBalance: Record<string, unknown>;
  planName: string;
  orderId?: string;
  entitlementId?: string;
}) {
  const { userId, creditsGranted, currentBalance, planName, orderId, entitlementId } = params;

  await applyCreditChange({
    scope: { type: 'user', id: userId },
    metric: PLATFORM_PRIMARY_CREDIT_METRIC,
    operation: 'grant',
    amount: creditsGranted,
    reason: `Subscription created - ${planName}`,
    relatedOrderId: orderId,
    metadata: {
      planName,
      entitlementId,
      currentBalance,
    },
    visibleInCreditLog: true,
  });
}

/**
 * Log monthly/billing cycle reset
 */
export async function logMonthlyReset(params: {
  userId: string;
  resetAmount: number;
  currentBalance: Record<string, unknown>;
  entitlementId?: string;
  orderId?: string;
}) {
  const { userId, resetAmount, currentBalance, entitlementId, orderId } = params;

  await applyCreditChange({
    scope: { type: 'user', id: userId },
    metric: PLATFORM_PRIMARY_CREDIT_METRIC,
    operation: 'reset',
    mode: 'set',
    amount: resetAmount,
    reason: 'Monthly billing cycle reset',
    relatedOrderId: orderId,
    metadata: {
      entitlementId,
      currentBalance,
    },
    visibleInCreditLog: true,
  });
}

/**
 * Log refund credit revocation
 */
export async function logRefundRevoke(params: {
  userId: string;
  creditsRevoked: number;
  currentBalance: Record<string, unknown>;
  orderId?: string;
  refundOrderId?: string;
}) {
  const { userId, creditsRevoked, currentBalance, orderId, refundOrderId } = params;

  await applyCreditChange({
    scope: { type: 'user', id: userId },
    metric: PLATFORM_PRIMARY_CREDIT_METRIC,
    operation: 'revoke',
    mode: 'set',
    amount: readSnapshotBalance(currentBalance),
    reason: `Credits revoked due to refund`,
    relatedOrderId: refundOrderId || orderId,
    metadata: {
      creditsRevoked,
      currentBalance,
    },
    visibleInCreditLog: true,
  });
}

/**
 * Log manual admin adjustment
 */
export async function logManualAdjustment(params: {
  userId: string;
  adjustmentAmount: number;
  currentBalance: Record<string, unknown>;
  reason: string;
  adminUserId?: string;
}) {
  const { userId, adjustmentAmount, currentBalance, reason, adminUserId } = params;

  await applyCreditChange({
    scope: { type: 'user', id: userId },
    metric: PLATFORM_PRIMARY_CREDIT_METRIC,
    operation: 'adjust',
    amount: adjustmentAmount,
    reason,
    metadata: {
      ...(adminUserId ? { adjustedBy: adminUserId } : {}),
      currentBalance,
    },
    visibleInCreditLog: true,
  });
}

/**
 * Log subscription upgrade
 */
export async function logSubscriptionUpgrade(params: {
  userId: string;
  creditsDelta: number;
  currentBalance: Record<string, unknown>;
  fromPlan: string;
  toPlan: string;
  orderId?: string;
  entitlementId?: string;
}) {
  const { userId, creditsDelta, currentBalance, fromPlan, toPlan, orderId, entitlementId } = params;

  await applyCreditChange({
    scope: { type: 'user', id: userId },
    metric: PLATFORM_PRIMARY_CREDIT_METRIC,
    operation: 'adjust',
    amount: creditsDelta,
    reason: `Upgraded from ${fromPlan} to ${toPlan}`,
    relatedOrderId: orderId,
    metadata: {
      fromPlan,
      toPlan,
      entitlementId,
      currentBalance,
    },
    visibleInCreditLog: true,
    creditLogType: 'subscription_upgrade',
  });
}

/**
 * Log subscription downgrade
 */
export async function logSubscriptionDowngrade(params: {
  userId: string;
  creditsDelta: number;
  currentBalance: Record<string, unknown>;
  fromPlan: string;
  toPlan: string;
  entitlementId?: string;
}) {
  const { userId, creditsDelta, currentBalance, fromPlan, toPlan, entitlementId } = params;

  await applyCreditChange({
    scope: { type: 'user', id: userId },
    metric: PLATFORM_PRIMARY_CREDIT_METRIC,
    operation: 'adjust',
    amount: creditsDelta,
    reason: `Downgraded from ${fromPlan} to ${toPlan}`,
    metadata: {
      fromPlan,
      toPlan,
      entitlementId,
      currentBalance,
    },
    visibleInCreditLog: true,
    creditLogType: 'subscription_downgrade',
  });
}
