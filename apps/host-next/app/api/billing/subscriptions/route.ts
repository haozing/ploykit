import { apiOk, requireApiSession } from '@host/lib/api';
import { listHostBillingSubscriptions } from '@host/lib/billing-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'billing.subscriptions');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ subscriptions: await listHostBillingSubscriptions(resolved.session) });
}
