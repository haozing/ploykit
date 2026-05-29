import { apiOk, requireApiSession } from '@host/lib/api';
import { listProductScopeProducts } from '@host/lib/product-scope-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'productScope.products');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ products: await listProductScopeProducts(resolved.session) });
}
