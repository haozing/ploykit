import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { user, roles, userEntitlements, pluginInstallations } from '@/lib/db/schema';
import { sql, gte } from 'drizzle-orm';
import { subDays, format, startOfDay } from 'date-fns';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

/**
 * GET /api/admin/analytics/growth-trends
 *
 * Get daily growth trends (new additions per day)
 *
 * Query params:
 * - days: number (default: 30) - Number of days to look back
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async (request: Request) => {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);

    // Calculate date range
    const endDate = new Date();
    const startDate = startOfDay(subDays(endDate, days));

    // Generate date labels and date map for quick lookup
    const dateLabels: string[] = [];
    const dateMap = new Map<string, number>();
    for (let i = 0; i <= days; i++) {
      const date = subDays(endDate, days - i);
      const dateKey = format(date, 'yyyy-MM-dd');
      dateLabels.push(format(date, 'MMM dd'));
      dateMap.set(dateKey, i);
    }

    // Optimized: Fetch all daily new users with single query
    const usersResults = await db
      .select({
        date: sql<string>`DATE(${user.createdAt})`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(user)
      .where(gte(user.createdAt, startDate))
      .groupBy(sql`DATE(${user.createdAt})`);

    // Optimized: Fetch all daily new roles with single query
    const rolesResults = await db
      .select({
        date: sql<string>`DATE(${roles.createdAt})`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(roles)
      .where(gte(roles.createdAt, startDate))
      .groupBy(sql`DATE(${roles.createdAt})`);

    // Optimized: Fetch all daily new plugin installations with single query
    const pluginResults = await db
      .select({
        date: sql<string>`DATE(${pluginInstallations.installedAt})`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(pluginInstallations)
      .where(gte(pluginInstallations.installedAt, startDate))
      .groupBy(sql`DATE(${pluginInstallations.installedAt})`);

    // Optimized: Fetch all daily new user subscriptions with single query
    const subsResults = await db
      .select({
        date: sql<string>`DATE(${userEntitlements.createdAt})`,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(userEntitlements)
      .where(gte(userEntitlements.createdAt, startDate))
      .groupBy(sql`DATE(${userEntitlements.createdAt})`);

    // Map results to arrays (filling in zeros for days with no data)
    const newUsersData: number[] = new Array(days + 1).fill(0);
    const newRolesData: number[] = new Array(days + 1).fill(0);
    const newPluginsData: number[] = new Array(days + 1).fill(0);
    const newSubsData: number[] = new Array(days + 1).fill(0);

    usersResults.forEach((row) => {
      const idx = dateMap.get(row.date);
      if (idx !== undefined) newUsersData[idx] = Number(row.count);
    });

    rolesResults.forEach((row) => {
      const idx = dateMap.get(row.date);
      if (idx !== undefined) newRolesData[idx] = Number(row.count);
    });

    pluginResults.forEach((row) => {
      const idx = dateMap.get(row.date);
      if (idx !== undefined) newPluginsData[idx] = Number(row.count);
    });

    subsResults.forEach((row) => {
      const idx = dateMap.get(row.date);
      if (idx !== undefined) newSubsData[idx] = Number(row.count);
    });

    // Calculate totals and averages
    const totalNewUsers = newUsersData.reduce((sum, val) => sum + val, 0);
    const totalNewRoles = newRolesData.reduce((sum, val) => sum + val, 0);
    const totalNewPlugins = newPluginsData.reduce((sum, val) => sum + val, 0);
    const totalNewSubs = newSubsData.reduce((sum, val) => sum + val, 0);

    const avgNewUsers = Math.round(totalNewUsers / (days + 1));
    const avgNewRoles = Math.round(totalNewRoles / (days + 1));
    const avgNewPlugins = Math.round(totalNewPlugins / (days + 1));
    const avgNewSubs = Math.round(totalNewSubs / (days + 1));

    const response = {
      dateLabels,
      period: `${format(startDate, 'MMM dd, yyyy')} - ${format(endDate, 'MMM dd, yyyy')}`,
      days,
      newUsers: {
        label: 'New Users per Day',
        data: newUsersData,
        total: totalNewUsers,
        average: avgNewUsers,
      },
      newRoles: {
        label: 'New Roles per Day',
        data: newRolesData,
        total: totalNewRoles,
        average: avgNewRoles,
      },
      newPlugins: {
        label: 'New Plugins per Day',
        data: newPluginsData,
        total: totalNewPlugins,
        average: avgNewPlugins,
      },
      newSubscriptions: {
        label: 'New User Subscriptions per Day',
        data: newSubsData,
        total: totalNewSubs,
        average: avgNewSubs,
      },
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
