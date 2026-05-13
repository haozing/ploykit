import { NextRequest, NextResponse } from 'next/server';
import { getCohortAnalysis } from '@/lib/services/audit/analytics-service';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { ValidationError } from '@/lib/_core/errors';

/**
 * GET /api/admin/analytics/cohorts
 *
 * Get cohort retention analysis
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async (request: NextRequest) => {
    const { searchParams } = new URL(request.url);
    const months = parseInt(searchParams.get('months') || '12', 10);

    if (months < 1 || months > 24) {
      throw new ValidationError('months must be between 1 and 24', {
        field: 'months',
        minimum: 1,
        maximum: 24,
      });
    }

    const cohorts = await getCohortAnalysis(months);

    return NextResponse.json({
      success: true,
      cohorts,
    });
  })
);
