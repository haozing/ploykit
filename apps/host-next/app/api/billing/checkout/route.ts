import { NextResponse } from 'next/server';
import { createHostCheckout } from '@host/lib/commercial-provider';
import { resolveHostSessionFromRequest } from '@host/lib/auth';
import { checkHostRouteSecurity } from '@host/lib/security';

function unauthorized() {
  return Response.json({ ok: false, code: 'AUTH_REQUIRED' }, { status: 401 });
}

function safeNext(value: FormDataEntryValue | null): string | null {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : null;
}

export async function POST(request: Request) {
  const session = await resolveHostSessionFromRequest(request);
  const securityResponse = await checkHostRouteSecurity(request, 'billing.checkout', { session });
  if (securityResponse) {
    return securityResponse;
  }

  if (!session.user) {
    return unauthorized();
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await request.json()) as { sku?: string };
    const checkout = await createHostCheckout(session, body.sku);
    return Response.json({ ok: true, checkout });
  }

  const form = await request.formData();
  const checkout = await createHostCheckout(
    session,
    typeof form.get('sku') === 'string' ? String(form.get('sku')) : undefined
  );
  const target =
    checkout.provider === 'stripe' ? checkout.checkoutUrl : (safeNext(form.get('next')) ?? checkout.checkoutUrl);
  return NextResponse.redirect(new URL(target, request.url), 303);
}
