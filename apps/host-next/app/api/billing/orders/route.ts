import { apiOk, requireApiSession } from '@host/lib/api';
import { listHostBillingOrders } from '@host/lib/billing-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'billing.orders');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ orders: await listHostBillingOrders(resolved.session) });
}
