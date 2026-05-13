import { NextResponse } from 'next/server';
import { getRoleStats } from '@/lib/services/rbac/role-service';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

/**
 * GET /api/admin/roles/stats
 *
 * Get role statistics:
 * - Total roles
 * - System roles
 * - Total role assignments
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async () => {
    const stats = await getRoleStats();

    return NextResponse.json(
      {
        success: true,
        data: stats,
      },
      { status: 200 }
    );
  })
);
