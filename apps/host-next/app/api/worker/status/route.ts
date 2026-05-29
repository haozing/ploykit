import { resolveHostSessionFromRequest } from '@host/lib/auth';
import { checkHostRouteSecurity } from '@host/lib/security';
import { getHostWorkerStatus } from '@host/lib/worker';

export async function GET(request: Request) {
  const session = await resolveHostSessionFromRequest(request);
  const securityResponse = await checkHostRouteSecurity(request, 'worker.status', { session });
  if (securityResponse) {
    return securityResponse;
  }

  if (!session.user) {
    return Response.json({ ok: false, code: 'AUTH_REQUIRED' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return Response.json({ ok: false, code: 'ADMIN_REQUIRED' }, { status: 403 });
  }

  return Response.json({ ok: true, worker: await getHostWorkerStatus() });
}
