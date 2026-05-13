import { NextResponse } from 'next/server';

import { markAllNotificationsRead } from '@/lib/services/notifications/notification-service';
import { withAuth, withErrorHandling, type AuthContext } from '@/lib/middleware';

export const POST = withAuth(
  withErrorHandling(async (_request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };
    const result = await markAllNotificationsRead(auth.userId);

    return NextResponse.json({
      success: true,
      ...result,
    });
  })
);
