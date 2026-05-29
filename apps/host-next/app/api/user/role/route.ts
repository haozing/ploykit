import { apiOk, requireApiSession } from '@host/lib/api';
import { getHostUserRole } from '@host/lib/user-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'user.role');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ role: await getHostUserRole(resolved.session) });
}
