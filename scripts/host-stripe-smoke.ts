import { createHmac, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyStripeCheckoutCompletedEvent,
  createHostCommercialRuntimeFromStore,
  createStripeCheckoutSession,
  loadHostBillingCatalog,
  verifyStripeWebhookSignature,
} from '../apps/host-next/lib/commercial-provider';
import {
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_WORKSPACE_ID,
} from '../apps/host-next/lib/default-scope';
import { getHostRuntimeStore } from '../apps/host-next/lib/runtime-store';

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readBooleanArg(name: string): boolean {
  return process.argv.includes(name);
}

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.length > 0 ? value : null;
}

function signStripeBody(body: string, secret: string, timestamp: number): string {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

const required = readBooleanArg('--required');
const hitHttpWebhook = readBooleanArg('--http-webhook');
const applyLedger = readBooleanArg('--apply-ledger');
const mockStripe = readBooleanArg('--mock-stripe');
const baseUrl = (readArg('--base-url') ?? process.env.HOST_SMOKE_BASE_URL ?? 'http://localhost:3000')
  .replace(/\/$/, '');
const userId = readArg('--user-id') ?? 'demo-admin';
const sku = readArg('--sku') ?? 'demo-pro-monthly';
const explicitOrderId = readArg('--order-id');
let orderId = explicitOrderId ?? `stripe_smoke_${randomUUID()}`;
const mockStripeEnv = {
  STRIPE_SECRET_KEY: 'sk_test_ploykit_local_mock',
  STRIPE_PRICE_DEMO_PRO_MONTHLY: 'price_ploykit_demo_pro_monthly',
  STRIPE_WEBHOOK_SECRET: 'whsec_ploykit_local_mock',
};

function stripeEnv(name: keyof typeof mockStripeEnv): string | null {
  return env(name) ?? (mockStripe ? mockStripeEnv[name] : null);
}

const checkoutMissing = ['STRIPE_SECRET_KEY', 'STRIPE_PRICE_DEMO_PRO_MONTHLY'].filter(
  (name) => !stripeEnv(name as keyof typeof mockStripeEnv)
);
const webhookSecret = stripeEnv('STRIPE_WEBHOOK_SECRET');

const checks: {
  id: string;
  ok: boolean;
  skipped?: boolean;
  detail?: unknown;
  error?: string;
}[] = [];

async function check(id: string, task: () => Promise<unknown>) {
  try {
    checks.push({ id, ok: true, detail: await task() });
  } catch (error) {
    checks.push({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

let checkoutSessionId = `cs_smoke_${randomUUID()}`;

async function seedCheckoutOrderForLedger() {
  const runtimeStore = await getHostRuntimeStore();
  const catalog = await loadHostBillingCatalog(runtimeStore.store, DEFAULT_HOST_PRODUCT_ID);
  const skuEntry = catalog.skus.find((candidate) => candidate.id === sku && candidate.status !== 'archived');
  if (!skuEntry) {
    throw new Error(`STRIPE_SMOKE_SKU_NOT_FOUND: ${sku}`);
  }
  const commercial = createHostCommercialRuntimeFromStore({
    store: runtimeStore.store,
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    catalog,
  });
  return commercial.forModule('__host__').commerce.createCheckout({
    userId,
    sku,
    amount: skuEntry.amount,
    currency: skuEntry.currency,
    idempotencyKey: `stripe-smoke:${userId}:${sku}:${randomUUID()}`,
  });
}

function mockStripeFetch(expectedSessionId: string) {
  return async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url !== 'https://api.stripe.com/v1/checkout/sessions') {
      return Response.json({ error: { message: `unexpected mock stripe URL: ${url}` } }, { status: 404 });
    }
    const headers = new Headers(init?.headers);
    const body = init?.body instanceof URLSearchParams
      ? init.body
      : new URLSearchParams(String(init?.body ?? ''));
    const expectedAuth = `Bearer ${stripeEnv('STRIPE_SECRET_KEY')}`;
    if (headers.get('authorization') !== expectedAuth) {
      return Response.json({ error: { message: 'mock stripe auth mismatch' } }, { status: 401 });
    }
    if (
      body.get('line_items[0][price]') !== stripeEnv('STRIPE_PRICE_DEMO_PRO_MONTHLY') ||
      body.get('metadata[orderId]') !== orderId ||
      body.get('metadata[userId]') !== userId ||
      body.get('metadata[sku]') !== sku
    ) {
      return Response.json({ error: { message: 'mock stripe checkout body mismatch' } }, { status: 400 });
    }
    return Response.json({
      id: expectedSessionId,
      url: `https://checkout.stripe.local/pay/${expectedSessionId}`,
    });
  };
}

if (checkoutMissing.length > 0) {
  checks.push({
    id: 'stripe-checkout-session',
    ok: !required,
    skipped: true,
    detail: { reason: 'Stripe checkout env is not configured.', missing: checkoutMissing },
  });
} else {
  if (applyLedger && !explicitOrderId) {
    await check('stripe-ledger-seed-order', async () => {
      const seeded = await seedCheckoutOrderForLedger();
      orderId = seeded.id;
      return {
        orderId,
        status: seeded.status,
        sku,
      };
    });
  }

  await check('stripe-checkout-session', async () => {
    const session = await createStripeCheckoutSession({
      orderId,
      userId,
      sku,
    }, mockStripe
      ? {
          env: mockStripeEnv,
          fetch: mockStripeFetch(checkoutSessionId),
        }
      : {});
    checkoutSessionId = session.id;
    return {
      id: session.id,
      url: session.url,
      profile: mockStripe ? 'local-mock' : 'external-stripe',
    };
  });
}

if (!webhookSecret) {
  checks.push({
    id: 'stripe-webhook-signature',
    ok: !required,
    skipped: true,
    detail: { reason: 'STRIPE_WEBHOOK_SECRET is not configured.' },
  });
} else {
  const event = {
    id: `evt_smoke_${randomUUID()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: checkoutSessionId,
        amount_total: 1200,
        currency: 'usd',
        metadata: {
          orderId,
          userId,
          sku,
          smoke: 'host-stripe',
        },
      },
    },
  };
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureHeader = signStripeBody(body, webhookSecret, timestamp);

  await check('stripe-webhook-signature', async () => {
    const ok = verifyStripeWebhookSignature({
      body,
      signatureHeader,
      secret: webhookSecret,
    });
    if (!ok) {
      throw new Error('STRIPE_SMOKE_SIGNATURE_VERIFY_FAILED');
    }
    return 'verified';
  });

  if (applyLedger) {
    await check('stripe-webhook-apply-ledger', async () => {
      const result = await applyStripeCheckoutCompletedEvent(event);
      if (result.ignored || result.order.status !== 'paid') {
        throw new Error('STRIPE_SMOKE_LEDGER_APPLY_FAILED');
      }
      return {
        orderId: result.order.id,
        status: result.order.status,
        credits: result.credits,
        entitlements: result.entitlements,
      };
    });
  } else if (!hitHttpWebhook) {
    checks.push({
      id: 'stripe-webhook-apply-ledger',
      ok: !required,
      skipped: true,
      detail: {
        reason:
          'Pass --apply-ledger to write a synthetic checkout.session.completed event into the current runtime store.',
      },
    });
  }

  if (hitHttpWebhook) {
    await check('stripe-http-webhook-route', async () => {
      const response = await fetch(`${baseUrl}/api/billing/stripe/webhook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'stripe-signature': signatureHeader,
        },
        body,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`STRIPE_SMOKE_HTTP_WEBHOOK_FAILED: ${response.status} ${text}`);
      }
      return JSON.parse(text) as unknown;
    });
  }
}

const checkedAt = new Date().toISOString();
const outputDir = path.resolve(
  process.cwd(),
  '.runtime',
  'stripe-smoke',
  checkedAt.replace(/[:.]/g, '-')
);
const latestPath = path.resolve(process.cwd(), '.runtime', 'stripe-smoke', 'latest.json');
const reportPath = path.join(outputDir, 'stripe-smoke.json');
const result = {
  ok: checks.every((item) => item.ok),
  required,
  profile: mockStripe ? 'local-mock' : 'external-stripe',
  baseUrl: hitHttpWebhook ? baseUrl : undefined,
  checkedAt,
  checks,
  artifacts: {
    report: reportPath,
    latest: latestPath,
  },
};

fs.mkdirSync(outputDir, { recursive: true });
fs.mkdirSync(path.dirname(latestPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`);
fs.copyFileSync(reportPath, latestPath);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
