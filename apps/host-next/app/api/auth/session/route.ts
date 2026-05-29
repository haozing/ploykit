import {
  getHostAuthAdapter,
  readHostSessionCookie,
  resolveHostSessionFromRequest,
} from '@host/lib/auth';
import { checkHostRouteSecurity } from '@host/lib/security';
import { redactSensitive } from '@/lib/module-runtime/observability/redaction';

export async function GET(request: Request) {
  const session = await resolveHostSessionFromRequest(request);
  const securityResponse = await checkHostRouteSecurity(request, 'auth.session', { session });
  if (securityResponse) {
    return securityResponse;
  }
  const cookie = readHostSessionCookie(request.headers.get('cookie'));
  const sessions =
    session.user && session.userId
      ? await (await getHostAuthAdapter()).listSessions(session.userId)
      : [];
  return Response.json(redactSensitive({
    authenticated: Boolean(session.user),
    user: session.user,
    sessionId: cookie?.sessionId ?? null,
    sessions,
    productId: session.productId,
    workspaceId: session.workspaceId,
    workspaceRole: session.workspaceRole,
  }));
}
