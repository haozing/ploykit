import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { user, roles, userEntitlements, pluginInstallations } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { subDays, format, endOfDay } from 'date-fns';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

/**
 * GET /api/admin/analytics/usage-trends
 *
 * Get historical usage trends for various metrics (cumulative totals per day)
 *
 * Query params:
 * - days: number (default: 30) - Number of days to look back
 * - metric: string (users|roles|subscriptions|plugins|all)
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async (request: Request) => {
    const { searchParams } = new URL(request.url);
    const days = parseInt(searchParams.get('days') || '30', 10);
    const metric = searchParams.get('metric') || 'all';

    // Calculate date range
    const endDate = new Date();
    const startDate = subDays(endDate, days);

    // Generate date labels and date array
    const dateLabels: string[] = [];
    const datePoints: Date[] = [];
    for (let i = 0; i <= days; i++) {
      const date = subDays(endDate, days - i);
      dateLabels.push(format(date, 'MMM dd'));
      datePoints.push(endOfDay(date));
    }

    // Initialize response object
    const response: Record<string, unknown> = {
      dateLabels,
      period: `${format(startDate, 'MMM dd, yyyy')} - ${format(endDate, 'MMM dd, yyyy')}`,
      days,
    };

    // Helper function to calculate cumulative counts for each date
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function getCumulativeCounts(table: any, dateColumn: unknown, datePoints: Date[]) {
      // Get counts grouped by created_at date
      const dailyCounts = await db
        .select({
          date: sql<string>`DATE(${dateColumn})`,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(table)
        .groupBy(sql`DATE(${dateColumn})`);

      // Create map of date to count
      const countMap = new Map<string, number>();
      dailyCounts.forEach((row) => {
        countMap.set(row.date, Number(row.count));
      });

      // Calculate cumulative totals for each date point
      const cumulativeCounts: number[] = [];
      let runningTotal = 0;

      for (const datePoint of datePoints) {
        // Add all counts up to and including this date
        const dateKey = format(datePoint, 'yyyy-MM-dd');
        const dailyCount = countMap.get(dateKey) || 0;
        runningTotal += dailyCount;
        cumulativeCounts.push(runningTotal);
      }

      return cumulativeCounts;
    }

    // Fetch users trend (cumulative)
    if (metric === 'users' || metric === 'all') {
      const usersTrendData = await getCumulativeCounts(user, user.createdAt, datePoints);

      response.users = {
        label: 'Total Users',
        data: usersTrendData,
        growth:
          usersTrendData.length > 1
            ? Math.round(
                ((usersTrendData[usersTrendData.length - 1] - usersTrendData[0]) /
                  (usersTrendData[0] || 1)) *
                  100
              )
            : 0,
      };
    }

    // Fetch roles trend (cumulative)
    if (metric === 'roles' || metric === 'all') {
      const rolesTrendData = await getCumulativeCounts(roles, roles.createdAt, datePoints);

      response.roles = {
        label: 'Total Roles',
        data: rolesTrendData,
        growth:
          rolesTrendData.length > 1
            ? Math.round(
                ((rolesTrendData[rolesTrendData.length - 1] - rolesTrendData[0]) /
                  (rolesTrendData[0] || 1)) *
                  100
              )
            : 0,
      };
    }

    // Fetch plugin installation trend (cumulative)
    if (metric === 'plugins' || metric === 'all') {
      const pluginsTrendData = await getCumulativeCounts(
        pluginInstallations,
        pluginInstallations.installedAt,
        datePoints
      );

      response.plugins = {
        label: 'Total Plugins',
        data: pluginsTrendData,
        growth:
          pluginsTrendData.length > 1
            ? Math.round(
                ((pluginsTrendData[pluginsTrendData.length - 1] - pluginsTrendData[0]) /
                  (pluginsTrendData[0] || 1)) *
                  100
              )
            : 0,
      };
    }

    // Fetch user subscriptions trend (cumulative)
    if (metric === 'subscriptions' || metric === 'all') {
      const subsTrendData = await getCumulativeCounts(
        userEntitlements,
        userEntitlements.createdAt,
        datePoints
      );

      response.subscriptions = {
        label: 'Total User Subscriptions',
        data: subsTrendData,
        growth:
          subsTrendData.length > 1
            ? Math.round(
                ((subsTrendData[subsTrendData.length - 1] - subsTrendData[0]) /
                  (subsTrendData[0] || 1)) *
                  100
              )
            : 0,
      };
    }

    return NextResponse.json(
      {
        success: true,
        data: response,
      },
      { status: 200 }
    );
  })
);
