import { apiOk, requireApiSession } from '@host/lib/api';
import { listHostBillingPaymentMethods } from '@host/lib/billing-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'billing.paymentMethods');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ paymentMethods: await listHostBillingPaymentMethods(resolved.session) });
}
