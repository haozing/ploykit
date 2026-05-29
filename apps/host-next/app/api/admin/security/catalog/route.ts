import { resolveHostSessionFromRequest } from '@host/lib/auth';
import { auditDiscoveredHostApiRoutes } from '@host/lib/route-security-audit';
import { checkHostRouteSecurity, getHostRouteCatalog } from '@host/lib/security';
import { auditAdminRegistry, getAdminRegistryEntries } from '@host/lib/admin-route-registry';

export async function GET(request: Request) {
  const session = await resolveHostSessionFromRequest(request);
  const securityResponse = await checkHostRouteSecurity(request, 'admin.security.catalog', {
    session,
  });
  if (securityResponse) {
    return securityResponse;
  }

  if (!session.user) {
    return Response.json({ ok: false, code: 'AUTH_REQUIRED' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return Response.json({ ok: false, code: 'ADMIN_REQUIRED' }, { status: 403 });
  }

  return Response.json({
    ok: true,
    routes: getHostRouteCatalog(),
    audit: auditDiscoveredHostApiRoutes(process.cwd()),
    adminRegistry: {
      entries: getAdminRegistryEntries(),
      audit: auditAdminRegistry(),
    },
  });
}
