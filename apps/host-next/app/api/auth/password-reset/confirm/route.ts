import { apiError, apiOk, readJsonObject, stringBody } from '@host/lib/api';
import { getHostAuthAdapter } from '@host/lib/auth';
import { languageFromRequest, localizedPath } from '@host/lib/i18n';
import { requestUrl } from '@host/lib/paths';
import { checkHostRouteSecurity } from '@host/lib/security';

export async function POST(request: Request) {
  const securityResponse = await checkHostRouteSecurity(request, 'auth.passwordReset.confirm');
  if (securityResponse) {
    return securityResponse;
  }

  const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
  const body = isJson ? await readJsonObject(request) : Object.fromEntries((await request.formData()).entries());
  const lang = languageFromRequest(request);
  try {
    const user = await (await getHostAuthAdapter()).resetPassword(
      stringBody(body, 'token', { required: true }) ?? '',
      stringBody(body, 'password', { required: true }) ?? ''
    );
    if (!isJson) {
      const url = requestUrl(localizedPath(lang, '/login'), request);
      url.searchParams.set('reset', 'done');
      return Response.redirect(url, 303);
    }
    return apiOk({ user: { id: user.id, email: user.email, status: user.status } });
  } catch (error) {
    if (!isJson) {
      const url = requestUrl(localizedPath(lang, '/reset-password'), request);
      url.searchParams.set('error', 'reset');
      return Response.redirect(url, 303);
    }
    return apiError(400, 'AUTH_PASSWORD_RESET_FAILED', 'Unable to reset password.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
