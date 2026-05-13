import { NextResponse } from 'next/server';
import { getPlanStats } from '@/lib/services/entitlement/plan-service';
import { getUserEntitlementStats } from '@/lib/services/user/user-entitlement-service';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

/**
 * GET /api/admin/entitlements/stats
 *
 * Get comprehensive entitlement statistics:
 * - Plan counts (total, active, inactive)
 * - User subscription counts (active, trial, cancelled, expired)
 * - Revenue estimates (calculated from active subscriptions)
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async () => {
    // Fetch plan stats and user entitlement stats
    const [planStats, entitlementStats] = await Promise.all([
      getPlanStats(),
      getUserEntitlementStats(),
    ]);

    const estimatedMonthlyRevenue = entitlementStats.active * 49; // Assuming average $49/month

    const stats = {
      plans: {
        total: planStats.total,
        active: planStats.active,
        inactive: planStats.inactive,
      },
      subscriptions: {
        total: entitlementStats.total,
        active: entitlementStats.active,
        trial: entitlementStats.trial,
        cancelled: entitlementStats.cancelled,
      },
      revenue: {
        monthly: estimatedMonthlyRevenue,
        formatted:
          estimatedMonthlyRevenue >= 1000
            ? `$${(estimatedMonthlyRevenue / 1000).toFixed(1)}K`
            : `$${estimatedMonthlyRevenue}`,
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
