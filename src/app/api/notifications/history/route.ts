import { NextResponse } from 'next/server';
import { listNotificationHistory } from '@/lib/services/notifications/notification-service';
import { withAuth, withErrorHandling, type AuthContext } from '@/lib/middleware';

export const GET = withAuth(
  withErrorHandling(async (request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get('limit') || 50), 100);
    const offset = Number(searchParams.get('offset') || 0);
    const result = await listNotificationHistory({
      userId: auth.userId,
      limit,
      offset,
    });

    return NextResponse.json({
      success: true,
      history: result.notifications,
      pagination: result.pagination,
    });
  })
);
