/**
 * Analytics Service
 *
 *
 * Provides business intelligence and reporting capabilities
 * Features:
 * - Revenue tracking (MRR, ARR, revenue by plan)
 * - Churn analysis (churn rate, churned users, reasons)
 * - Growth metrics (new users, conversions, upgrades)
 * - Usage pattern analysis (trends, peak usage, forecasting)
 * - Cohort analysis (retention by signup date)
 * - Custom reports generation
 */

import { eq, and, gte, lte, sql, inArray, or, isNull, gt } from 'drizzle-orm';
import { db } from '@/lib/db';
import { userEntitlements, entitlementPlans, usageHistory, auditLogs } from '@/lib/db/schema';
import { AUDIT_ACTIONS } from './audit-service';
import { readPlanLimitValue } from '@/lib/services/user/user-entitlement-service';

export interface RevenueMetrics {
  mrr: number; // Monthly Recurring Revenue
  arr: number; // Annual Recurring Revenue
  revenueByPlan: Record<string, number>;
  revenueGrowth: number; // Percentage change from previous period
  averageRevenuePerUser: number;
  lifetimeValue: number;
}

export interface ChurnMetrics {
  churnedUsers: number;
  churnRate: number; // Percentage
  churnedRevenue: number;
  churnReasons: Record<string, number>;
  retentionRate: number;
  monthlyChurnTrend: Array<{ month: string; count: number; rate: number }>;
}

export interface GrowthMetrics {
  newUsers: number;
  trialConversions: number;
  trialConversionRate: number;
  upgrades: number;
  downgrades: number;
  netGrowth: number;
  growthRate: number;
  newTrials: number;
}

export interface UsagePatterns {
  metric: string;
  averageUsage: number;
  peakUsage: number;
  medianUsage: number;
  utilizationRate: number; // Average usage / average limit
  trend: 'increasing' | 'decreasing' | 'stable';
  trendPercentage: number;
  distribution: Record<string, number>; // Usage ranges
}

export interface CohortAnalysis {
  cohort: string; // Month/Year of signup
  size: number; // Initial size
  retained: number; // Still active
  retentionRate: number;
  revenue: number;
  averageLifetime: number; // Days
}

export interface AnalyticsTimeframe {
  startDate: Date;
  endDate: Date;
  previousStartDate?: Date;
  previousEndDate?: Date;
}

type RevenueSnapshotRow = {
  planName?: string | null;
  pricing?: { monthly?: number; yearly?: number } | null;
  billingInterval?: string | null;
  count: number | string;
};

type UsageSnapshotRow = {
  usage?: Record<string, unknown> | null;
  planLimits?: Record<string, unknown> | null;
  billingInterval?: string | null;
};

const MRR_ACTIVE_STATUSES = ['active', 'trial', 'trialing'] as const;

function getRowCount(row: RevenueSnapshotRow): number {
  return typeof row.count === 'number' ? row.count : Number(row.count || 0);
}

function getMonthlyPlanAmount(row: RevenueSnapshotRow): number {
  const billingInterval = row.billingInterval || 'monthly';
  const pricing = row.pricing ?? {};

  if (billingInterval === 'yearly' && typeof pricing.yearly === 'number') {
    return pricing.yearly / 12;
  }

  if (billingInterval === 'monthly' && typeof pricing.monthly === 'number') {
    return pricing.monthly;
  }

  return 0;
}

export function calculateMrrSnapshot(rows: RevenueSnapshotRow[]): {
  mrr: number;
  revenueByPlan: Record<string, number>;
} {
  let mrr = 0;
  const revenueByPlan: Record<string, number> = {};

  for (const row of rows) {
    const planName = row.planName || 'Unknown';
    const planRevenue = getMonthlyPlanAmount(row) * getRowCount(row);

    mrr += planRevenue;
    revenueByPlan[planName] = (revenueByPlan[planName] || 0) + planRevenue;
  }

  return { mrr, revenueByPlan };
}

const usageMetricToLimitKey: Record<string, string> = {
  'platform.hooksCreated': 'platform.hooks',
  'platform.pluginsInstalled': 'platform.plugins',
  'platform.storageBytes': 'platform.storageBytes',
  'platform.apiCalls': 'platform.apiCalls',
};

function getNumericUsageMetric(usageInput: unknown, metric: string): number {
  if (!usageInput || typeof usageInput !== 'object' || Array.isArray(usageInput)) {
    return 0;
  }

  const value = (usageInput as Record<string, unknown>)[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function collectUsageAndLimitValues(
  rows: UsageSnapshotRow[],
  metric:
    | 'platform.hooksCreated'
    | 'platform.pluginsInstalled'
    | 'platform.storageBytes'
    | 'platform.apiCalls'
): { usageValues: number[]; limitValues: number[]; limitByUsageIndex: Array<number | null> } {
  const usageValues: number[] = [];
  const limitValues: number[] = [];
  const limitByUsageIndex: Array<number | null> = [];
  const limitKey = usageMetricToLimitKey[metric];

  for (const row of rows) {
    usageValues.push(getNumericUsageMetric(row.usage, metric));

    const limit = readPlanLimitValue(row.planLimits, limitKey, row.billingInterval);
    if (limit !== null && limit > 0 && limit !== -1) {
      limitValues.push(limit);
      limitByUsageIndex.push(limit);
    } else {
      limitByUsageIndex.push(null);
    }
  }

  return { usageValues, limitValues, limitByUsageIndex };
}

function activeEntitlementSnapshotWhere(asOfDate: Date) {
  return and(
    inArray(userEntitlements.status, MRR_ACTIVE_STATUSES),
    lte(userEntitlements.startDate, asOfDate),
    or(isNull(userEntitlements.endDate), gt(userEntitlements.endDate, asOfDate))
  );
}

async function getMrrSnapshotRows(asOfDate: Date): Promise<RevenueSnapshotRow[]> {
  return db
    .select({
      planId: entitlementPlans.id,
      planName: entitlementPlans.name,
      pricing: entitlementPlans.pricing,
      billingInterval: userEntitlements.billingInterval,
      count: sql<number>`count(*)::int`,
    })
    .from(userEntitlements)
    .leftJoin(entitlementPlans, eq(userEntitlements.planId, entitlementPlans.id))
    .where(activeEntitlementSnapshotWhere(asOfDate))
    .groupBy(
      entitlementPlans.id,
      entitlementPlans.name,
      entitlementPlans.pricing,
      userEntitlements.billingInterval
    );
}

async function getActiveEntitlementCountSnapshot(asOfDate: Date): Promise<number> {
  const [{ count = 0 } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userEntitlements)
    .where(activeEntitlementSnapshotWhere(asOfDate));

  return Number(count || 0);
}

/**
 * Calculate revenue metrics for a timeframe
 */
export async function getRevenueMetrics(timeframe: AnalyticsTimeframe): Promise<RevenueMetrics> {
  const { endDate, previousEndDate } = timeframe;

  try {
    // MRR is a subscription snapshot at the observation date, not new revenue created in the window.
    const currentRevenue = await getMrrSnapshotRows(endDate);
    const { mrr, revenueByPlan } = calculateMrrSnapshot(currentRevenue);

    const arr = mrr * 12;

    const activeUsers = await getActiveEntitlementCountSnapshot(endDate);

    const averageRevenuePerUser = activeUsers > 0 ? mrr / activeUsers : 0;

    let previousMrr = 0;
    if (previousEndDate) {
      const previousRevenue = await getMrrSnapshotRows(previousEndDate);
      previousMrr = calculateMrrSnapshot(previousRevenue).mrr;
    }

    const revenueGrowth = previousMrr > 0 ? ((mrr - previousMrr) / previousMrr) * 100 : 0;

    // Estimate lifetime value (simple: MRR * average lifetime months)
    // For now, assume average lifetime of 24 months (can be refined)
    const lifetimeValue = mrr * 24;

    return {
      mrr,
      arr,
      revenueByPlan,
      revenueGrowth,
      averageRevenuePerUser,
      lifetimeValue,
    };
  } catch (error) {
    console.error('Error calculating revenue metrics:', error);
    throw new Error('Failed to calculate revenue metrics');
  }
}

/**
 * Calculate churn metrics for a timeframe
 */
export async function getChurnMetrics(timeframe: AnalyticsTimeframe): Promise<ChurnMetrics> {
  const { startDate, endDate } = timeframe;

  try {
    // Get churned users (cancelled or expired during period)
    const churnedUsersList = await db
      .select({
        id: userEntitlements.userId,
        status: userEntitlements.status,
        updatedAt: userEntitlements.updatedAt,
        planId: userEntitlements.planId,
        billingInterval: userEntitlements.billingInterval,
      })
      .from(userEntitlements)
      .where(
        and(
          inArray(userEntitlements.status, ['cancelled', 'expired']),
          gte(userEntitlements.updatedAt, startDate),
          lte(userEntitlements.updatedAt, endDate)
        )
      );

    const churnedCount = churnedUsersList.length;

    // Get total active users at start of period
    const [{ count: totalUsersAtStart }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userEntitlements)
      .where(
        and(eq(userEntitlements.status, 'active'), lte(userEntitlements.createdAt, startDate))
      );

    const churnRate = totalUsersAtStart > 0 ? (churnedCount / totalUsersAtStart) * 100 : 0;
    const retentionRate = 100 - churnRate;

    // Calculate churned revenue using batch query
    let churnedRevenue = 0;

    if (churnedUsersList.length > 0) {
      // Get unique plan IDs
      const uniquePlanIds = [...new Set(churnedUsersList.map((u) => u.planId))];

      // Batch query all plans at once
      const plans = await db
        .select()
        .from(entitlementPlans)
        .where(inArray(entitlementPlans.id, uniquePlanIds));

      // Create plan lookup map
      const planMap = new Map(plans.map((p) => [p.id, p]));

      // Calculate revenue using cached plans
      for (const user of churnedUsersList) {
        const plan = planMap.get(user.planId);

        if (plan) {
          churnedRevenue += getMonthlyPlanAmount({
            pricing: plan.pricing as { monthly?: number; yearly?: number } | null,
            billingInterval: user.billingInterval,
            count: 1,
          });
        }
      }
    }

    // Get churn reasons from audit logs or notes
    const churnReasons: Record<string, number> = {};
    const cancellationLogs = await db
      .select({
        metadata: auditLogs.metadata,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, 'subscription.cancelled'),
          gte(auditLogs.createdAt, startDate),
          lte(auditLogs.createdAt, endDate)
        )
      );

    for (const log of cancellationLogs) {
      const metadata = log.metadata as Record<string, unknown> | null;
      const reason = (metadata?.reason as string) || 'No reason provided';
      churnReasons[reason] = (churnReasons[reason] || 0) + 1;
    }

    // Calculate monthly churn trend (last 6 months) - optimized to reduce queries
    const now = new Date();
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

    // Single aggregated query for monthly churn counts
    const monthlyChurnData = await db
      .select({
        month: sql<string>`to_char(${userEntitlements.updatedAt}, 'YYYY-MM')`,
        count: sql<number>`count(*)::int`,
      })
      .from(userEntitlements)
      .where(
        and(
          inArray(userEntitlements.status, ['cancelled', 'expired']),
          gte(userEntitlements.updatedAt, sixMonthsAgo)
        )
      )
      .groupBy(sql`to_char(${userEntitlements.updatedAt}, 'YYYY-MM')`);

    // Create lookup map for churn data
    const churnByMonth = new Map(monthlyChurnData.map((d) => [d.month, d.count]));

    // Generate month boundaries and query active counts in parallel
    const monthBoundaries: Date[] = [];
    for (let i = 5; i >= 0; i--) {
      monthBoundaries.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    }

    const activeCountResults = await Promise.all(
      monthBoundaries.map((monthStart) =>
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(userEntitlements)
          .where(
            and(eq(userEntitlements.status, 'active'), lte(userEntitlements.createdAt, monthStart))
          )
      )
    );

    // Build the trend array
    const monthlyChurnTrend: Array<{ month: string; count: number; rate: number }> = [];
    for (let i = 0; i < monthBoundaries.length; i++) {
      const monthLabel = monthBoundaries[i].toISOString().substring(0, 7);
      const monthChurned = churnByMonth.get(monthLabel) || 0;
      const monthActiveStart = activeCountResults[i][0]?.count || 0;
      const monthRate = monthActiveStart > 0 ? (monthChurned / monthActiveStart) * 100 : 0;

      monthlyChurnTrend.push({
        month: monthLabel,
        count: monthChurned,
        rate: monthRate,
      });
    }

    return {
      churnedUsers: churnedCount,
      churnRate,
      churnedRevenue,
      churnReasons,
      retentionRate,
      monthlyChurnTrend,
    };
  } catch (error) {
    console.error('Error calculating churn metrics:', error);
    throw new Error('Failed to calculate churn metrics');
  }
}

/**
 * Calculate growth metrics for a timeframe
 */
export async function getGrowthMetrics(timeframe: AnalyticsTimeframe): Promise<GrowthMetrics> {
  const { startDate, endDate, previousStartDate, previousEndDate } = timeframe;

  try {
    // Get new users (users who created their first entitlement)
    const [{ count: newUsers }] = await db
      .select({ count: sql<number>`count(DISTINCT ${userEntitlements.userId})::int` })
      .from(userEntitlements)
      .where(
        and(gte(userEntitlements.createdAt, startDate), lte(userEntitlements.createdAt, endDate))
      );

    // Get new trials
    const [{ count: newTrials }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(userEntitlements)
      .where(
        and(
          eq(userEntitlements.status, 'trial'),
          gte(userEntitlements.createdAt, startDate),
          lte(userEntitlements.createdAt, endDate)
        )
      );

    // Get trial conversions (trials that became active during period)
    const trialConversions = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, AUDIT_ACTIONS.SUBSCRIPTION_TRIAL_CONVERTED),
          gte(auditLogs.createdAt, startDate),
          lte(auditLogs.createdAt, endDate)
        )
      );

    const trialConversionCount = trialConversions[0]?.count || 0;
    const trialConversionRate = newTrials > 0 ? (trialConversionCount / newTrials) * 100 : 0;

    // Get upgrades
    const upgrades = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, AUDIT_ACTIONS.SUBSCRIPTION_UPGRADE),
          gte(auditLogs.createdAt, startDate),
          lte(auditLogs.createdAt, endDate)
        )
      );

    const upgradeCount = upgrades[0]?.count || 0;

    // Get downgrades
    const downgrades = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.action, AUDIT_ACTIONS.SUBSCRIPTION_DOWNGRADE),
          gte(auditLogs.createdAt, startDate),
          lte(auditLogs.createdAt, endDate)
        )
      );

    const downgradeCount = downgrades[0]?.count || 0;

    // Calculate net growth
    const churnMetrics = await getChurnMetrics(timeframe);
    const netGrowth = newUsers - churnMetrics.churnedUsers;

    // Calculate growth rate
    let growthRate = 0;
    if (previousStartDate && previousEndDate) {
      const [{ count: previousNewUsers }] = await db
        .select({ count: sql<number>`count(DISTINCT ${userEntitlements.userId})::int` })
        .from(userEntitlements)
        .where(
          and(
            gte(userEntitlements.createdAt, previousStartDate),
            lte(userEntitlements.createdAt, previousEndDate)
          )
        );

      growthRate =
        previousNewUsers > 0 ? ((newUsers - previousNewUsers) / previousNewUsers) * 100 : 0;
    }

    return {
      newUsers,
      trialConversions: trialConversionCount,
      trialConversionRate,
      upgrades: upgradeCount,
      downgrades: downgradeCount,
      netGrowth,
      growthRate,
      newTrials,
    };
  } catch (error) {
    console.error('Error calculating growth metrics:', error);
    throw new Error('Failed to calculate growth metrics');
  }
}

/**
 * Analyze usage patterns for a specific metric
 */
export async function getUsagePatterns(
  metric:
    | 'platform.hooksCreated'
    | 'platform.pluginsInstalled'
    | 'platform.storageBytes'
    | 'platform.apiCalls',
  timeframe: AnalyticsTimeframe
): Promise<UsagePatterns> {
  const { endDate } = timeframe;

  try {
    const userUsage = await db
      .select({
        usage: userEntitlements.usageMetrics,
        planId: userEntitlements.planId,
        planLimits: entitlementPlans.limits,
        billingInterval: userEntitlements.billingInterval,
      })
      .from(userEntitlements)
      .leftJoin(entitlementPlans, eq(userEntitlements.planId, entitlementPlans.id))
      .where(eq(userEntitlements.status, 'active'));

    const { usageValues, limitValues, limitByUsageIndex } = collectUsageAndLimitValues(
      userUsage,
      metric
    );

    // Calculate statistics
    const averageUsage =
      usageValues.length > 0 ? usageValues.reduce((a, b) => a + b, 0) / usageValues.length : 0;

    const peakUsage = usageValues.length > 0 ? Math.max(...usageValues) : 0;

    const sortedUsage = [...usageValues].sort((a, b) => a - b);
    const medianUsage =
      sortedUsage.length > 0 ? sortedUsage[Math.floor(sortedUsage.length / 2)] : 0;

    const averageLimit =
      limitValues.length > 0 ? limitValues.reduce((a, b) => a + b, 0) / limitValues.length : 0;

    const utilizationRate = averageLimit > 0 ? (averageUsage / averageLimit) * 100 : 0;

    // Get historical usage to calculate trend
    const thirtyDaysAgo = new Date(endDate);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const historicalUsage = await db
      .select({
        value: usageHistory.value,
        recordedAt: usageHistory.recordedAt,
      })
      .from(usageHistory)
      .where(
        and(
          eq(usageHistory.metric, metric),
          gte(usageHistory.recordedAt, thirtyDaysAgo),
          lte(usageHistory.recordedAt, endDate)
        )
      )
      .orderBy(usageHistory.recordedAt);

    let trend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    let trendPercentage = 0;

    if (historicalUsage.length >= 2) {
      const firstWeekAvg = historicalUsage.slice(0, 7).reduce((a, b) => a + b.value, 0) / 7;
      const lastWeekAvg = historicalUsage.slice(-7).reduce((a, b) => a + b.value, 0) / 7;

      if (firstWeekAvg > 0) {
        trendPercentage = ((lastWeekAvg - firstWeekAvg) / firstWeekAvg) * 100;
        if (trendPercentage > 5) trend = 'increasing';
        else if (trendPercentage < -5) trend = 'decreasing';
      }
    }

    // Calculate distribution
    const distribution: Record<string, number> = {
      lte25: 0,
      lte50: 0,
      lte75: 0,
      lte100: 0,
      gt100: 0,
    };

    for (let i = 0; i < usageValues.length; i++) {
      const usage = usageValues[i];
      const limit = limitByUsageIndex[i] || 0;

      if (limit > 0) {
        const percentage = (usage / limit) * 100;
        if (percentage <= 25) distribution.lte25++;
        else if (percentage <= 50) distribution.lte50++;
        else if (percentage <= 75) distribution.lte75++;
        else if (percentage <= 100) distribution.lte100++;
        else distribution.gt100++;
      }
    }

    return {
      metric,
      averageUsage,
      peakUsage,
      medianUsage,
      utilizationRate,
      trend,
      trendPercentage,
      distribution,
    };
  } catch (error) {
    console.error('Error analyzing usage patterns:', error);
    throw new Error('Failed to analyze usage patterns');
  }
}

/**
 * Generate cohort analysis (retention by signup month)
 */
export async function getCohortAnalysis(months: number = 12): Promise<CohortAnalysis[]> {
  try {
    const cohorts: CohortAnalysis[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const cohortStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const cohortEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      const cohortLabel = cohortStart.toISOString().substring(0, 7);

      // Get users in this cohort (first subscription created in this month)
      const cohortusers = await db
        .select({
          userId: userEntitlements.userId,
          createdAt: userEntitlements.createdAt,
        })
        .from(userEntitlements)
        .where(
          and(
            gte(userEntitlements.createdAt, cohortStart),
            lte(userEntitlements.createdAt, cohortEnd)
          )
        )
        .groupBy(userEntitlements.userId, userEntitlements.createdAt);

      const cohortSize = cohortusers.length;

      if (cohortSize === 0) {
        cohorts.push({
          cohort: cohortLabel,
          size: 0,
          retained: 0,
          retentionRate: 0,
          revenue: 0,
          averageLifetime: 0,
        });
        continue;
      }

      // Get how many are still active
      const userIds = cohortusers.map((u) => u.userId);
      const [{ count: retained }] = await db
        .select({ count: sql<number>`count(DISTINCT ${userEntitlements.userId})::int` })
        .from(userEntitlements)
        .where(
          and(inArray(userEntitlements.userId, userIds), eq(userEntitlements.status, 'active'))
        );

      const retentionRate = (retained / cohortSize) * 100;

      // Calculate revenue from this cohort
      const cohortRevenue = await db
        .select({
          pricing: entitlementPlans.pricing,
          billingInterval: userEntitlements.billingInterval,
          count: sql<number>`count(*)::int`,
        })
        .from(userEntitlements)
        .leftJoin(entitlementPlans, eq(userEntitlements.planId, entitlementPlans.id))
        .where(
          and(inArray(userEntitlements.userId, userIds), eq(userEntitlements.status, 'active'))
        )
        .groupBy(entitlementPlans.pricing, userEntitlements.billingInterval);

      let revenue = 0;
      for (const row of cohortRevenue) {
        revenue +=
          getMonthlyPlanAmount({
            pricing: row.pricing as { monthly?: number; yearly?: number } | null,
            billingInterval: row.billingInterval,
            count: 1,
          }) * row.count;
      }

      // Calculate average lifetime (days since creation)
      const lifetimes = cohortusers.map((u) => {
        const daysSince = Math.floor(
          (now.getTime() - new Date(u.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        return daysSince;
      });

      const averageLifetime = lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length;

      cohorts.push({
        cohort: cohortLabel,
        size: cohortSize,
        retained,
        retentionRate,
        revenue,
        averageLifetime,
      });
    }

    return cohorts;
  } catch (error) {
    console.error('Error generating cohort analysis:', error);
    throw new Error('Failed to generate cohort analysis');
  }
}

/**
 * Get comprehensive analytics dashboard data
 */
export async function getDashboardAnalytics(timeframe: AnalyticsTimeframe) {
  try {
    const [revenue, churn, growth] = await Promise.all([
      getRevenueMetrics(timeframe),
      getChurnMetrics(timeframe),
      getGrowthMetrics(timeframe),
    ]);

    // Get usage patterns for all metrics
    const usagePatterns = await Promise.all([
      getUsagePatterns('platform.hooksCreated', timeframe),
      getUsagePatterns('platform.pluginsInstalled', timeframe),
      getUsagePatterns('platform.storageBytes', timeframe),
      getUsagePatterns('platform.apiCalls', timeframe),
    ]);

    return {
      revenue,
      churn,
      growth,
      usagePatterns,
    };
  } catch (error) {
    console.error('Error getting dashboard analytics:', error);
    throw new Error('Failed to get dashboard analytics');
  }
}
