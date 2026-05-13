import { NextRequest, NextResponse } from 'next/server';
import { getChurnMetrics } from '@/lib/services/audit/analytics-service';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { ValidationError } from '@/lib/_core/errors';

/**
 * GET /api/admin/analytics/churn
 *
 * Get churn metrics for a timeframe
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(
    async (request: NextRequest, _context: { params: Promise<Record<string, unknown>> }) => {
      const { searchParams } = new URL(request.url);
      const startDate = searchParams.get('startDate');
      const endDate = searchParams.get('endDate');

      if (!startDate || !endDate) {
        throw new ValidationError('startDate and endDate are required', {
          fields: ['startDate', 'endDate'],
        });
      }

      const metrics = await getChurnMetrics({
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      });

      return NextResponse.json({
        success: true,
        metrics,
      });
    }
  )
);
