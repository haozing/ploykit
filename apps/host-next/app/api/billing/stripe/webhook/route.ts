import {
  applyStripeWebhookEvent,
  verifyStripeWebhookSignature,
} from '@host/lib/commercial-provider';
import { checkHostRouteSecurity } from '@host/lib/security';

export async function POST(request: Request) {
  const securityResponse = await checkHostRouteSecurity(request, 'billing.stripeWebhook');
  if (securityResponse) {
    return securityResponse;
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, code: 'STRIPE_WEBHOOK_SECRET_REQUIRED' },
      { status: 503 }
    );
  }

  const body = await request.text();
  const signatureHeader = request.headers.get('stripe-signature');
  if (!verifyStripeWebhookSignature({ body, signatureHeader, secret })) {
    return Response.json({ ok: false, code: 'STRIPE_SIGNATURE_INVALID' }, { status: 400 });
  }

  const event = JSON.parse(body) as Parameters<typeof applyStripeWebhookEvent>[0];
  const result = await applyStripeWebhookEvent(event);
  return Response.json({ ok: true, result });
}
