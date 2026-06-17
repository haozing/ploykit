import { apiOk, requireApiSession } from '@host/lib/api';
import { getAdminRevenue, readAdminApiQuery } from '@host/lib/admin-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.revenue', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk(await getAdminRevenue(readAdminApiQuery(request), { session: resolved.session }));
}
