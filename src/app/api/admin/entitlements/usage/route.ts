import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { usageHistory, user as betterAuthUser } from '@/lib/db/schema';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { ValidationError } from '@/lib/_core/errors';

const METRIC_FILTER_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}(?:\.[a-zA-Z][a-zA-Z0-9_-]{0,63})+$/;

/**
 * GET /api/admin/entitlements/usage
 *
 * Get usage analytics based on usage_history (quota events).
 *
 * Returned data is intended for admin dashboards:
 * - Top quota metrics aggregated by `${pluginId}.${metric}`
 * - Top users by total usage events
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async (request: Request) => {
    const { searchParams } = new URL(request.url);
    const rangeDays = readIntegerParam(searchParams, 'days', 30, { min: 1, max: 365 });
    const limit = readIntegerParam(searchParams, 'limit', 10, { min: 1, max: 50 });
    const metricFilter = readMetricFilter(searchParams.get('metric'));
    const userIdFilter = readUserIdFilter(searchParams.get('userId'));

    const endAt = new Date();
    const startAt = new Date(endAt.getTime() - rangeDays * 24 * 60 * 60 * 1000);
    const conditions = [gte(usageHistory.recordedAt, startAt)];

    if (metricFilter) {
      const [pluginId, ...metricSegments] = metricFilter.split('.');
      conditions.push(eq(usageHistory.pluginId, pluginId));
      conditions.push(eq(usageHistory.metric, metricSegments.join('.')));
    }

    if (userIdFilter) {
      conditions.push(eq(usageHistory.userId, userIdFilter));
    }

    const whereClause = and(...conditions);

    const totalEventsResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(usageHistory)
      .where(whereClause);
    const totalEvents = Number(totalEventsResult[0]?.count || 0);

    const topMetricsRows = await db
      .select({
        pluginId: usageHistory.pluginId,
        metric: usageHistory.metric,
        total: sql<number>`sum(${usageHistory.value})`,
      })
      .from(usageHistory)
      .where(whereClause)
      .groupBy(usageHistory.pluginId, usageHistory.metric)
      .orderBy(desc(sql`sum(${usageHistory.value})`))
      .limit(limit);

    const topUsersRows = await db
      .select({
        userId: usageHistory.userId,
        userName: betterAuthUser.name,
        userEmail: betterAuthUser.email,
        total: sql<number>`sum(${usageHistory.value})`,
      })
      .from(usageHistory)
      .leftJoin(betterAuthUser, eq(usageHistory.userId, betterAuthUser.id))
      .where(whereClause)
      .groupBy(usageHistory.userId, betterAuthUser.name, betterAuthUser.email)
      .orderBy(desc(sql`sum(${usageHistory.value})`))
      .limit(limit);

    const recentRows = await db
      .select({
        id: usageHistory.id,
        userId: usageHistory.userId,
        userName: betterAuthUser.name,
        userEmail: betterAuthUser.email,
        pluginId: usageHistory.pluginId,
        metric: usageHistory.metric,
        value: usageHistory.value,
        unit: usageHistory.unit,
        recordedAt: usageHistory.recordedAt,
      })
      .from(usageHistory)
      .leftJoin(betterAuthUser, eq(usageHistory.userId, betterAuthUser.id))
      .where(whereClause)
      .orderBy(desc(usageHistory.recordedAt))
      .limit(limit);

    const response = {
      rangeDays,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      filters: {
        metric: metricFilter,
        userId: userIdFilter,
        limit,
      },
      totalEvents,
      topMetrics: topMetricsRows.map((row) => ({
        key: `${row.pluginId}.${row.metric}`,
        total: Number(row.total || 0),
      })),
      topUsers: topUsersRows.map((row) => ({
        userId: row.userId,
        userName: row.userName ?? null,
        userEmail: row.userEmail ?? null,
        total: Number(row.total || 0),
      })),
      recentEvents: recentRows.map((row) => ({
        id: row.id,
        userId: row.userId,
        userName: row.userName ?? null,
        userEmail: row.userEmail ?? null,
        key: `${row.pluginId}.${row.metric}`,
        value: row.value,
        unit: row.unit,
        recordedAt: row.recordedAt.toISOString(),
      })),
    };

    return NextResponse.json(
      {
        success: true,
        data: response,
      },
      { status: 200 }
    );
  })
);

function readIntegerParam(
  searchParams: URLSearchParams,
  key: string,
  fallback: number,
  range: { min: number; max: number }
) {
  const raw = searchParams.get(key);
  if (raw === null || raw === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < range.min || value > range.max) {
    throw new ValidationError(`${key} must be an integer between ${range.min} and ${range.max}`);
  }

  return value;
}

function readMetricFilter(value: string | null) {
  if (!value || value === 'all') {
    return null;
  }

  if (!METRIC_FILTER_PATTERN.test(value)) {
    throw new ValidationError('metric must use a scoped key such as platform.apiCalls');
  }

  return value;
}

function readUserIdFilter(value: string | null) {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 128) {
    throw new ValidationError('userId must be a non-empty identifier up to 128 characters');
  }

  return trimmed;
}
