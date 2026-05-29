import { apiOk, readJsonObject, requireApiSession, stringBody } from '@host/lib/api';
import {
  getAdminProviderStatusView,
  recordAdminProviderStatusAudit,
} from '@host/lib/admin-provider-status';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'admin.providers.read', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({ providerStatus: await getAdminProviderStatusView() });
}

export async function POST(request: Request) {
  const resolved = await requireApiSession(request, 'admin.providers.write', { admin: true });
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  const result = await recordAdminProviderStatusAudit(resolved.session, {
    reason: stringBody(body, 'reason', { maxLength: 240 }),
  });
  return apiOk({
    auditId: result.auditId,
    providerStatus: result.providerStatus,
  });
}
