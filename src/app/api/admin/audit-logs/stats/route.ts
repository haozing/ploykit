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
 * - userId: string
 * - action: string
 * - resource: string
 * - status: success | failure
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
      userId?: string;
      action?: string;
      resource?: string;
      status?: 'success' | 'failure';
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

    const userId = searchParams.get('userId')?.trim();
    const action = searchParams.get('action')?.trim();
    const resource = searchParams.get('resource')?.trim();
    const status = searchParams.get('status')?.trim();

    if (userId) {
      filters.userId = userId;
    }

    if (action) {
      filters.action = action;
    }

    if (resource) {
      filters.resource = resource;
    }

    if (status === 'success' || status === 'failure') {
      filters.status = status;
    }

    // Get statistics
    const stats = await getAuditLogStats(filters);

    return NextResponse.json(stats, { status: 200 });
  })
);
