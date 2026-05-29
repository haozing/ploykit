import { requireAdminRequestContext } from '@host/lib/request-context';
import { checkHostRouteSecurity } from '@host/lib/security';
import { drainHostWorker } from '@host/lib/worker';

export async function POST(request: Request) {
  const { session } = await requireAdminRequestContext(request, '/admin/webhooks');
  const securityResponse = await checkHostRouteSecurity(request, 'worker.drain', { session });
  if (securityResponse) {
    return securityResponse;
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? 25);
  const drain = await drainHostWorker({
    session,
    limit: Number.isFinite(limit) ? limit : 25,
  });
  return Response.json({ ok: true, drain });
}
