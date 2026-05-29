import {
  apiError,
  apiOk,
  readJsonObject,
  requireApiSession,
  stringBody,
} from '@host/lib/api';
import { changeHostUserPassword } from '@host/lib/user-api';

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'user.profile.password');
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  try {
    await changeHostUserPassword(resolved.session, {
      currentPassword: stringBody(body, 'currentPassword', { required: true }) ?? '',
      newPassword: stringBody(body, 'newPassword', { required: true }) ?? '',
    });
    return apiOk({ changed: true });
  } catch (error) {
    return apiError(400, 'USER_PASSWORD_CHANGE_FAILED', 'Unable to change password.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
