import { apiOk, requireApiSession } from '@host/lib/api';
import { listAdminUsers, readAdminApiQuery } from '@host/lib/admin-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.users', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk(await listAdminUsers(readAdminApiQuery(request)));
}
