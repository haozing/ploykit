import { NextResponse } from 'next/server';
import { sendTestNotification } from '@/lib/services/notifications/notification-service';
import { withAuth, withErrorHandling, type AuthContext } from '@/lib/middleware';

export const POST = withAuth(
  withErrorHandling(async (_request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };
    const notification = await sendTestNotification(auth.userId);

    return NextResponse.json({
      success: true,
      queued: Boolean(notification),
      notification,
      message: notification
        ? 'Test notification accepted.'
        : 'Test notification skipped by preferences.',
    });
  })
);
