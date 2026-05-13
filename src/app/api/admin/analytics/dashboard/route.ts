import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDashboardAnalytics } from '@/lib/services/audit/analytics-service';
import { withAdminGuard, withErrorHandling, withQueryValidation } from '@/lib/middleware';

/**
 * GET /api/admin/analytics/dashboard
 *
 * Get comprehensive analytics dashboard data
 *
 * Query params:
 * - startDate: ISO date string (required)
 * - endDate: ISO date string (required)
 * - previousStartDate: ISO date string (optional)
 * - previousEndDate: ISO date string (optional)
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
const getDashboardAnalyticsSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  previousStartDate: z.string().datetime().optional(),
  previousEndDate: z.string().datetime().optional(),
});

export const GET = withAdminGuard(
  withErrorHandling(
    withQueryValidation(getDashboardAnalyticsSchema, async (request, { validated }) => {
      // Convert date strings to Date objects
      const query = validated.query!;
      const params = {
        startDate: new Date(query.startDate),
        endDate: new Date(query.endDate),
        previousStartDate: query.previousStartDate ? new Date(query.previousStartDate) : undefined,
        previousEndDate: query.previousEndDate ? new Date(query.previousEndDate) : undefined,
      };

      const analytics = await getDashboardAnalytics(params);

      return NextResponse.json({
        success: true,
        analytics,
      });
    })
  )
);
