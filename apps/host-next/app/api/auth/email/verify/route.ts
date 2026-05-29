import { apiError, apiOk, readJsonObject, stringBody } from '@host/lib/api';
import { getHostAuthAdapter } from '@host/lib/auth';
import { languageFromRequest, localizedPath } from '@host/lib/i18n';
import { requestUrl } from '@host/lib/paths';
import { checkHostRouteSecurity } from '@host/lib/security';

async function verifyToken(request: Request, token: string, json: boolean) {
  const lang = languageFromRequest(request);
  try {
    const user = await (await getHostAuthAdapter()).verifyEmail(token);
    if (!json) {
      const url = requestUrl(localizedPath(lang, '/login'), request);
      url.searchParams.set('verified', '1');
      return Response.redirect(url, 303);
    }
    return apiOk({ user: { id: user.id, email: user.email, status: user.status } });
  } catch (error) {
    if (!json) {
      const url = requestUrl(localizedPath(lang, '/login'), request);
      url.searchParams.set('error', 'verify');
      return Response.redirect(url, 303);
    }
    return apiError(400, 'AUTH_EMAIL_VERIFY_FAILED', 'Unable to verify email.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function GET(request: Request) {
  const securityResponse = await checkHostRouteSecurity(request, 'auth.email.verify');
  if (securityResponse) {
    return securityResponse;
  }
  return verifyToken(request, new URL(request.url).searchParams.get('token') ?? '', false);
}

export async function POST(request: Request) {
  const securityResponse = await checkHostRouteSecurity(request, 'auth.email.verify');
  if (securityResponse) {
    return securityResponse;
  }
  const body = await readJsonObject(request);
  return verifyToken(request, stringBody(body, 'token', { required: true }) ?? '', true);
}
