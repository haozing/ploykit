import {
  apiError,
  apiOk,
  readJsonObject,
  requireApiSession,
  stringBody,
} from '@host/lib/api';
import { updateHostUserProfile } from '@host/lib/user-api';

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'user.profile.avatar');
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  try {
    const avatarUrl = stringBody(body, 'avatarUrl', { required: true, maxLength: 500 });
    const profile = await updateHostUserProfile(resolved.session, { avatarUrl });
    return apiOk({ profile });
  } catch (error) {
    return apiError(400, 'USER_AVATAR_UPDATE_FAILED', 'Unable to update avatar.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
