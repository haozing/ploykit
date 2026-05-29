import { apiOk, requireApiSession } from '@host/lib/api';
import { listAdminPermissions } from '@host/lib/admin-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.permissions', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ permissions: listAdminPermissions() });
}
