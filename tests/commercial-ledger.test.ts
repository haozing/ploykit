import assert from 'node:assert/strict';
import test from 'node:test';
import { createInMemoryRuntimeStore } from '../src/lib/module-runtime';
import {
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

  await commercial.admin.createRedeemCode({
    session: adminSession,
    code: 'SINGLE_USE',
    entitlement: 'single',
    maxRedemptions: 1,
  });
  assert.deepEqual(await moduleCommercial.billing.redeemCode('SINGLE_USE', 'user-2'), {
    ok: true,
    entitlement: 'single',
  });
  assert.deepEqual(await moduleCommercial.billing.redeemCode('SINGLE_USE', 'user-3'), {
    ok: false,
    entitlement: undefined,
  });

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
  assert.ok(
    invoices.some((invoice) => invoice.orderId === checkout.id && invoice.status === 'paid')
  );
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
