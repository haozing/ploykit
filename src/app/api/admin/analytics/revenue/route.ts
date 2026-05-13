import { NextRequest, NextResponse } from 'next/server';
import { getRevenueMetrics } from '@/lib/services/audit/analytics-service';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { ValidationError } from '@/lib/_core/errors';

/**
 * GET /api/admin/analytics/revenue
 *
 * Get revenue metrics for a timeframe
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async (request: NextRequest) => {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const previousStartDate = searchParams.get('previousStartDate');
    const previousEndDate = searchParams.get('previousEndDate');

    if (!startDate || !endDate) {
      throw new ValidationError('startDate and endDate are required', {
        fields: ['startDate', 'endDate'],
      });
    }

    const metrics = await getRevenueMetrics({
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      previousStartDate: previousStartDate ? new Date(previousStartDate) : undefined,
      previousEndDate: previousEndDate ? new Date(previousEndDate) : undefined,
    });

    return NextResponse.json({
      success: true,
      metrics,
    });
  })
);
