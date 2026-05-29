import { apiOk, requireApiSession } from '@host/lib/api';
import { getCurrentProductScope } from '@host/lib/product-scope-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'productScope.current');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ scope: await getCurrentProductScope(resolved.session) });
}
