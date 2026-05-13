import { NextResponse } from 'next/server';
import { getUserStats } from '@/lib/services/user/user-service';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

/**
 * GET /api/admin/users/stats
 *
 * Get user statistics:
 * - Total users
 * - Active users
 * - Pending users
 * - Suspended users
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async () => {
    const stats = await getUserStats();

    return NextResponse.json(
      {
        success: true,
        stats,
      },
      { status: 200 }
    );
  })
);
