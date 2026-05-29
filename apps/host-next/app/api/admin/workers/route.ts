import { apiOk, requireApiSession } from '@host/lib/api';
import { getAdminWorkerStatusView } from '@host/lib/admin-worker-status';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.workers', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ workerStatus: await getAdminWorkerStatusView() });
}
