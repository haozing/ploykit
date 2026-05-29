import {
  authenticateHostUser,
  getHostAuthAdapter,
  safeRedirectPath,
} from '@host/lib/auth';
import { languageFromRequest, localizedDashboardPath, localizedPath } from '@host/lib/i18n';
import { requestUrl } from '@host/lib/paths';
import { checkHostRouteSecurity } from '@host/lib/security';

function redirectWithCookie(location: URL, cookie: string): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: location.toString(),
      'set-cookie': cookie,
    },
  });
}

export async function POST(request: Request) {
  const securityResponse = await checkHostRouteSecurity(request, 'auth.login');
  if (securityResponse) {
    return securityResponse;
  }

  const formData = await request.formData();
  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const lang = languageFromRequest(request);
  const nextPath = safeRedirectPath(formData.get('next'), localizedDashboardPath(lang));
  const user = await authenticateHostUser(email, password);

  if (!user) {
    const url = requestUrl(localizedPath(lang, '/login'), request);
    url.searchParams.set('error', 'invalid');
    url.searchParams.set('next', nextPath);
    return Response.redirect(url, 303);
  }

  const { cookie } = await (await getHostAuthAdapter()).createSession(user, {
    userAgent: request.headers.get('user-agent') ?? undefined,
  });
  return redirectWithCookie(requestUrl(nextPath, request), cookie);
}
