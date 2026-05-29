import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInMemoryRuntimeStore,
} from '../src/lib/module-runtime';
import {
  COMMERCIAL_ORDER_STATUS_EVENT_NAME,
  type CommercialOrderStatusEventPayload,
  checkRuntimeStoreCommercialRequirement,
  createRuntimeStoreCommercialRuntime,
} from '../src/lib/module-capabilities';

const adminSession = {
  user: { id: 'admin-1', role: 'admin' as const },
  actorId: 'admin-1',
};

test('P15 commercial ledger supports idempotent usage, metering, credits, orders, redeem and guard', async () => {
  let nextId = 0;
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T00:00:00.000Z'),
    createId: (prefix) => `${prefix}_${++nextId}`,
  });
  const commercial = createRuntimeStoreCommercialRuntime({
    store,
    productId: 'product-a',
    workspaceId: 'workspace-a',
    planCatalog: [{ id: 'pro', name: 'Pro', entitlements: ['pro', 'ai'] }],
    skuCatalog: {
      credits_10: {
        credits: { amount: 10 },
        planId: 'pro',
      },
    },
  });
  const moduleCommercial = commercial.forModule('paid-tool');

  const usage = await moduleCommercial.usage.record({
    meter: 'api.call',
    idempotencyKey: 'usage-1',
  });
  const sameUsage = await moduleCommercial.usage.record({
    meter: 'api.call',
    idempotencyKey: 'usage-1',
  });
  const authorized = await moduleCommercial.metering.authorize({
    meter: 'ai.generate',
    quantity: 2,
    idempotencyKey: 'meter-1',
  });
  const committed = await moduleCommercial.metering.commit(authorized.id);

  assert.equal(sameUsage.id, usage.id);
  assert.equal(committed.status, 'committed');
  assert.equal((await moduleCommercial.metering.reconcile()).checked, 1);

  await commercial.admin.grantCredits({
    session: adminSession,
    userId: 'user-1',
    amount: 5,
    idempotencyKey: 'manual-grant-1',
  });
  await commercial.admin.grantCredits({
    session: adminSession,
    userId: 'user-expired',
    amount: 5,
    expiresAt: '2026-05-18T00:00:00.000Z',
    idempotencyKey: 'expired-grant-1',
  });
  await moduleCommercial.credits.consume({
    userId: 'user-1',
    amount: 2,
    idempotencyKey: 'consume-1',
  });
  await moduleCommercial.credits.consume({
    userId: 'user-1',
    amount: 2,
    idempotencyKey: 'consume-1',
  });
  await assert.rejects(
    () =>
      moduleCommercial.credits.consume({
        userId: 'user-1',
        amount: 4,
        idempotencyKey: 'consume-too-much',
      }),
    /MODULE_CREDITS_INSUFFICIENT/
  );
  assert.equal((await moduleCommercial.credits.balance('user-1')).balance, 3);
  assert.equal((await moduleCommercial.credits.balance('user-expired')).balance, 0);
  assert.equal(
    (
      await store.listCreditLedger({
        productId: 'product-a',
        userId: 'user-expired',
        status: 'expired',
      })
    )[0]?.expiresAt,
    '2026-05-18T00:00:00.000Z'
  );
  assert.equal((await store.listAudit({ type: 'commercial.credits.granted' })).length, 2);

  await commercial.admin.createRedeemCode({
    session: adminSession,
    code: 'WELCOME',
    entitlement: 'starter',
    creditsAmount: 3,
    maxRedemptions: 10,
  });
  assert.deepEqual(await moduleCommercial.billing.redeemCode('WELCOME', 'user-1'), {
    ok: true,
    entitlement: 'starter',
  });
  assert.deepEqual(await moduleCommercial.billing.redeemCode('WELCOME', 'user-1'), {
    ok: true,
    entitlement: 'starter',
  });
  assert.equal((await moduleCommercial.credits.balance('user-1')).balance, 6);
  assert.equal(await moduleCommercial.billing.hasEntitlement('user-1', 'starter'), true);

  const checkout = await moduleCommercial.commerce.createCheckout({
    userId: 'user-1',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
    idempotencyKey: 'checkout-1',
  });
  await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-1',
    orderId: checkout.id,
    userId: 'user-1',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
    idempotencyKey: 'stripe-event-1',
  });
  await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-1',
    orderId: checkout.id,
    userId: 'user-1',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
    idempotencyKey: 'stripe-event-1',
  });
  const secondCheckout = await moduleCommercial.commerce.createCheckout({
    userId: 'user-1',
    sku: 'credits_10',
    amount: 2000,
    currency: 'usd',
    idempotencyKey: 'checkout-2',
  });
  await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-2',
    orderId: secondCheckout.id,
    userId: 'user-1',
    sku: 'credits_10',
    amount: 2000,
    currency: 'usd',
    idempotencyKey: 'stripe-event-2',
  });
  const catalogItems = await store.listCommercialCatalogItems({ productId: 'product-a' });
  const billingAccount = await store.getBillingAccount('product-a', 'user-1', 'workspace-a');
  const invoices = await store.listInvoices({ productId: 'product-a', userId: 'user-1' });
  const subscriptions = await store.listSubscriptions({
    productId: 'product-a',
    userId: 'user-1',
  });
  const revenue = await store.listRevenueBuckets({ productId: 'product-a', currency: 'usd' });

  assert.equal((await moduleCommercial.credits.balance('user-1')).balance, 26);
  assert.equal(await moduleCommercial.billing.hasEntitlement('user-1', 'pro'), true);
  assert.equal((await moduleCommercial.billing.getPlan('user-1'))?.id, 'pro');
  assert.ok(catalogItems.some((item) => item.kind === 'sku' && item.itemId === 'credits_10'));
  assert.equal(billingAccount?.paymentMethods[0]?.provider, 'stripe');
  assert.ok(invoices.some((invoice) => invoice.orderId === checkout.id && invoice.status === 'paid'));
  assert.equal(subscriptions[0]?.planId, 'pro');
  assert.equal(revenue[0]?.gross, 3000);
  assert.equal(revenue[0]?.orders, 2);

  const brokenPaidOrder = await store.createCommercialOrder({
    productId: 'product-a',
    workspaceId: 'workspace-a',
    userId: 'user-1',
    sku: 'credits_10',
    amount: 1000,
    currency: 'usd',
    provider: 'stripe',
    providerRef: 'evt-repair',
  });
  await store.updateCommercialOrderStatus(brokenPaidOrder.id, 'paid');
  const benefitReconcile = await commercial.provider.reconcilePaidOrderBenefits({
    userId: 'user-1',
  });
  assert.equal(benefitReconcile.checked, 3);
  assert.equal(benefitReconcile.repaired, 1);
  assert.equal(benefitReconcile.missing[0]?.orderId, brokenPaidOrder.id);
  assert.equal((await moduleCommercial.credits.balance('user-1')).balance, 36);
  assert.equal((await commercial.provider.reconcilePaidOrderBenefits()).repaired, 0);

  const denied = await checkRuntimeStoreCommercialRequirement({
    userId: 'user-2',
    billing: moduleCommercial.billing,
    credits: moduleCommercial.credits,
    commercial: { entitlements: ['pro'], credits: { amount: 1 } },
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.code, 'entitlement-denied');

  const allowed = await checkRuntimeStoreCommercialRequirement({
    userId: 'user-1',
    billing: moduleCommercial.billing,
    credits: moduleCommercial.credits,
    commercial: { entitlements: ['pro'], plans: ['pro'], credits: { amount: 1 } },
  });
  assert.equal(allowed.ok, true);

  const reconcile = await commercial.provider.reconcileOrders([
    { provider: 'stripe', providerRef: 'evt-1', status: 'refunded' },
    { provider: 'stripe', providerRef: 'missing', status: 'paid' },
  ]);
  assert.equal(reconcile.checked, 2);
  assert.deepEqual(
    reconcile.discrepancies.map((item) => item.reason),
    ['status-mismatch', 'missing-local-order']
  );

  const refund = await commercial.provider.applyRefund({
    provider: 'stripe',
    providerRef: 'evt-refund-1',
    orderId: checkout.id,
    amount: 1000,
    currency: 'usd',
    reason: 'customer_refund',
  });
  const duplicateRefund = await commercial.provider.applyRefund({
    provider: 'stripe',
    providerRef: 'evt-refund-1',
    orderId: checkout.id,
    amount: 1000,
    currency: 'usd',
    reason: 'customer_refund',
  });
  const creditNotes = await store.listCreditNotes({
    productId: 'product-a',
    orderId: checkout.id,
  });
  const refundedInvoices = await store.listInvoices({
    productId: 'product-a',
    userId: 'user-1',
    orderId: checkout.id,
  });
  const refundRevenue = await store.listRevenueBuckets({ productId: 'product-a', currency: 'usd' });

  assert.equal(refund.order.status, 'refunded');
  assert.equal(refund.creditNote.amount, 1000);
  assert.equal(duplicateRefund.creditNote.id, refund.creditNote.id);
  assert.equal(refund.credits[0]?.amount, -10);
  assert.equal(creditNotes.length, 1);
  assert.equal(creditNotes[0]?.id, refund.creditNote.id);
  assert.equal(refundedInvoices[0]?.status, 'refunded');
  assert.equal(refundedInvoices[0]?.refunded, 1000);
  assert.equal(refundRevenue[0]?.gross, 3000);
  assert.equal(refundRevenue[0]?.refund, 1000);
  assert.equal(refundRevenue[0]?.net, 2000);
  assert.equal((await moduleCommercial.credits.balance('user-1')).balance, 26);

  const settlement = await commercial.provider.recordSettlement({
    provider: 'stripe',
    currency: 'usd',
    periodStart: '2026-05-19T00:00:00.000Z',
    periodEnd: '2026-05-19T23:59:59.999Z',
    fee: 30,
    metadata: { source: 'unit-test' },
  });
  const settlementBatches = await store.listSettlementBatches({
    productId: 'product-a',
    provider: 'stripe',
    currency: 'usd',
  });

  assert.equal(settlement.gross, 3000);
  assert.equal(settlement.refund, 1000);
  assert.equal(settlement.fee, 30);
  assert.equal(settlement.net, 1970);
  assert.equal(settlement.invoiceCount, 2);
  assert.equal(settlement.creditNoteCount, 1);
  assert.equal(settlementBatches[0]?.id, settlement.id);

  const subscriptionEvent = await commercial.provider.recordSubscriptionEvent({
    userId: 'user-1',
    planId: 'pro',
    type: 'past_due',
    provider: 'stripe',
    providerRef: 'sub_1',
    currentPeriodStart: '2026-05-19T00:00:00.000Z',
    currentPeriodEnd: '2026-06-19T00:00:00.000Z',
  });
  const subscriptionEvents = await store.listSubscriptionEvents({
    productId: 'product-a',
    userId: 'user-1',
    planId: 'pro',
  });
  const pastDueSubscription = (
    await store.listSubscriptions({
      productId: 'product-a',
      userId: 'user-1',
      planId: 'pro',
    })
  )[0];

  assert.equal(subscriptionEvent.status, 'past_due');
  assert.equal(subscriptionEvents[0]?.type, 'past_due');
  assert.equal(pastDueSubscription?.status, 'past_due');

  const taxProfile = await commercial.admin.validateTaxProfile({
    session: adminSession,
    userId: 'user-1',
    jurisdiction: 'us-ca',
    profile: {
      taxId: 'US1234',
      company: 'Example Inc.',
    },
    evidence: {
      source: 'unit-test',
    },
  });
  assert.equal(taxProfile.jurisdiction, 'US-CA');
  assert.equal(taxProfile.validationStatus, 'valid');
  assert.equal(taxProfile.evidence.source, 'unit-test');

  const draft = await commercial.admin.upsertCatalogDraft({
    session: adminSession,
    kind: 'sku',
    itemId: 'credits_20',
    value: { credits: { amount: 20 }, planId: 'pro' },
  });
  const published = await commercial.admin.publishCatalogItem({
    session: adminSession,
    kind: 'sku',
    itemId: 'credits_20',
  });
  await commercial.admin.upsertCatalogDraft({
    session: adminSession,
    kind: 'sku',
    itemId: 'credits_20',
    value: { credits: { amount: 30 }, planId: 'pro' },
  });
  const rollback = await commercial.admin.rollbackCatalogItem({
    session: adminSession,
    kind: 'sku',
    itemId: 'credits_20',
    toVersion: draft.version,
  });
  const adminRevenue = await commercial.admin.listRevenueBuckets({ currency: 'usd' });

  assert.equal(published.status, 'published');
  assert.equal(rollback.status, 'published');
  assert.deepEqual(rollback.value, draft.value);
  assert.equal(adminRevenue[0]?.net, 2000);
});

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
  assert.equal(events[0]?.idempotencyKey, `${COMMERCIAL_ORDER_STATUS_EVENT_NAME}:${checkout.id}:paid`);
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
    (event) =>
      (event.payload as CommercialOrderStatusEventPayload).status === 'refunded'
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
  assert.equal((await moduleCommercial.credits.balance('user-stable')).balance, balanceAfterRefund.balance);
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
  assert.equal(await moduleCommercial.billing.hasEntitlement('user-provider-only', 'pro.access'), true);

  await commercial.provider.recordSubscriptionEvent({
    userId: 'user-provider-only',
    planId: 'pro',
    type: 'canceled',
    provider: 'stripe',
    providerRef: 'sub_provider_only',
    idempotencyKey: 'evt-sub-canceled',
    effectiveAt: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(await moduleCommercial.billing.hasEntitlement('user-provider-only', 'pro.access'), false);

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
  assert.equal(await moduleCommercial.billing.hasEntitlement('user-order-backed', 'pro.access'), true);

  await commercial.provider.recordSubscriptionEvent({
    userId: 'user-order-backed',
    planId: 'pro',
    type: 'canceled',
    provider: 'stripe',
    providerRef: 'sub_order_backed',
    idempotencyKey: 'evt-sub-order-canceled',
    effectiveAt: '2026-08-20T00:00:00.000Z',
  });
  assert.equal(await moduleCommercial.billing.hasEntitlement('user-order-backed', 'pro.access'), false);

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

test('P15 commercial orders are workspace scoped and refund guarded', async () => {
  const store = createInMemoryRuntimeStore();
  const orderA = await store.createCommercialOrder({
    productId: 'product-order-scope',
    workspaceId: 'workspace-a',
    userId: 'user-scope',
    sku: 'sku-basic',
    amount: 100,
    currency: 'usd',
    provider: 'local',
    providerRef: 'shared-provider-ref',
    idempotencyKey: 'shared-idempotency',
  });
  const orderB = await store.createCommercialOrder({
    productId: 'product-order-scope',
    workspaceId: 'workspace-b',
    userId: 'user-scope',
    sku: 'sku-basic',
    amount: 100,
    currency: 'usd',
    provider: 'local',
    providerRef: 'shared-provider-ref',
    idempotencyKey: 'shared-idempotency',
  });

  assert.notEqual(orderA.id, orderB.id);
  assert.equal(
    (
      await store.findCommercialOrderByProviderRef(
        'product-order-scope',
        'workspace-a',
        'local',
        'shared-provider-ref'
      )
    )?.id,
    orderA.id
  );
  assert.equal(
    (
      await store.findCommercialOrderByProviderRef(
        'product-order-scope',
        'workspace-b',
        'local',
        'shared-provider-ref'
      )
    )?.id,
    orderB.id
  );
  assert.equal(
    (
      await store.listCommercialOrders({
        productId: 'product-order-scope',
        workspaceId: null,
        userId: 'user-scope',
      })
    ).length,
    0
  );

  const commercialA = createRuntimeStoreCommercialRuntime({
    store,
    productId: 'product-order-runtime',
    workspaceId: 'workspace-a',
  });
  const commercialB = createRuntimeStoreCommercialRuntime({
    store,
    productId: 'product-order-runtime',
    workspaceId: 'workspace-b',
  });
  const checkout = await commercialA.forModule('paid-tool').commerce.createCheckout({
    userId: 'user-scope',
    sku: 'sku-basic',
    amount: 100,
    currency: 'usd',
  });

  assert.equal(await commercialB.forModule('paid-tool').commerce.getOrder(checkout.id), null);
  await assert.rejects(
    () =>
      commercialA.provider.applyRefund({
        provider: 'local',
        providerRef: 'refund-before-paid',
        orderId: checkout.id,
        amount: 100,
        currency: 'usd',
      }),
    /MODULE_COMMERCIAL_REFUND_ORDER_NOT_PAID/
  );
});

test('P15 commercial invoices and credit notes keep one ledger fact per source', async () => {
  const store = createInMemoryRuntimeStore();

  const invoice = await store.upsertInvoice({
    id: 'invoice-a',
    productId: 'product-invoice',
    workspaceId: 'workspace-a',
    userId: 'user-invoice',
    orderId: 'order-1',
    number: 'INV-1',
    status: 'paid',
    subtotal: 100,
    total: 100,
    currency: 'usd',
    paidAt: '2026-05-19T00:00:00.000Z',
  });
  const replayedInvoice = await store.upsertInvoice({
    id: 'invoice-b',
    productId: 'product-invoice',
    workspaceId: 'workspace-a',
    userId: 'user-invoice',
    orderId: 'order-1',
    status: 'refunded',
    subtotal: 100,
    total: 100,
    refunded: 25,
    currency: 'usd',
  });

  assert.equal(replayedInvoice.id, invoice.id);
  assert.equal(replayedInvoice.refunded, 25);
  assert.equal(
    (
      await store.listInvoices({
        productId: 'product-invoice',
        workspaceId: 'workspace-a',
        userId: 'user-invoice',
      })
    ).length,
    1
  );
  assert.equal(
    (
      await store.listInvoices({
        productId: 'product-invoice',
        workspaceId: null,
        userId: 'user-invoice',
      })
    ).length,
    0
  );
  await assert.rejects(
    () =>
      store.upsertInvoice({
        id: 'invoice-c',
        productId: 'product-invoice',
        workspaceId: 'workspace-a',
        userId: 'user-invoice',
        orderId: 'order-2',
        number: 'INV-1',
        status: 'paid',
        subtotal: 100,
        total: 100,
        currency: 'usd',
      }),
    /RUNTIME_STORE_INVOICE_NUMBER_CONFLICT/
  );

  const creditNote = await store.createCreditNote({
    id: 'credit-note-a',
    productId: 'product-invoice',
    workspaceId: 'workspace-a',
    userId: 'user-invoice',
    orderId: 'order-1',
    invoiceId: invoice.id,
    number: 'CN-1',
    amount: 25,
    currency: 'usd',
    provider: 'stripe',
    providerRef: 'refund-1',
  });
  const replayedCreditNote = await store.createCreditNote({
    id: 'credit-note-b',
    productId: 'product-invoice',
    workspaceId: 'workspace-a',
    userId: 'user-invoice',
    orderId: 'order-1',
    invoiceId: invoice.id,
    number: 'CN-2',
    amount: 99,
    currency: 'usd',
    provider: 'stripe',
    providerRef: 'refund-1',
  });

  assert.equal(replayedCreditNote.id, creditNote.id);
  assert.equal(replayedCreditNote.amount, 25);
  assert.equal(
    (
      await store.listCreditNotes({
        productId: 'product-invoice',
        workspaceId: 'workspace-a',
        userId: 'user-invoice',
      })
    ).length,
    1
  );
  assert.equal(
    (
      await store.listCreditNotes({
        productId: 'product-invoice',
        workspaceId: null,
        userId: 'user-invoice',
      })
    ).length,
    0
  );
  await assert.rejects(
    () =>
      store.createCreditNote({
        id: 'credit-note-c',
        productId: 'product-invoice',
        workspaceId: 'workspace-a',
        userId: 'user-invoice',
        orderId: 'order-1',
        invoiceId: invoice.id,
        number: 'CN-1',
        amount: 10,
        currency: 'usd',
        provider: 'stripe',
        providerRef: 'refund-2',
      }),
    /RUNTIME_STORE_CREDIT_NOTE_NUMBER_CONFLICT/
  );
});

test('P15 commercial credit ledger idempotency is workspace scoped', async () => {
  const store = createInMemoryRuntimeStore();

  await store.recordCreditLedger({
    productId: 'product-scope',
    workspaceId: 'workspace-a',
    userId: 'user-scope',
    amount: 5,
    unit: 'credit',
    reason: 'grant',
    idempotencyKey: 'same-key',
  });
  await store.recordCreditLedger({
    productId: 'product-scope',
    workspaceId: 'workspace-b',
    userId: 'user-scope',
    amount: 7,
    unit: 'credit',
    reason: 'grant',
    idempotencyKey: 'same-key',
  });

  assert.equal(
    (
      await store.getCreditBalance({
        productId: 'product-scope',
        workspaceId: 'workspace-a',
        userId: 'user-scope',
      })
    ).balance,
    5
  );
  assert.equal(
    (
      await store.getCreditBalance({
        productId: 'product-scope',
        workspaceId: 'workspace-b',
        userId: 'user-scope',
      })
    ).balance,
    7
  );
  assert.equal(
    (
      await store.listCreditLedger({
        productId: 'product-scope',
        workspaceId: null,
        userId: 'user-scope',
      })
    ).length,
    0
  );
});

test('P16 commercial primitives are subject-first, idempotent and lifecycle aware', async () => {
  let nextId = 0;
  const store = createInMemoryRuntimeStore({
    now: () => new Date('2026-05-19T10:00:00.000Z'),
    createId: (prefix) => `${prefix}_primitive_${++nextId}`,
  });
  const commercial = createRuntimeStoreCommercialRuntime({
    store,
    productId: 'product-primitives',
    workspaceId: 'workspace-primitives',
    planCatalog: [{ id: 'team', name: 'Team', entitlements: ['team.access'] }],
    skuCatalog: {
      team_pack: {
        credits: { amount: 25, unit: 'ai-credit' },
        planId: 'team',
      },
    },
  });
  const moduleCommercial = commercial.forModule('primitive-tool');
  const workspaceSubject = { type: 'workspace' as const, id: 'workspace-wallet' };
  const userSubject = { type: 'user' as const, id: 'user-wallet' };

  await moduleCommercial.credits.grant({
    subject: workspaceSubject,
    amount: 10,
    unit: 'ai-credit',
    source: 'manual',
    sourceId: 'grant-1',
    idempotencyKey: 'grant-workspace',
  });
  await moduleCommercial.credits.grant({
    subject: workspaceSubject,
    amount: 10,
    unit: 'ai-credit',
    source: 'manual',
    sourceId: 'grant-1',
    idempotencyKey: 'grant-workspace',
  });
  assert.equal(
    (await moduleCommercial.credits.balance({ subject: workspaceSubject, unit: 'ai-credit' }))
      .balance,
    10
  );

  const reservation = await moduleCommercial.credits.reserve({
    subject: workspaceSubject,
    amount: 4,
    unit: 'ai-credit',
    reason: 'ai.reserve',
    source: 'task',
    sourceId: 'task-1',
    idempotencyKey: 'reserve-task-1',
  });
  assert.equal(reservation.status, 'reserved');
  assert.equal(
    (await moduleCommercial.credits.balance({ subject: workspaceSubject, unit: 'ai-credit' }))
      .balance,
    6
  );
  assert.equal(
    (
      await moduleCommercial.credits.commitReservation({
        reservationId: reservation.id,
        finalAmount: 3,
        idempotencyKey: 'commit-task-1',
      })
    ).balance,
    7
  );
  assert.equal(
    (
      await moduleCommercial.credits.releaseReservation({
        reservationId: reservation.id,
        reason: 'late.provider.failed',
        idempotencyKey: 'release-after-commit-task-1',
      })
    ).balance,
    7
  );
  assert.equal((await store.getCreditReservation(reservation.id))?.status, 'committed');
  const invalidReservation = await moduleCommercial.credits.reserve({
    subject: workspaceSubject,
    amount: 1,
    unit: 'ai-credit',
    source: 'task',
    sourceId: 'task-invalid',
    idempotencyKey: 'reserve-task-invalid',
  });
  await assert.rejects(
    () =>
      moduleCommercial.credits.commitReservation({
        reservationId: invalidReservation.id,
        finalAmount: -1,
      }),
    /MODULE_COMMERCIAL_INVALID_AMOUNT/
  );
  assert.equal(
    (
      await moduleCommercial.credits.releaseReservation({
        reservationId: invalidReservation.id,
        idempotencyKey: 'release-task-invalid',
      })
    ).balance,
    7
  );
  assert.equal(
    (
      await moduleCommercial.credits.listLedger({
        subject: workspaceSubject,
        unit: 'ai-credit',
      })
    ).find(
      (entry) =>
        entry.reservationId === invalidReservation.id && entry.reason === 'reserve.release'
    )?.direction,
    'release'
  );
  assert.equal(
    (
      await moduleCommercial.credits.commitReservation({
        reservationId: reservation.id,
        finalAmount: 3,
        idempotencyKey: 'commit-task-1',
      })
    ).balance,
    7
  );

  const secondReservation = await moduleCommercial.credits.reserve({
    subject: workspaceSubject,
    amount: 2,
    unit: 'ai-credit',
    source: 'task',
    sourceId: 'task-2',
    idempotencyKey: 'reserve-task-2',
  });
  assert.equal(
    (
      await moduleCommercial.credits.releaseReservation({
        reservationId: secondReservation.id,
        reason: 'provider.failed',
        idempotencyKey: 'release-task-2',
      })
    ).balance,
    7
  );
  assert.equal(
    (
      await moduleCommercial.credits.releaseReservation({
        reservationId: secondReservation.id,
        reason: 'provider.failed',
        idempotencyKey: 'release-task-2',
      })
    ).balance,
    7
  );

  const charge = await moduleCommercial.metering.charge({
    subject: workspaceSubject,
    meter: 'ai.generate',
    quantity: 1200,
    unit: 'token',
    credits: { amount: 2, unit: 'ai-credit' },
    idempotencyKey: 'charge-1',
    metadata: {
      provider: 'openai',
      model: 'gpt-4.1',
    },
  });
  const replayedCharge = await moduleCommercial.metering.charge({
    subject: workspaceSubject,
    meter: 'ai.generate',
    quantity: 1200,
    unit: 'token',
    credits: { amount: 2, unit: 'ai-credit' },
    idempotencyKey: 'charge-1',
    metadata: {
      provider: 'openai',
      model: 'gpt-4.1',
    },
  });
  assert.equal(replayedCharge.id, charge.id);
  assert.equal(replayedCharge.usageId, charge.usageId);
  assert.equal(replayedCharge.meteringId, charge.meteringId);
  assert.equal(
    (await moduleCommercial.credits.balance({ subject: workspaceSubject, unit: 'ai-credit' }))
      .balance,
    5
  );

  await assert.rejects(
    () =>
      moduleCommercial.metering.charge({
        subject: workspaceSubject,
        meter: 'ai.generate',
        credits: { amount: 99, unit: 'ai-credit' },
        idempotencyKey: 'charge-too-large',
      }),
    /MODULE_CREDITS_INSUFFICIENT/
  );
  await assert.rejects(
    () =>
      moduleCommercial.metering.charge({
        subject: workspaceSubject,
        meter: 'ai.generate',
        credits: { amount: -1, unit: 'ai-credit' },
        idempotencyKey: 'charge-negative',
      }),
    /MODULE_COMMERCIAL_INVALID_AMOUNT/
  );
  assert.equal(
    (
      await store.listUsage({
        productId: 'product-primitives',
        moduleId: 'primitive-tool',
      })
    ).filter((record) => record.idempotencyKey?.startsWith('charge-too-large')).length,
    0
  );
  const overageReservation = await moduleCommercial.credits.reserve({
    subject: workspaceSubject,
    amount: 1,
    unit: 'ai-credit',
    source: 'task',
    sourceId: 'task-overage',
    idempotencyKey: 'reserve-task-overage',
  });
  await assert.rejects(
    () =>
      moduleCommercial.metering.charge({
        subject: workspaceSubject,
        meter: 'ai.generate',
        credits: { amount: 99, unit: 'ai-credit' },
        reservationId: overageReservation.id,
        idempotencyKey: 'charge-reservation-overage',
      }),
    /MODULE_CREDITS_INSUFFICIENT/
  );
  assert.equal(
    (
      await store.listMetering({
        productId: 'product-primitives',
        moduleId: 'primitive-tool',
      })
    ).find((record) => record.idempotencyKey === 'charge-reservation-overage:metering')?.status,
    'voided'
  );
  await moduleCommercial.credits.releaseReservation({
    reservationId: overageReservation.id,
    idempotencyKey: 'release-task-overage',
  });

  const entitlement = await moduleCommercial.entitlements.grant({
    subject: userSubject,
    entitlement: 'feature.pro',
    source: 'manual',
    sourceId: 'grant-entitlement-1',
    idempotencyKey: 'grant-entitlement-1',
  });
  assert.equal(
    await moduleCommercial.entitlements.has({
      subject: userSubject,
      entitlement: 'feature.pro',
    }),
    true
  );
  assert.equal((await moduleCommercial.entitlements.list({ subject: userSubject })).length, 1);
  await moduleCommercial.entitlements.revoke({
    id: entitlement.id,
    reason: 'manual.revoke',
    idempotencyKey: 'revoke-entitlement-1',
  });
  assert.equal(
    await moduleCommercial.entitlements.has({
      subject: userSubject,
      entitlement: 'feature.pro',
    }),
    false
  );

  const checkout = await moduleCommercial.commerce.createCheckout({
    buyer: userSubject,
    beneficiary: workspaceSubject,
    sku: 'team_pack',
    amount: 2500,
    currency: 'usd',
    idempotencyKey: 'checkout-workspace',
  });
  const paid = await moduleCommercial.commerce.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: 'evt-primitive-paid',
    orderId: checkout.id,
    buyer: userSubject,
    beneficiary: workspaceSubject,
    sku: 'team_pack',
    amount: 2500,
    currency: 'usd',
    idempotencyKey: 'evt-primitive-paid',
  });
  assert.equal(paid.order.beneficiary?.type, 'workspace');
  assert.equal(
    (await moduleCommercial.credits.balance({ subject: workspaceSubject, unit: 'ai-credit' }))
      .balance,
    30
  );
  assert.equal(
    await moduleCommercial.entitlements.has({
      subject: workspaceSubject,
      entitlement: 'team.access',
    }),
    true
  );
  const refunded = await moduleCommercial.commerce.applyRefund({
    provider: 'stripe',
    providerRef: 'evt-primitive-refund',
    orderId: checkout.id,
    amount: 2500,
    currency: 'usd',
    idempotencyKey: 'evt-primitive-refund',
  });
  assert.equal(refunded.order.status, 'refunded');
  assert.equal(
    await moduleCommercial.entitlements.has({
      subject: workspaceSubject,
      entitlement: 'team.access',
    }),
    false
  );
  assert.equal(
    (await moduleCommercial.credits.balance({ subject: workspaceSubject, unit: 'ai-credit' }))
      .balance,
    5
  );

  const batch = await moduleCommercial.redeemCodes.createBatch({
    count: 2,
    prefix: 'TEAM',
    entitlement: 'redeem.access',
    credits: { amount: 3, unit: 'ai-credit' },
    maxRedemptions: 1,
    metadata: { campaign: 'launch' },
  });
  assert.equal(batch.codes.length, 2);
  assert.equal(batch.codes[0]?.code, undefined);
  assert.match(batch.codes[0]?.maskedCode ?? '', /^TEAM/);
  assert.equal((await moduleCommercial.redeemCodes.list({ batchId: batch.batchId })).length, 2);
  const plainCode = batch.codes[0]?.metadata.rawCode;
  assert.equal(typeof plainCode, 'string');
  const redeemed = await moduleCommercial.redeemCodes.redeem({
    code: plainCode as string,
    subject: userSubject,
    email: 'User@Example.com',
    idempotencyKey: 'redeem-1',
  });
  assert.equal(redeemed.ok, true);
  assert.equal(redeemed.entitlement, 'redeem.access');
  assert.equal(
    await moduleCommercial.entitlements.has({
      subject: userSubject,
      entitlement: 'redeem.access',
    }),
    true
  );
  assert.equal(
    (await moduleCommercial.credits.balance({ subject: userSubject, unit: 'ai-credit' }))
      .balance,
    3
  );
  const redeemAttempts = await store.listAudit({
    productId: 'product-primitives',
    type: 'commercial.redeem_code.attempt',
  });
  assert.equal(redeemAttempts.some((record) => record.metadata.email === 'User@Example.com'), false);
  assert.ok(redeemAttempts.some((record) => record.metadata.contactMasked === 'u***@example.com'));
  assert.equal((await moduleCommercial.redeemCodes.listRedemptions({ subject: userSubject })).length, 1);
  assert.equal((await moduleCommercial.redeemCodes.freeze({ batchId: batch.batchId })).frozen, 1);
  assert.equal(
    (
      await moduleCommercial.redeemCodes.redeem({
        code: batch.codes[1]?.metadata.rawCode as string,
        subject: userSubject,
      })
    ).ok,
    false
  );

  await assert.rejects(
    () =>
      moduleCommercial.redeemCodes.createBatch({
        count: 0,
        maxRedemptions: 1,
      }),
    /MODULE_REDEEM_CODES_INVALID_COUNT/
  );
  const boundBatch = await moduleCommercial.redeemCodes.createBatch({
    count: 1,
    prefix: 'BOUND',
    entitlement: 'bound.access',
    maxRedemptions: 1,
    bind: { email: 'bound@example.com' },
  });
  const boundCode = boundBatch.codes[0]?.metadata.rawCode as string;
  assert.equal(
    (
      await moduleCommercial.redeemCodes.redeem({
        code: boundCode,
        subject: userSubject,
        email: 'wrong@example.com',
      })
    ).ok,
    false
  );
  assert.equal(
    await moduleCommercial.entitlements.has({
      subject: userSubject,
      entitlement: 'bound.access',
    }),
    false
  );
  assert.equal(
    (
      await moduleCommercial.redeemCodes.redeem({
        code: boundCode,
        subject: userSubject,
        email: 'bound@example.com',
      })
    ).ok,
    true
  );
  const [boundRedemption] = await moduleCommercial.redeemCodes.listRedemptions({
    codeId: boundBatch.codes[0]?.id,
    subject: userSubject,
  });
  assert.equal(boundRedemption?.metadata.bind, '[REDACTED]');
  const expiredBatch = await moduleCommercial.redeemCodes.createBatch({
    count: 1,
    prefix: 'OLD',
    entitlement: 'expired.access',
    maxRedemptions: 1,
    expiresAt: '2000-01-01T00:00:00.000Z',
  });
  assert.equal(
    (
      await moduleCommercial.redeemCodes.list({
        batchId: expiredBatch.batchId,
        status: 'expired',
      })
    ).length,
    1
  );
  assert.equal(
    (
      await moduleCommercial.redeemCodes.redeem({
        code: expiredBatch.codes[0]?.metadata.rawCode as string,
        subject: userSubject,
      })
    ).ok,
    false
  );

  const riskEvent = await moduleCommercial.risk.record({
    subject: userSubject,
    type: 'redeem.suspicious',
    severity: 'high',
    source: 'redeem',
    sourceId: redeemed.redemption?.id,
  });
  assert.equal(riskEvent.severity, 'high');
  await moduleCommercial.risk.block({
    subject: userSubject,
    scope: 'redeem',
    reason: 'too_many_attempts',
    idempotencyKey: 'risk-block-1',
  });
  assert.deepEqual(await moduleCommercial.risk.check({ subject: userSubject, scope: 'redeem' }), {
    ok: false,
    reason: 'too_many_attempts',
  });
});
