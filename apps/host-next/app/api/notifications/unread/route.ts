import { apiOk, requireApiSession } from '@host/lib/api';
import { getHostUnreadNotificationCount } from '@host/lib/notifications-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'notifications.unread');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ unread: await getHostUnreadNotificationCount(resolved.session) });
}
