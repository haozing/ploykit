import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { user } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { formatDistanceToNow } from 'date-fns';
import { withAdminGuard, withErrorHandling } from '@/lib/middleware';

/**
 * GET /api/admin/dashboard/recent-users
 *
 * Get recently registered users (last 24 hours or latest 10)
 * Returns simplified user data for dashboard display
 *
 * ACCESS CONTROL:
 * - Requires admin role
 */
export const GET = withAdminGuard(
  withErrorHandling(async () => {
    // Query recent users, ordered by creation date
    const recentUsers = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
      })
      .from(user)
      .orderBy(desc(user.createdAt))
      .limit(10);

    // Format the data for dashboard display
    const formattedUsers = recentUsers.map((u) => ({
      id: u.id,
      name: u.name || 'Unknown User',
      email: u.email,
      image: u.image,
      status: u.emailVerified ? 'active' : 'pending',
      time: formatDistanceToNow(new Date(u.createdAt), { addSuffix: true }),
      createdAt: u.createdAt,
    }));

    return NextResponse.json(
      {
        success: true,
        data: formattedUsers,
      },
      { status: 200 }
    );
  })
);
