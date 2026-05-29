import { apiOk, requireApiSession } from '@host/lib/api';
import { markHostNotificationRead } from '@host/lib/notifications-api';

interface NotificationReadRouteContext {
  params: Promise<{
    notificationId: string;
  }>;
}

export async function POST(request: Request, context: NotificationReadRouteContext) {
  const resolved = await requireApiSession(request, 'notifications.read');
  if (resolved instanceof Response) {
    return resolved;
  }
  const { notificationId } = await context.params;
  return apiOk({ notification: await markHostNotificationRead(resolved.session, notificationId) });
}
