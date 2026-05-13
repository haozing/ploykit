import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  deleteNotification,
  markNotificationRead,
} from '@/lib/services/notifications/notification-service';
import { withAuth, withErrorHandling, type AuthContext, type RouteContext } from '@/lib/middleware';

const paramsSchema = z.object({
  id: z.string().min(1),
});

async function readNotificationId(context: RouteContext<{ id: string }>): Promise<string> {
  const params = paramsSchema.parse(await context.params);
  return params.id;
}

export const PATCH = withAuth<RouteContext<{ id: string }>>(
  withErrorHandling<RouteContext<{ id: string }>>(async (_request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };
    const id = await readNotificationId(context);
    const notification = await markNotificationRead(auth.userId, id);

    return NextResponse.json({
      success: true,
      notification,
    });
  })
);

export const DELETE = withAuth<RouteContext<{ id: string }>>(
  withErrorHandling<RouteContext<{ id: string }>>(async (_request, context) => {
    const { auth } = context as typeof context & { auth: AuthContext };
    const id = await readNotificationId(context);
    const result = await deleteNotification(auth.userId, id);

    return NextResponse.json({
      success: true,
      ...result,
    });
  })
);
