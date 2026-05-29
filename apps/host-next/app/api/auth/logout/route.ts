import { clearHostSessionCookie, revokeHostSessionFromCookieHeader, safeRedirectPath } from '@host/lib/auth';
import { languageFromRequest, localizedPath } from '@host/lib/i18n';
import { requestUrl } from '@host/lib/paths';
import { checkHostRouteSecurity } from '@host/lib/security';

function redirectClearingCookie(location: URL): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: location.toString(),
      'set-cookie': clearHostSessionCookie(),
    },
  });
}

export async function POST(request: Request) {
  const securityResponse = await checkHostRouteSecurity(request, 'auth.logout');
  if (securityResponse) {
    return securityResponse;
  }

  const formData = await request.formData().catch(() => new FormData());
  const lang = languageFromRequest(request);
  const nextPath = safeRedirectPath(formData.get('next'), localizedPath(lang, '/login'));
  await revokeHostSessionFromCookieHeader(request.headers.get('cookie'));
  return redirectClearingCookie(requestUrl(nextPath, request));
}

export async function GET(request: Request) {
  const securityResponse = await checkHostRouteSecurity(request, 'auth.logout');
  if (securityResponse) {
    return securityResponse;
  }
  const lang = languageFromRequest(request);
  await revokeHostSessionFromCookieHeader(request.headers.get('cookie'));
  return redirectClearingCookie(requestUrl(localizedPath(lang, '/login'), request));
}
