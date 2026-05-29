import { apiOk, readJsonObject, requireApiSession, stringBody } from '@host/lib/api';
import {
  getHostAuthAdapter,
  readHostSessionCookie,
} from '@host/lib/auth';

export async function GET(request: Request) {
  const resolved = await requireApiSession(request, 'auth.sessions');
  if (resolved instanceof Response) {
    return resolved;
  }
  return apiOk({
    sessions: await (await getHostAuthAdapter()).listSessions(resolved.session.userId ?? ''),
  });
}

export async function DELETE(request: Request) {
  const resolved = await requireApiSession(request, 'auth.sessions');
  if (resolved instanceof Response) {
    return resolved;
  }
  const body = await readJsonObject(request);
  const current = readHostSessionCookie(request.headers.get('cookie'));
  const sessionId = stringBody(body, 'sessionId') ?? current?.sessionId;
  if (sessionId && resolved.session.userId) {
    await (await getHostAuthAdapter()).revokeSession(resolved.session.userId, sessionId);
  }
  return apiOk({ revoked: Boolean(sessionId) });
}
