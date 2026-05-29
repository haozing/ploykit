import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { apiError, apiOk, readJsonObject, stringBody } from '@host/lib/api';
import { DEFAULT_HOST_PRODUCT_ID } from '@host/lib/default-scope';
import { sendHostEmail } from '@host/lib/email-provider';
import { getHostRuntimeStore } from '@host/lib/runtime-store';
import { checkHostRouteSecurity } from '@host/lib/security';

function isFormRequest(request: Request): boolean {
  const contentType = request.headers.get('content-type') ?? '';
  return contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data');
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function readContactBody(request: Request): Promise<Record<string, unknown>> {
  if (isFormRequest(request)) {
    return Object.fromEntries((await request.formData()).entries());
  }
  return readJsonObject(request);
}

function redirectToContact(request: Request, lang: string, state: 'received' | 'failed'): Response {
  const url = new URL(`/${lang === 'en' ? 'en' : 'zh'}/contact`, request.url);
  url.searchParams.set('contact', state);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  const securityResponse = await checkHostRouteSecurity(request, 'contact.submit');
  if (securityResponse) {
    return securityResponse;
  }

  const formRequest = isFormRequest(request);
  let redirectLang = 'zh';
  try {
    const body = await readContactBody(request);
    const lang = stringBody(body, 'lang', { maxLength: 8 }) ?? 'zh';
    redirectLang = lang;
    const name = stringBody(body, 'name', { required: true, maxLength: 120 })!;
    const email = stringBody(body, 'email', { required: true, maxLength: 200 })!;
    const company = stringBody(body, 'company', { maxLength: 160 });
    const message = stringBody(body, 'message', { required: true, maxLength: 2000 })!;
    if (!validEmail(email)) {
      throw new Error('CONTACT_EMAIL_INVALID');
    }

    const contactId = `contact_${randomUUID()}`;
    const recipient = process.env.PLOYKIT_CONTACT_TO ?? 'contact@ploykit.local';
    const emailResult = await sendHostEmail({
      to: recipient,
      subject: `[PloyKit] Contact request from ${name}`,
      text: [
        `Name: ${name}`,
        `Email: ${email}`,
        company ? `Company: ${company}` : null,
        '',
        message,
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
      metadata: {
        contactId,
        source: 'site-contact',
        replyTo: email,
      },
    });

    const runtimeStore = await getHostRuntimeStore();
    await runtimeStore.store.recordAudit({
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: null,
      actorId: null,
      type: 'host.contact.submitted',
      metadata: {
        contactId,
        name,
        email,
        company,
        messagePreview: message.slice(0, 280),
        emailProvider: emailResult.provider,
        emailStatus: emailResult.status,
        emailReason: emailResult.reason,
      },
    });

    if (formRequest) {
      return redirectToContact(request, lang, 'received');
    }
    return apiOk({ contactId, email: { provider: emailResult.provider, status: emailResult.status } });
  } catch (error) {
    if (formRequest) {
      return redirectToContact(request, redirectLang, 'failed');
    }
    return apiError(400, 'CONTACT_SUBMIT_FAILED', 'Unable to submit contact request.', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
