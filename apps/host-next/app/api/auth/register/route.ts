import { getHostAuthAdapter } from '@host/lib/auth';
import { apiError, apiOk, readJsonObject, stringBody } from '@host/lib/api';
import { sendHostEmail } from '@host/lib/email-provider';
import { languageFromRequest, localizedPath } from '@host/lib/i18n';
import { requestUrl } from '@host/lib/paths';
import { checkHostRouteSecurity } from '@host/lib/security';

function publicUser(user: { id: string; email: string; role: string; status: string }) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
  };
}

export async function POST(request: Request) {
  const securityResponse = await checkHostRouteSecurity(request, 'auth.register');
  if (securityResponse) {
    return securityResponse;
  }

  const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
  const body = isJson ? await readJsonObject(request) : Object.fromEntries((await request.formData()).entries());
  const lang = languageFromRequest(request);
  try {
    const registered = await (await getHostAuthAdapter()).register({
      email: stringBody(body, 'email', { required: true }) ?? '',
      password: stringBody(body, 'password', { required: true }) ?? '',
      displayName: stringBody(body, 'displayName', { maxLength: 80 }),
    });
    if (registered.user.status === 'pending-verification') {
      const verifyUrl = requestUrl('/api/auth/email/verify', request);
      verifyUrl.searchParams.set('token', registered.emailVerificationToken);
      await sendHostEmail({
        to: registered.user.email,
        subject: 'Verify your PloyKit account',
        text: `Open this link to verify your account:\n\n${verifyUrl.toString()}`,
        metadata: { source: 'auth.register', userId: registered.user.id },
      });
    }
    if (!isJson) {
      const url = requestUrl(localizedPath(lang, '/login'), request);
      url.searchParams.set('registered', '1');
      return Response.redirect(url, 303);
    }
    return apiOk({
      user: publicUser(registered.user),
      emailVerificationToken:
        process.env.NODE_ENV === 'production' ? undefined : registered.emailVerificationToken,
    });
  } catch (error) {
    if (!isJson) {
      const url = requestUrl(localizedPath(lang, '/register'), request);
      url.searchParams.set('error', 'register');
      return Response.redirect(url, 303);
    }
    return apiError(400, 'AUTH_REGISTER_FAILED', 'Unable to register user.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
