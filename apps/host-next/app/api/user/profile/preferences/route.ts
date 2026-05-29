import { apiOk, readJsonObject, requireApiSession } from '@host/lib/api';
import {
  getHostUserProfile,
  updateHostUserPreferences,
} from '@host/lib/user-api';

function booleanBody(body: Record<string, unknown>, key: string): boolean | undefined {
  return typeof body[key] === 'boolean' ? body[key] : undefined;
}

function stringArrayBody(body: Record<string, unknown>, key: string): string[] | undefined {
  return Array.isArray(body[key])
    ? body[key].filter((value): value is string => typeof value === 'string')
    : undefined;
}

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'user.profile.preferences');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ preferences: (await getHostUserProfile(resolved.session)).preferences });
}

export async function PATCH(request: Request) {
  const resolved = await requireApiSession(request, 'user.profile.preferences');
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  const preferences = await updateHostUserPreferences(resolved.session, {
    inApp: booleanBody(body, 'inApp'),
    email: booleanBody(body, 'email'),
    billing: booleanBody(body, 'billing'),
    files: booleanBody(body, 'files'),
    admin: booleanBody(body, 'admin'),
    searchRecent: stringArrayBody(body, 'searchRecent'),
  });
  return apiOk({ preferences });
}
