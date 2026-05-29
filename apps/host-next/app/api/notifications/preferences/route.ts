import { apiOk, readJsonObject, requireApiSession } from '@host/lib/api';
import {
  getHostNotificationPreferences,
  updateHostNotificationPreferences,
} from '@host/lib/notifications-api';

function booleanBody(body: Record<string, unknown>, key: string): boolean | undefined {
  return typeof body[key] === 'boolean' ? body[key] : undefined;
}

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'notifications.preferences');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ preferences: await getHostNotificationPreferences(resolved.session) });
}

export async function PATCH(request: Request) {
  const resolved = await requireApiSession(request, 'notifications.preferences');
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  const preferences = await updateHostNotificationPreferences(resolved.session, {
    inApp: booleanBody(body, 'inApp'),
    email: booleanBody(body, 'email'),
    billing: booleanBody(body, 'billing'),
    files: booleanBody(body, 'files'),
    admin: booleanBody(body, 'admin'),
  });
  return apiOk({ preferences });
}
