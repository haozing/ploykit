import { apiOk, requireApiSession } from '@host/lib/api';
import { listAdminFiles, readAdminApiQuery } from '@host/lib/admin-api';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.files', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk(await listAdminFiles(readAdminApiQuery(request)));
}
