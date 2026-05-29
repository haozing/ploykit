import { apiOk, requireApiSession } from '@host/lib/api';
import { reconcileHostBillingPaidOrderBenefits } from '@host/lib/commercial-provider';

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'admin.revenue.reconcile', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ reconcile: await reconcileHostBillingPaidOrderBenefits(resolved.session) });
}
