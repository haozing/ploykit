import { apiOk, requireApiSession } from '@host/lib/api';
import { listAdminUsage, readAdminApiQuery } from '@host/lib/admin-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.usage', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk(await listAdminUsage(readAdminApiQuery(request)));
}
