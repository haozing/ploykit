import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRuntimeStore } from '../src/lib/module-runtime';
import {
  COMMERCIAL_ORDER_STATUS_EVENT_NAME,
  type CommercialOrderStatusEventPayload,
  createRuntimeStoreCommercialRuntime,
} from '../src/lib/module-capabilities';

const adminSession = {
  user: { id: 'admin-1', role: 'admin' as const },
  actorId: 'admin-1',
};

test('P15 commercial provider publishes idempotent order status events', async () => {
  const productId = 'product-events';
  const workspaceId = 'workspace-events';
  const store = createInMemoryRuntimeStore();
  const commercial = createRuntimeStoreCommercialRuntime({
    store,
    productId,
    workspaceId,
    skuCatalog: {
      credits_10: {
        credits: { amount: 10 },
      },
    },
    events: {
      publish(event) {
        return store.enqueueOutbox({
          productId,
          workspaceId,
          moduleId: null,
          name: `event:${event.name}`,
          payload: event.payload,
          idempotencyKey: event.idempotencyKey,
          metadata: {
            eventName: event.name,
            correlationId: event.correlationId,
            causationId: event.causationId,
            sourceModuleId: null,
            maxAttempts: event.maxAttempts,
          },
        });
      },
    },
  });
  const moduleCommercial = commercial.forModule('paid-tool');
  const checkout = await moduleCommercial.commerce.createCheckout({
    userId: 'user-events',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
  });

  await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-paid-events',
    orderId: checkout.id,
    userId: 'user-events',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
  });
  await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-paid-events',
    orderId: checkout.id,
    userId: 'user-events',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
  });

  let events = await store.listOutbox({
    productId,
    workspaceId,
    name: `event:${COMMERCIAL_ORDER_STATUS_EVENT_NAME}`,
  });
  const paidPayload = events[0]?.payload as CommercialOrderStatusEventPayload | undefined;

  assert.equal(events.length, 1);
  assert.equal(
    events[0]?.idempotencyKey,
    `${COMMERCIAL_ORDER_STATUS_EVENT_NAME}:${checkout.id}:paid`
  );
  assert.equal(events[0]?.metadata.eventName, COMMERCIAL_ORDER_STATUS_EVENT_NAME);
  assert.equal(events[0]?.metadata.correlationId, `commercial-order:${checkout.id}`);
  assert.equal(events[0]?.metadata.maxAttempts, 5);
  assert.equal(paidPayload?.orderId, checkout.id);
  assert.equal(paidPayload?.previousStatus, 'created');
  assert.equal(paidPayload?.status, 'paid');
  assert.equal(paidPayload?.reason, 'provider.checkout.paid');
  assert.equal(paidPayload?.userId, 'user-events');
  assert.equal(paidPayload?.sku, 'credits_10');

  const refund = await commercial.provider.applyRefund({
    provider: 'stripe',
    providerRef: 'evt-refund-events',
    orderId: checkout.id,
    amount: 1000,
    currency: 'usd',
    reason: 'customer_refund',
  });
  await commercial.provider.applyRefund({
    provider: 'stripe',
    providerRef: 'evt-refund-events',
    orderId: checkout.id,
    amount: 1000,
    currency: 'usd',
    reason: 'customer_refund',
  });

  events = await store.listOutbox({
    productId,
    workspaceId,
    name: `event:${COMMERCIAL_ORDER_STATUS_EVENT_NAME}`,
  });
  const refundedEvent = events.find(
    (event) => (event.payload as CommercialOrderStatusEventPayload).status === 'refunded'
  );
  const refundedPayload = refundedEvent?.payload as CommercialOrderStatusEventPayload | undefined;

  assert.equal(events.length, 2);
  assert.equal(
    refundedEvent?.idempotencyKey,
    `${COMMERCIAL_ORDER_STATUS_EVENT_NAME}:${checkout.id}:refunded`
  );
  assert.equal(refundedPayload?.previousStatus, 'paid');
  assert.equal(refundedPayload?.status, 'refunded');
  assert.equal(refundedPayload?.reason, 'provider.refund.full');
  assert.equal(refundedPayload?.refund?.creditNoteId, refund.creditNote.id);
  assert.equal(refundedPayload?.refund?.amount, 1000);
  assert.equal(refundedPayload?.refund?.reason, 'customer_refund');
});

test('P15 commercial revenue buckets stay stable across replayed provider events', async () => {
  let nextId = 0;
  let currentTime = new Date('2026-05-19T10:00:00.000Z');
  const store = createInMemoryRuntimeStore({
    now: () => currentTime,
    createId: (prefix) => `${prefix}_stable_${++nextId}`,
  });
  const commercial = createRuntimeStoreCommercialRuntime({
    store,
    productId: 'product-stable',
    workspaceId: 'workspace-stable',
    skuCatalog: {
      credits_10: {
        credits: { amount: 10 },
      },
    },
  });
  const moduleCommercial = commercial.forModule('paid-tool');

  const checkout = await moduleCommercial.commerce.createCheckout({
    userId: 'user-stable',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
    idempotencyKey: 'checkout-stable',
  });
  await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-paid-stable',
    orderId: checkout.id,
    userId: 'user-stable',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
  });

  currentTime = new Date('2026-05-20T10:00:00.000Z');
  await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-paid-stable',
    orderId: checkout.id,
    userId: 'user-stable',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
  });

  const paidBuckets = await store.listRevenueBuckets({
    productId: 'product-stable',
    workspaceId: 'workspace-stable',
    currency: 'usd',
  });
  assert.equal(paidBuckets.length, 1);
  assert.equal(paidBuckets[0]?.bucketDate, '2026-05-19');
  assert.equal(paidBuckets[0]?.gross, 1000);
  assert.equal(paidBuckets[0]?.net, 1000);

  currentTime = new Date('2026-05-21T10:00:00.000Z');
  const refund = await commercial.provider.applyRefund({
    provider: 'stripe',
    providerRef: 'evt-refund-stable',
    orderId: checkout.id,
    amount: 1000,
    currency: 'usd',
  });
  const balanceAfterRefund = await moduleCommercial.credits.balance('user-stable');

  currentTime = new Date('2026-05-22T10:00:00.000Z');
  const duplicateRefund = await commercial.provider.applyRefund({
    provider: 'stripe',
    providerRef: 'evt-refund-stable',
    orderId: checkout.id,
    amount: 1000,
    currency: 'usd',
  });
  const stalePaidReplay = await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-paid-stable',
    orderId: checkout.id,
    userId: 'user-stable',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
  });

  const creditNotes = await store.listCreditNotes({
    productId: 'product-stable',
    workspaceId: 'workspace-stable',
    orderId: checkout.id,
  });
  const buckets = await store.listRevenueBuckets({
    productId: 'product-stable',
    workspaceId: 'workspace-stable',
    currency: 'usd',
  });
  const paidSettlement = await commercial.provider.recordSettlement({
    provider: 'stripe',
    currency: 'usd',
    periodStart: '2026-05-19T00:00:00.000Z',
    periodEnd: '2026-05-19T23:59:59.999Z',
  });
  const refundSettlement = await commercial.provider.recordSettlement({
    provider: 'stripe',
    currency: 'usd',
    periodStart: '2026-05-21T00:00:00.000Z',
    periodEnd: '2026-05-21T23:59:59.999Z',
  });

  assert.equal(duplicateRefund.creditNote.id, refund.creditNote.id);
  assert.equal(stalePaidReplay.order.status, 'refunded');
  assert.equal(creditNotes.length, 1);
  assert.equal(
    (await moduleCommercial.credits.balance('user-stable')).balance,
    balanceAfterRefund.balance
  );
  assert.deepEqual(
    buckets.map((bucket) => [bucket.bucketDate, bucket.gross, bucket.refund, bucket.net]),
    [
      ['2026-05-19', 1000, 0, 1000],
      ['2026-05-21', 0, 1000, -1000],
    ]
  );
  assert.equal(paidSettlement.gross, 1000);
  assert.equal(paidSettlement.refund, 0);
  assert.equal(paidSettlement.net, 1000);
  assert.equal(refundSettlement.gross, 0);
  assert.equal(refundSettlement.refund, 1000);
  assert.equal(refundSettlement.net, -1000);
});

test('P15 commercial subscription events are idempotent, ordered and sync access', async () => {
  let nextId = 0;
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T10:00:00.000Z'),
    createId: (prefix) => `${prefix}_subscription_${++nextId}`,
  });
  const commercial = createRuntimeStoreCommercialRuntime({
    store,
    productId: 'product-subscription',
    workspaceId: 'workspace-subscription',
    planCatalog: [{ id: 'pro', name: 'Pro', entitlements: ['pro.access'] }],
    skuCatalog: {
      pro_monthly: {
        credits: { amount: 10 },
        planId: 'pro',
      },
    },
  });
  const moduleCommercial = commercial.forModule('paid-tool');

  const created = await commercial.provider.recordSubscriptionEvent({
    userId: 'user-provider-only',
    planId: 'pro',
    type: 'created',
    provider: 'stripe',
    providerRef: 'sub_provider_only',
    idempotencyKey: 'evt-sub-created',
    currentPeriodStart: '2026-05-19T00:00:00.000Z',
    currentPeriodEnd: '2026-06-19T00:00:00.000Z',
    effectiveAt: '2026-05-19T00:00:00.000Z',
  });
  const duplicateCreated = await commercial.provider.recordSubscriptionEvent({
    userId: 'user-provider-only',
    planId: 'pro',
    type: 'created',
    provider: 'stripe',
    providerRef: 'sub_provider_only',
    idempotencyKey: 'evt-sub-created',
    currentPeriodStart: '2026-05-19T00:00:00.000Z',
    currentPeriodEnd: '2026-06-19T00:00:00.000Z',
    effectiveAt: '2026-05-19T00:00:00.000Z',
  });
  await commercial.provider.recordSubscriptionEvent({
    userId: 'user-provider-only',
    planId: 'pro',
    type: 'renewed',
    provider: 'stripe',
    providerRef: 'sub_provider_only',
    idempotencyKey: 'evt-sub-renewed',
    currentPeriodStart: '2026-06-19T00:00:00.000Z',
    currentPeriodEnd: '2026-07-19T00:00:00.000Z',
    effectiveAt: '2026-06-19T00:00:00.000Z',
  });
  const staleCanceled = await commercial.provider.recordSubscriptionEvent({
    userId: 'user-provider-only',
    planId: 'pro',
    type: 'canceled',
    provider: 'stripe',
    providerRef: 'sub_provider_only',
    idempotencyKey: 'evt-sub-cancel-stale',
    effectiveAt: '2026-05-20T00:00:00.000Z',
  });
  const providerOnlySubscription = (
    await store.listSubscriptions({
      productId: 'product-subscription',
      workspaceId: 'workspace-subscription',
      userId: 'user-provider-only',
      planId: 'pro',
    })
  )[0];
  const providerOnlyEvents = await store.listSubscriptionEvents({
    productId: 'product-subscription',
    workspaceId: 'workspace-subscription',
    userId: 'user-provider-only',
    planId: 'pro',
  });

  assert.equal(duplicateCreated.id, created.id);
  assert.equal(providerOnlyEvents.length, 3);
  assert.equal(providerOnlySubscription?.status, 'active');
  assert.equal(providerOnlySubscription?.currentPeriodEnd, '2026-07-19T00:00:00.000Z');
  assert.equal(staleCanceled.metadata.stale, true);
  assert.equal(
    await moduleCommercial.billing.hasEntitlement('user-provider-only', 'pro.access'),
    true
  );

  await commercial.provider.recordSubscriptionEvent({
    userId: 'user-provider-only',
    planId: 'pro',
    type: 'canceled',
    provider: 'stripe',
    providerRef: 'sub_provider_only',
    idempotencyKey: 'evt-sub-canceled',
    effectiveAt: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(
    await moduleCommercial.billing.hasEntitlement('user-provider-only', 'pro.access'),
    false
  );

  const checkout = await moduleCommercial.commerce.createCheckout({
    userId: 'user-order-backed',
    sku: 'pro_monthly',
    amount: 1000,
    currency: 'usd',
  });
  await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'cs_order_backed',
    orderId: checkout.id,
    userId: 'user-order-backed',
    sku: 'pro_monthly',
    amount: 1000,
    currency: 'usd',
  });
  assert.equal(
    await moduleCommercial.billing.hasEntitlement('user-order-backed', 'pro.access'),
    true
  );

  await commercial.provider.recordSubscriptionEvent({
    userId: 'user-order-backed',
    planId: 'pro',
    type: 'canceled',
    provider: 'stripe',
    providerRef: 'sub_order_backed',
    idempotencyKey: 'evt-sub-order-canceled',
    effectiveAt: '2026-08-20T00:00:00.000Z',
  });
  assert.equal(
    await moduleCommercial.billing.hasEntitlement('user-order-backed', 'pro.access'),
    false
  );

  const nullWorkspaceSubscriptions = await store.listSubscriptions({
    productId: 'product-subscription',
    workspaceId: null,
  });
  assert.equal(nullWorkspaceSubscriptions.length, 0);
});

test('P15 commercial tax profiles stay scoped and invoices freeze tax evidence', async () => {
  let nextId = 0;
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T10:00:00.000Z'),
    createId: (prefix) => `${prefix}_tax_${++nextId}`,
  });
  const commercial = createRuntimeStoreCommercialRuntime({
    store,
    productId: 'product-tax',
    workspaceId: 'workspace-tax',
    skuCatalog: {
      taxable_monthly: {
        credits: { amount: 10 },
      },
    },
  });
  const moduleCommercial = commercial.forModule('paid-tool');

  const taxProfile = await commercial.admin.validateTaxProfile({
    session: adminSession,
    userId: 'user-tax',
    jurisdiction: 'us-ca',
    profile: {
      company: 'Taxable Inc.',
      country: 'US',
      taxId: 'US12345678',
    },
    evidence: { source: 'unit-test' },
  });
  assert.equal(await store.getTaxProfile('product-tax', 'user-tax', null), null);

  const nullScoped = await store.upsertTaxProfile({
    productId: 'product-tax',
    workspaceId: null,
    userId: 'user-null-tax',
    profile: { country: 'DE', taxId: 'DE12345678' },
  });
  const updatedNullScoped = await store.upsertTaxProfile({
    productId: 'product-tax',
    workspaceId: null,
    userId: 'user-null-tax',
    profile: { company: 'Null Scope GmbH' },
  });
  assert.equal(updatedNullScoped.id, nullScoped.id);

  const checkout = await moduleCommercial.commerce.createCheckout({
    userId: 'user-tax',
    sku: 'taxable_monthly',
    amount: 1000,
    currency: 'usd',
  });
  await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-tax-paid',
    orderId: checkout.id,
    userId: 'user-tax',
    sku: 'taxable_monthly',
    amount: 1000,
    currency: 'usd',
  });

  const invoice = (
    await store.listInvoices({
      productId: 'product-tax',
      workspaceId: 'workspace-tax',
      userId: 'user-tax',
      orderId: checkout.id,
    })
  )[0]!;
  assert.equal(invoice.taxSnapshot.taxProfileId, taxProfile.id);
  assert.equal(invoice.taxSnapshot.jurisdiction, 'US-CA');
  assert.equal(invoice.taxSnapshot.taxIdMasked, '***5678');
  assert.equal(invoice.taxSnapshot.taxId, undefined);

  await commercial.admin.validateTaxProfile({
    session: adminSession,
    userId: 'user-tax',
    jurisdiction: 'us-ca',
    profile: {
      company: 'Taxable Inc.',
      country: 'US',
      taxId: 'US99999999',
    },
  });
  await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-tax-paid',
    orderId: checkout.id,
    userId: 'user-tax',
    sku: 'taxable_monthly',
    amount: 1000,
    currency: 'usd',
  });
  const replayedInvoice = (
    await store.listInvoices({
      productId: 'product-tax',
      workspaceId: 'workspace-tax',
      userId: 'user-tax',
      orderId: checkout.id,
    })
  )[0]!;
  assert.equal(replayedInvoice.taxSnapshot.taxIdMasked, '***5678');
});

test('P15 commercial partial refunds keep benefits until the order is fully refunded', async () => {
  let nextId = 0;
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T10:00:00.000Z'),
    createId: (prefix) => `${prefix}_partial_${++nextId}`,
  });
  const commercial = createRuntimeStoreCommercialRuntime({
    store,
    productId: 'product-partial',
    workspaceId: 'workspace-partial',
    skuCatalog: {
      credits_10: {
        credits: { amount: 10 },
      },
    },
  });
  const moduleCommercial = commercial.forModule('paid-tool');
  const checkout = await moduleCommercial.commerce.createCheckout({
    userId: 'user-partial',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
  });
  await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-paid-partial',
    orderId: checkout.id,
    userId: 'user-partial',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
  });

  const firstRefund = await commercial.provider.applyRefund({
    provider: 'stripe',
    providerRef: 'evt-refund-partial-1',
    orderId: checkout.id,
    amount: 400,
    currency: 'usd',
  });
  assert.equal(firstRefund.order.status, 'paid');
  assert.deepEqual(firstRefund.credits, []);
  assert.equal((await moduleCommercial.credits.balance('user-partial')).balance, 10);

  const secondRefund = await commercial.provider.applyRefund({
    provider: 'stripe',
    providerRef: 'evt-refund-partial-2',
    orderId: checkout.id,
    amount: 600,
    currency: 'usd',
  });
  const duplicateFullRefund = await commercial.provider.applyRefund({
    provider: 'stripe',
    providerRef: 'evt-refund-partial-2',
    orderId: checkout.id,
    amount: 600,
    currency: 'usd',
  });
  await assert.rejects(
    () =>
      commercial.provider.applyRefund({
        provider: 'stripe',
        providerRef: 'evt-refund-partial-extra',
        orderId: checkout.id,
        amount: 1,
        currency: 'usd',
      }),
    /MODULE_COMMERCIAL_REFUND_EXCEEDS_ORDER/
  );
  const creditNotes = await store.listCreditNotes({
    productId: 'product-partial',
    workspaceId: 'workspace-partial',
    orderId: checkout.id,
  });
  const revenue = await store.listRevenueBuckets({
    productId: 'product-partial',
    workspaceId: 'workspace-partial',
    currency: 'usd',
  });

  assert.equal(secondRefund.order.status, 'refunded');
  assert.equal(secondRefund.credits[0]?.amount, -10);
  assert.equal(duplicateFullRefund.creditNote.id, secondRefund.creditNote.id);
  assert.equal(creditNotes.length, 2);
  assert.equal((await moduleCommercial.credits.balance('user-partial')).balance, 0);
  assert.equal(revenue[0]?.gross, 1000);
  assert.equal(revenue[0]?.refund, 1000);
  assert.equal(revenue[0]?.net, 0);
});
