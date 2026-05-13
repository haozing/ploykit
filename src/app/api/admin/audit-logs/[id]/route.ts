import { NextRequest, NextResponse } from 'next/server';
import { getAuditLogById } from '@/lib/services/audit/audit-service';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';
import { NotFoundError } from '@/lib/_core/errors';

/**
 * GET /api/admin/audit-logs/[id]
 *
 * Get a single audit log by ID
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async (request: NextRequest, context) => {
    const params = await context.params;
    const { id } = params as unknown as { id: string };
    const log = await getAuditLogById(id);

    if (!log) {
      throw new NotFoundError('Audit log', id);
    }

    return NextResponse.json(log, { status: 200 });
  })
);
