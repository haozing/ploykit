import { apiOk, requireApiSession } from '@host/lib/api';
import { markHostNotificationsRead } from '@host/lib/notifications-api';

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'notifications.readAll');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ state: await markHostNotificationsRead(resolved.session) });
}
