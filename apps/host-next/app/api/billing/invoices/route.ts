import { apiOk, requireApiSession } from '@host/lib/api';
import { listHostBillingInvoices } from '@host/lib/billing-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'billing.invoices');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ invoices: await listHostBillingInvoices(resolved.session) });
}
