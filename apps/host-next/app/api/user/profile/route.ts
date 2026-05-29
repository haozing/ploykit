import {
  apiError,
  apiOk,
  readJsonObject,
  requireApiSession,
  stringBody,
} from '@host/lib/api';
import {
  getHostUserProfile,
  updateHostUserProfile,
} from '@host/lib/user-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'user.profile');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ profile: await getHostUserProfile(resolved.session) });
}

export async function PATCH(request: Request) {
  const resolved = await requireApiSession(request, 'user.profile');
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  try {
    const profile = await updateHostUserProfile(resolved.session, {
      displayName: stringBody(body, 'displayName', { maxLength: 80 }),
      avatarUrl: stringBody(body, 'avatarUrl', { maxLength: 500 }),
      language: stringBody(body, 'language', { maxLength: 12 }),
      timezone: stringBody(body, 'timezone', { maxLength: 80 }),
    });
    return apiOk({ profile });
  } catch (error) {
    return apiError(400, 'USER_PROFILE_UPDATE_FAILED', 'Unable to update profile.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
