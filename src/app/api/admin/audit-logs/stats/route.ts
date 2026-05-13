import { NextRequest, NextResponse } from 'next/server';
import { getAuditLogStats } from '@/lib/services/audit/audit-service';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

/**
 * GET /api/admin/audit-logs/stats
 *
 * Get audit log statistics (global system)
 *
 * Query params:
 * - startDate: ISO date string
 * - endDate: ISO date string
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async (request: NextRequest) => {
    const searchParams = request.nextUrl.searchParams;

    const filters: {
      startDate?: Date;
      endDate?: Date;
    } = {};

    // Parse dates
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');

    if (startDateStr) {
      filters.startDate = new Date(startDateStr);
    }

    if (endDateStr) {
      filters.endDate = new Date(endDateStr);
    }

    // Get statistics
    const stats = await getAuditLogStats(filters);

    return NextResponse.json(stats, { status: 200 });
  })
);
