import { NextResponse } from 'next/server';
import { getUserStats } from '@/lib/services/user/user-service';
import { getRoleStats } from '@/lib/services/rbac/role-service';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { db } from '@/lib/db';
import { pluginInstallations, usageHistory, user, userEntitlements } from '@/lib/db/schema';
import { and, gte, lt, sql } from 'drizzle-orm';

const DASHBOARD_STATS_RANGE_DAYS = 30;

/**
 * GET /api/admin/dashboard/stats
 *
 * Get comprehensive dashboard statistics:
 * - Total users and growth
 * - Active roles
 * - Plugin statistics
 * - Usage event count from the local usage ledger
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async () => {
    // Fetch all stats in parallel
    const [userStats, roleStats, userGrowth, subscriptionStats, pluginStats, usageEventStats] =
      await Promise.all([
        getUserStats(),
        getRoleStats(),
        getUserGrowthStats(),
        getSubscriptionStats(),
        getPluginStats(),
        getUsageEventStats(),
      ]);

    const stats = {
      users: {
        total: userStats.total || 0,
        growth: formatSignedPercent(userGrowth.growthRate),
        growthValue: userGrowth.current,
      },
      subscriptions: {
        total: subscriptionStats.total,
        active: subscriptionStats.active,
        summary: {
          code: 'activeEntitlements',
          count: subscriptionStats.active,
        },
      },
      roles: {
        total: roleStats.total || 0,
        active: roleStats.assigned || 0,
        summary: {
          code: 'activeAssignments',
          count: roleStats.assigned || 0,
        },
      },
      plugins: {
        total: pluginStats.total,
        enabled: pluginStats.enabled,
        summary: {
          code: 'enabledPlugins',
          count: pluginStats.enabled,
        },
      },
      apiRequests: {
        total: formatCompactNumber(usageEventStats.current),
        growth: formatSignedPercent(usageEventStats.growthRate),
        trend: getTrend(usageEventStats.growthRate),
      },
      meta: {
        rangeDays: DASHBOARD_STATS_RANGE_DAYS,
        usageSource: 'usage_history',
      },
    };

    return NextResponse.json(
      {
        success: true,
        data: stats,
      },
      { status: 200 }
    );
  })
);

async function getUserGrowthStats() {
  const { currentStart, previousStart } = getRangeWindows();

  const [currentResult, previousResult] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(user)
      .where(gte(user.createdAt, currentStart)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(user)
      .where(and(gte(user.createdAt, previousStart), lt(user.createdAt, currentStart))),
  ]);

  const current = Number(currentResult[0]?.count || 0);
  const previous = Number(previousResult[0]?.count || 0);

  return {
    current,
    previous,
    growthRate: calculateGrowthRate(current, previous),
  };
}

async function getSubscriptionStats() {
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where ${userEntitlements.status} = 'active')::int`,
    })
    .from(userEntitlements);

  return {
    total: Number(counts?.total || 0),
    active: Number(counts?.active || 0),
  };
}

async function getPluginStats() {
  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      enabled: sql<number>`count(*) filter (where ${pluginInstallations.enabled} = true)::int`,
    })
    .from(pluginInstallations);

  return {
    total: Number(counts?.total || 0),
    enabled: Number(counts?.enabled || 0),
  };
}

async function getUsageEventStats() {
  const { currentStart, previousStart } = getRangeWindows();

  const [currentResult, previousResult] = await Promise.all([
    db
      .select({ total: sql<number>`coalesce(sum(${usageHistory.value}), 0)::int` })
      .from(usageHistory)
      .where(gte(usageHistory.recordedAt, currentStart)),
    db
      .select({ total: sql<number>`coalesce(sum(${usageHistory.value}), 0)::int` })
      .from(usageHistory)
      .where(
        and(gte(usageHistory.recordedAt, previousStart), lt(usageHistory.recordedAt, currentStart))
      ),
  ]);

  const current = Number(currentResult[0]?.total || 0);
  const previous = Number(previousResult[0]?.total || 0);

  return {
    current,
    previous,
    growthRate: calculateGrowthRate(current, previous),
  };
}

function getRangeWindows() {
  const now = new Date();
  const currentStart = new Date(now.getTime() - DASHBOARD_STATS_RANGE_DAYS * 24 * 60 * 60 * 1000);
  const previousStart = new Date(
    currentStart.getTime() - DASHBOARD_STATS_RANGE_DAYS * 24 * 60 * 60 * 1000
  );

  return {
    currentStart,
    previousStart,
  };
}

function calculateGrowthRate(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0;
  }

  return ((current - previous) / previous) * 100;
}

function formatSignedPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

function getTrend(value: number): 'up' | 'down' | 'flat' {
  if (value > 0) {
    return 'up';
  }

  if (value < 0) {
    return 'down';
  }

  return 'flat';
}

function formatCompactNumber(value: number): string {
  if (value < 1000) {
    return String(value);
  }

  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}
