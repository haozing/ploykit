import { apiOk, requireApiSession } from '@host/lib/api';
import { createHostBillingPortal } from '@host/lib/billing-api';
import { languageFromRequest } from '@host/lib/i18n';

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'billing.portal');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({
    portal: await createHostBillingPortal(resolved.session, languageFromRequest(request)),
  });
}
