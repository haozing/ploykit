import { apiOk, requireApiSession } from '@host/lib/api';
import { getAdminAnalytics, readAdminApiQuery } from '@host/lib/admin-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.analytics', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({
    analytics: await getAdminAnalytics(readAdminApiQuery(request), { session: resolved.session }),
  });
}
