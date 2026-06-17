import { createHash } from 'node:crypto';
import {
  applyStripeWebhookEvent,
  verifyStripeWebhookSignature,
} from '@host/lib/commercial-provider';
import { DEFAULT_HOST_PRODUCT_ID, DEFAULT_HOST_WORKSPACE_ID } from '@host/lib/default-scope';
import { getHostRuntimeStore } from '@host/lib/runtime-store';
import { checkHostRouteSecurity } from '@host/lib/security';

const STRIPE_WEBHOOK_MODULE_ID = '__host__';
const STRIPE_WEBHOOK_NAME = 'billing.stripe';

function bodyDigest(body: string): string {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

function requestHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries([...headers.entries()]);
}

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
  const stripeAccount =
    typeof (event as { account?: unknown }).account === 'string'
      ? (event as { account: string }).account
      : 'default';
  const idempotencyKey = event.id
    ? `stripe:${stripeAccount}:${event.id}`
    : bodyDigest(body);
  const runtimeStore = await getHostRuntimeStore();
  const existing = await runtimeStore.store.findWebhookReceiptByIdempotencyKey(
    DEFAULT_HOST_PRODUCT_ID,
    DEFAULT_HOST_WORKSPACE_ID,
    STRIPE_WEBHOOK_MODULE_ID,
    STRIPE_WEBHOOK_NAME,
    idempotencyKey
  );
  if (existing && ['received', 'processing', 'processed', 'duplicate'].includes(existing.status)) {
    const duplicate = await runtimeStore.store.markWebhookReceipt(existing.id, 'duplicate');
    return Response.json({ ok: true, duplicate: true, receiptId: duplicate.id });
  }

  const receipt = existing
    ? await runtimeStore.store.markWebhookReceipt(existing.id, 'received')
    : await runtimeStore.store.createWebhookReceipt({
        productId: DEFAULT_HOST_PRODUCT_ID,
        workspaceId: DEFAULT_HOST_WORKSPACE_ID,
        moduleId: STRIPE_WEBHOOK_MODULE_ID,
        webhookName: STRIPE_WEBHOOK_NAME,
        path: new URL(request.url).pathname,
        method: request.method,
        idempotencyKey,
        signature: signatureHeader ?? undefined,
        headers: requestHeaders(request.headers),
        bodyText: body,
        bodyDigest: bodyDigest(body),
      });

  await runtimeStore.store.markWebhookReceipt(receipt.id, 'processing');
  try {
    const result = await applyStripeWebhookEvent(event);
    await runtimeStore.store.markWebhookReceipt(receipt.id, 'processed');
    return Response.json({ ok: true, receiptId: receipt.id, result });
  } catch (error) {
    await runtimeStore.store.markWebhookReceipt(
      receipt.id,
      'failed',
      error instanceof Error ? error : String(error)
    );
    return Response.json(
      { ok: false, code: 'STRIPE_WEBHOOK_PROCESSING_FAILED', receiptId: receipt.id },
      { status: 500 }
    );
  }
}
