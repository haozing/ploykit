import { apiOk, requireApiSession } from '@host/lib/api';
import { listHostNotifications } from '@host/lib/notifications-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'notifications.history');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ notifications: await listHostNotifications(resolved.session) });
}
