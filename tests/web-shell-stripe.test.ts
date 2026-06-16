import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMERCIAL_ORDER_STATUS_EVENT_NAME } from '../src/lib/module-capabilities';
import {
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_WORKSPACE_ID,
} from '../apps/host-next/lib/default-scope';
import {
  applyStripeCheckoutCompletedEvent,
  createStripeBillingPortalSession,
  createStripeCheckoutSession,
  verifyStripeWebhookSignature,
} from '../apps/host-next/lib/commercial-provider';
import {
  getHostRuntimeStore,
  resetHostRuntimeStoreForTests,
} from '../apps/host-next/lib/runtime-store';

test('M6 Stripe webhook signature verifier accepts valid signatures', () => {
  const body = '{"type":"checkout.session.completed"}';
  const secret = 'whsec_test';
  const timestamp = 1779199200;
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

  assert.equal(
    verifyStripeWebhookSignature({
      body,
      signatureHeader: `t=${timestamp},v1=${signature}`,
      secret,
      now: () => new Date(timestamp * 1000),
    }),
    true
  );
});

test('M6 Stripe checkout client creates a test-mode checkout request shape', async () => {
  const calls: { input: string | URL; init?: RequestInit }[] = [];
  const result = await createStripeCheckoutSession(
    {
      orderId: 'order_test',
      userId: 'demo-admin',
      sku: 'demo-pro-monthly',
      planId: 'demo-pro',
      mode: 'subscription',
    },
    {
      env: {
        PLOYKIT_HOST_URL: 'http://localhost:3000',
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_PRICE_DEMO_PRO_MONTHLY: 'price_test_123',
      },
      fetch: async (input, init) => {
        calls.push({ input, init });
        return Response.json({
          id: 'cs_test_123',
          url: 'https://checkout.stripe.com/c/pay/cs_test_123',
        });
      },
    }
  );
  const body = calls[0]?.init?.body as URLSearchParams;
  const headers = new Headers(calls[0]?.init?.headers);

  assert.equal(result.id, 'cs_test_123');
  assert.equal(calls[0]?.input, 'https://api.stripe.com/v1/checkout/sessions');
  assert.equal(headers.get('authorization'), 'Bearer sk_test_123');
  assert.equal(body.get('mode'), 'subscription');
  assert.equal(body.get('line_items[0][price]'), 'price_test_123');
  assert.equal(body.get('metadata[orderId]'), 'order_test');
  assert.equal(body.get('metadata[userId]'), 'demo-admin');
  assert.equal(body.get('metadata[planId]'), 'demo-pro');
  assert.equal(body.get('subscription_data[metadata][orderId]'), 'order_test');
  assert.equal(body.get('subscription_data[metadata][userId]'), 'demo-admin');
  assert.equal(body.get('subscription_data[metadata][sku]'), 'demo-pro-monthly');
  assert.equal(body.get('subscription_data[metadata][planId]'), 'demo-pro');
});

test('M6 Stripe checkout webhook replay does not duplicate commercial ledger entries', async () => {
  const previousRuntimeStore = process.env.PLOYKIT_RUNTIME_STORE;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousPostgresUrl = process.env.POSTGRES_URL;

  process.env.PLOYKIT_RUNTIME_STORE = 'memory';
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  resetHostRuntimeStoreForTests();

  try {
    const event = {
      id: 'evt_checkout_duplicate_test',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_checkout_duplicate_test',
          amount_total: 1200,
          currency: 'usd',
          metadata: {
            userId: 'stripe-duplicate-user',
            sku: 'demo-pro-monthly',
          },
        },
      },
    };

    const first = await applyStripeCheckoutCompletedEvent(event);
    const second = await applyStripeCheckoutCompletedEvent(event);
    const { store } = await getHostRuntimeStore();
    const orders = await store.listCommercialOrders({
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: DEFAULT_HOST_WORKSPACE_ID,
      userId: 'stripe-duplicate-user',
    });
    const credits = await store.listCreditLedger({
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: DEFAULT_HOST_WORKSPACE_ID,
      userId: 'stripe-duplicate-user',
    });
    const entitlements = await store.listEntitlements({
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: DEFAULT_HOST_WORKSPACE_ID,
      userId: 'stripe-duplicate-user',
      entitlement: 'public-tools.pro',
    });
    const invoices = await store.listInvoices({
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: DEFAULT_HOST_WORKSPACE_ID,
      userId: 'stripe-duplicate-user',
    });
    const revenue = await store.listRevenueBuckets({
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: DEFAULT_HOST_WORKSPACE_ID,
      currency: 'USD',
    });
    const events = await store.listOutbox({
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: DEFAULT_HOST_WORKSPACE_ID,
      name: `event:${COMMERCIAL_ORDER_STATUS_EVENT_NAME}`,
    });

    assert.equal(first.ignored, false);
    assert.equal(second.ignored, false);
    if (!('order' in first) || !first.order || !('order' in second) || !second.order) {
      throw new Error('STRIPE_DUPLICATE_WEBHOOK_ORDER_MISSING');
    }
    const firstOrder = first.order;
    const secondOrder = second.order;
    assert.equal(firstOrder.id, secondOrder.id);
    assert.equal(firstOrder.status, 'paid');
    assert.equal(orders.length, 1);
    assert.equal(credits.length, 1);
    assert.equal(credits[0]?.amount, 1000);
    assert.equal(entitlements.length, 1);
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0]?.total, 1200);
    assert.equal(revenue.length, 1);
    assert.equal(revenue[0]?.gross, 1200);
    assert.equal(revenue[0]?.orders, 1);
    assert.equal(events.length, 1);
    assert.equal(
      events[0]?.idempotencyKey,
      `${COMMERCIAL_ORDER_STATUS_EVENT_NAME}:${firstOrder.id}:paid`
    );
  } finally {
    resetHostRuntimeStoreForTests();
    if (previousRuntimeStore === undefined) {
      delete process.env.PLOYKIT_RUNTIME_STORE;
    } else {
      process.env.PLOYKIT_RUNTIME_STORE = previousRuntimeStore;
    }
    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
    if (previousPostgresUrl === undefined) {
      delete process.env.POSTGRES_URL;
    } else {
      process.env.POSTGRES_URL = previousPostgresUrl;
    }
  }
});

test('R4 Stripe billing portal client creates a test-mode portal request shape', async () => {
  const calls: { input: string | URL; init?: RequestInit }[] = [];
  const result = await createStripeBillingPortalSession(
    {
      customerId: 'cus_test',
      returnUrl: 'http://localhost:3000/zh/dashboard/billing',
    },
    {
      env: {
        STRIPE_SECRET_KEY: 'sk_test_123',
        PLOYKIT_HOST_URL: 'http://localhost:3000',
      },
      fetch: async (input, init) => {
        calls.push({ input, init });
        return Response.json({ id: 'bps_test', url: 'https://billing.stripe.test/session' });
      },
    }
  );
  const body = calls[0]?.init?.body as URLSearchParams;

  assert.equal(result.id, 'bps_test');
  assert.equal(String(calls[0]?.input), 'https://api.stripe.com/v1/billing_portal/sessions');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(body.get('customer'), 'cus_test');
  assert.equal(body.get('return_url'), 'http://localhost:3000/zh/dashboard/billing');
});
