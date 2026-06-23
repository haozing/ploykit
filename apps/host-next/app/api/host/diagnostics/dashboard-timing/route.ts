import { resolveHostSessionFromRequest } from '@host/lib/auth';
import { readDashboardTimingReport } from '@host/lib/dashboard-timing';
import { checkHostRouteSecurity } from '@host/lib/security';

export async function GET(request: Request) {
  const session = await resolveHostSessionFromRequest(request);
  const securityResponse = await checkHostRouteSecurity(
    request,
    'host.diagnostics.dashboardTiming',
    { session }
  );
  if (securityResponse) {
    return securityResponse;
  }

  const adminAllowed = session.user?.role === 'admin';
  if (!adminAllowed) {
    return Response.json(
      {
        ok: false,
        code: session.user ? 'ADMIN_REQUIRED' : 'AUTH_REQUIRED',
        message: session.user
          ? 'Admin access is required for dashboard timing diagnostics.'
          : 'Authentication is required for dashboard timing diagnostics.',
      },
      { status: session.user ? 403 : 401 }
    );
  }

  const requestId = new URL(request.url).searchParams.get('requestId')?.trim();
  if (!requestId) {
    return Response.json(
      {
        ok: false,
        code: 'DASHBOARD_TIMING_REQUEST_ID_REQUIRED',
        message: 'requestId is required.',
      },
      { status: 400 }
    );
  }

  const report = readDashboardTimingReport(requestId);
  if (!report) {
    return Response.json(
      {
        ok: false,
        code: 'DASHBOARD_TIMING_NOT_FOUND',
        message: 'Dashboard timing report was not found or expired.',
        requestId,
      },
      { status: 404 }
    );
  }

  return Response.json({ ok: true, requestId, report });
}
