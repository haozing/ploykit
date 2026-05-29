import { apiOk, requireApiSession } from '@host/lib/api';
import { getAdminServiceConnections } from '@host/lib/admin-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.serviceConnections', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ serviceConnections: await getAdminServiceConnections() });
}
