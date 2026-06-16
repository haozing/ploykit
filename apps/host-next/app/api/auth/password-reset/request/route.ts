import { apiError, apiOk, readJsonObject, stringBody } from '@host/lib/api';
import { getHostAuthAdapter } from '@host/lib/auth';
import { sendHostEmail } from '@host/lib/email-provider';
import { languageFromRequest, localizedPath } from '@host/lib/i18n';
import { requestUrl } from '@host/lib/paths';
import { checkHostRouteSecurity } from '@host/lib/security';

export function passwordResetResponseData(
  result: { sent: boolean; resetToken?: string },
  nodeEnv = process.env.NODE_ENV
): { sent: boolean; resetToken?: string } {
  return {
    sent: result.sent,
    ...(nodeEnv === 'production' ? {} : { resetToken: result.resetToken }),
  };
}

export async function POST(request: Request) {
  const securityResponse = await checkHostRouteSecurity(request, 'auth.passwordReset.request');
  if (securityResponse) {
    return securityResponse;
  }

  const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
  const body = isJson ? await readJsonObject(request) : Object.fromEntries((await request.formData()).entries());
  const lang = languageFromRequest(request);
  try {
    const result = await (await getHostAuthAdapter()).requestPasswordReset(
      stringBody(body, 'email', { required: true }) ?? ''
    );
    if (result.sent && result.resetToken) {
      const resetUrl = requestUrl(localizedPath(lang, '/reset-password'), request);
      resetUrl.searchParams.set('token', result.resetToken);
      await sendHostEmail({
        to: stringBody(body, 'email', { required: true }) ?? '',
        subject: 'Reset your PloyKit password',
        text: `Open this link to reset your password:\n\n${resetUrl.toString()}`,
        metadata: { source: 'auth.passwordReset' },
      });
    }
    if (!isJson) {
      const url = requestUrl(localizedPath(lang, '/login'), request);
      url.searchParams.set('reset', 'sent');
      return Response.redirect(url, 303);
    }
    return apiOk(passwordResetResponseData(result));
  } catch (error) {
    if (!isJson) {
      const url = requestUrl(localizedPath(lang, '/forgot-password'), request);
      url.searchParams.set('error', 'reset');
      return Response.redirect(url, 303);
    }
    return apiError(400, 'AUTH_PASSWORD_RESET_REQUEST_FAILED', 'Unable to request reset.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
