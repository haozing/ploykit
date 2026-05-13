import { NextResponse } from 'next/server';
import { listUnreadNotifications } from '@/lib/services/notifications/notification-service';
import { withAuth, withErrorHandling, type AuthContext } from '@/lib/middleware';

export const GET = withAuth(
  withErrorHandling(async (request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit') || 20);
    const offset = Number(searchParams.get('offset') || 0);
    const notifications = await listUnreadNotifications({
      userId: auth.userId,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      notifications,
    });
  })
);
