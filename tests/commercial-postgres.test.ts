import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Pool } from 'pg';
import {
  createPgModuleDataExecutor,
  createPostgresRuntimeStore,
  verifyRuntimeStoreSchema,
} from '../src/lib/module-runtime';
import {
  createRuntimeStoreCommercialRuntime,
} from '../src/lib/module-capabilities';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://ploykit:ploykit@127.0.0.1:55432/ploykit';

async function databaseReachable(): Promise<boolean> {
  const pool = new Pool({ connectionString: DATABASE_URL });
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function resetRuntimeTables(pool: Pool): Promise<void> {
  await pool.query(`
    drop table if exists module_revenue_buckets cascade;
    drop table if exists module_tax_profiles cascade;
    drop table if exists module_subscriptions cascade;
    drop table if exists module_invoices cascade;
    drop table if exists module_billing_accounts cascade;
    drop table if exists module_commercial_catalog cascade;
    drop table if exists module_worker_registry cascade;
    drop table if exists module_delivery_ledger cascade;
    drop table if exists module_product_scope_memberships cascade;
    drop table if exists module_catalog_states cascade;
    drop table if exists module_redeem_redemptions cascade;
    drop table if exists module_redeem_codes cascade;
    drop table if exists module_api_keys cascade;
    drop table if exists module_risk_blocks cascade;
    drop table if exists module_risk_events cascade;
    drop table if exists module_commercial_orders cascade;
    drop table if exists module_commercial_entitlements cascade;
    drop table if exists module_files cascade;
    drop table if exists module_credit_reservations cascade;
    drop table if exists module_credit_ledger cascade;
    drop table if exists module_metering_ledger cascade;
    drop table if exists module_usage_records cascade;
    drop table if exists module_audit_logs cascade;
    drop table if exists module_webhook_receipts cascade;
    drop table if exists module_outbox cascade;
    drop table if exists module_run_logs cascade;
    drop table if exists module_runs cascade;
  `);
}

test('P15 Postgres commercial runtime persists credits, orders, entitlements and provider idempotency', async (t) => {
  if (!(await databaseReachable())) {
    t.skip(`Postgres is not reachable at ${DATABASE_URL}. Start it with npm run db:up.`);
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  const executor = createPgModuleDataExecutor(pool);
  let nextId = 0;
  try {
    await resetRuntimeTables(pool);
    const store = createPostgresRuntimeStore({
      database: executor,
      createId: (prefix) => `${prefix}_p15_${++nextId}`,
    });
    await store.ensureSchema?.();
    const schema = await verifyRuntimeStoreSchema(executor);
    assert.equal(schema.ok, true);
    assert.deepEqual(schema.missing, []);
    assert.deepEqual(schema.columnIssues, []);
    assert.deepEqual(schema.indexIssues, []);
    assert.deepEqual(schema.migrationIssues, []);

    const commercial = createRuntimeStoreCommercialRuntime({
      store,
      productId: 'product-a',
      workspaceId: 'workspace-a',
      planCatalog: [{ id: 'pro', name: 'Pro', entitlements: ['pro'] }],
      skuCatalog: {
        credits_10: {
          credits: { amount: 10 },
          planId: 'pro',
        },
      },
    });
    const moduleCommercial = commercial.forModule('paid-tool');

    const checkout = await moduleCommercial.commerce.createCheckout({
      userId: 'user-1',
      sku: 'credits_10',
      amount: 1000,
      currency: 'usd',
      idempotencyKey: 'checkout-1',
    });
    await commercial.provider.applyCheckoutPaid({
      provider: 'stripe',
      providerRef: 'evt-paid-1',
      orderId: checkout.id,
      userId: 'user-1',
      sku: 'credits_10',
      amount: 1000,
      currency: 'usd',
      idempotencyKey: 'evt-paid-1',
    });
    await commercial.provider.applyCheckoutPaid({
      provider: 'stripe',
      providerRef: 'evt-paid-1',
      orderId: checkout.id,
      userId: 'user-1',
      sku: 'credits_10',
      amount: 1000,
      currency: 'usd',
      idempotencyKey: 'evt-paid-1',
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
      providerRef: 'evt-paid-2',
      orderId: secondCheckout.id,
      userId: 'user-1',
      sku: 'credits_10',
      amount: 2000,
      currency: 'usd',
      idempotencyKey: 'evt-paid-2',
    });
    assert.ok(
      (await store.listInvoices({ productId: 'product-a' })).some(
        (invoice) => invoice.orderId === checkout.id
      )
    );
    assert.equal(
      (await store.listSubscriptions({ productId: 'product-a', userId: 'user-1' }))[0]?.planId,
      'pro'
    );
    const taxCommercial = createRuntimeStoreCommercialRuntime({
      store,
      productId: 'product-tax',
      workspaceId: 'workspace-tax',
      skuCatalog: {
        taxable_monthly: {
          credits: { amount: 10 },
        },
      },
    });
    const taxProfile = await taxCommercial.admin.validateTaxProfile({
      session: { user: { id: 'admin-1', role: 'admin' }, actorId: 'admin-1' },
      userId: 'user-1',
      jurisdiction: 'us-ca',
      profile: {
        company: 'Taxable Inc.',
        country: 'US',
        taxId: 'US12345678',
      },
      evidence: { source: 'postgres-test' },
    });
    assert.equal(await store.getTaxProfile('product-tax', 'user-1', null), null);
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
    const taxableCheckout = await taxCommercial.forModule('paid-tool').commerce.createCheckout({
      userId: 'user-1',
      sku: 'taxable_monthly',
      amount: 1000,
      currency: 'usd',
      idempotencyKey: 'checkout-tax',
    });
    await taxCommercial.provider.applyCheckoutPaid({
      provider: 'stripe',
      providerRef: 'evt-paid-tax',
      orderId: taxableCheckout.id,
      userId: 'user-1',
      sku: 'taxable_monthly',
      amount: 1000,
      currency: 'usd',
      idempotencyKey: 'evt-paid-tax',
    });
    const taxInvoice = (
      await store.listInvoices({
        productId: 'product-tax',
        workspaceId: 'workspace-tax',
        userId: 'user-1',
        orderId: taxableCheckout.id,
      })
    )[0];
    assert.equal(taxInvoice?.taxSnapshot?.taxProfileId, taxProfile.id);
    assert.equal(taxInvoice?.taxSnapshot?.jurisdiction, 'US-CA');
    assert.equal(taxInvoice?.taxSnapshot?.taxIdMasked, '***5678');
    assert.equal(taxInvoice?.taxSnapshot?.taxId, undefined);
    const subscriptionEvent = await commercial.provider.recordSubscriptionEvent({
      userId: 'user-1',
      planId: 'pro',
      type: 'past_due',
      provider: 'stripe',
      providerRef: 'sub_postgres_1',
      idempotencyKey: 'evt-sub-postgres-1',
      currentPeriodStart: '2026-05-19T00:00:00.000Z',
      currentPeriodEnd: '2026-06-19T00:00:00.000Z',
      effectiveAt: '2026-05-20T00:00:00.000Z',
    });
    const duplicateSubscriptionEvent = await commercial.provider.recordSubscriptionEvent({
      userId: 'user-1',
      planId: 'pro',
      type: 'past_due',
      provider: 'stripe',
      providerRef: 'sub_postgres_1',
      idempotencyKey: 'evt-sub-postgres-1',
      currentPeriodStart: '2026-05-19T00:00:00.000Z',
      currentPeriodEnd: '2026-06-19T00:00:00.000Z',
      effectiveAt: '2026-05-20T00:00:00.000Z',
    });
    const subscriptionEvents = await store.listSubscriptionEvents({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      userId: 'user-1',
      planId: 'pro',
    });
    assert.equal(duplicateSubscriptionEvent.id, subscriptionEvent.id);
    assert.equal(subscriptionEvents.length, 1);
    assert.equal(subscriptionEvents[0]?.idempotencyKey, 'evt-sub-postgres-1');
    assert.equal(
      (await store.listSubscriptions({
        productId: 'product-a',
        workspaceId: null,
        userId: 'user-1',
      })).length,
      0
    );
    assert.equal(
      (await store.listSubscriptionEvents({
        productId: 'product-a',
        workspaceId: null,
        userId: 'user-1',
      })).length,
      0
    );
    assert.equal(
      (await store.getBillingAccount('product-a', 'user-1', 'workspace-a'))?.paymentMethods[0]
        ?.provider,
      'stripe'
    );
    assert.equal(
      (await store.listCommercialCatalogItems({ productId: 'product-a', kind: 'sku' }))[0]
        ?.itemId,
      'credits_10'
    );
    assert.equal(
      (await store.listRevenueBuckets({ productId: 'product-a', currency: 'usd' }))[0]?.gross,
      3000
    );
    assert.equal(
      (await store.listRevenueBuckets({ productId: 'product-a', currency: 'usd' }))[0]?.orders,
      2
    );
    await store.upsertRevenueBucket({
      productId: 'product-null-workspace',
      bucketDate: '2026-05-19',
      currency: 'usd',
      gross: 100,
      net: 100,
    });
    await store.upsertRevenueBucket({
      productId: 'product-null-workspace',
      bucketDate: '2026-05-19',
      currency: 'usd',
      gross: 150,
      net: 150,
    });
    const nullWorkspaceBuckets = await store.listRevenueBuckets({
      productId: 'product-null-workspace',
      workspaceId: null,
      currency: 'usd',
    });
    assert.equal(nullWorkspaceBuckets.length, 1);
    assert.equal(nullWorkspaceBuckets[0]?.gross, 150);
    const scopedOrderA = await store.createCommercialOrder({
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
    const scopedOrderB = await store.createCommercialOrder({
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
    assert.notEqual(scopedOrderA.id, scopedOrderB.id);
    assert.equal(
      (
        await store.findCommercialOrderByProviderRef(
          'product-order-scope',
          'workspace-a',
          'local',
          'shared-provider-ref'
        )
      )?.id,
      scopedOrderA.id
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
      scopedOrderB.id
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
    const invoice = await store.upsertInvoice({
      id: 'invoice-postgres-a',
      productId: 'product-invoice-scope',
      workspaceId: 'workspace-a',
      userId: 'user-invoice',
      orderId: 'order-1',
      number: 'INV-PG-1',
      status: 'paid',
      subtotal: 100,
      total: 100,
      currency: 'usd',
      paidAt: '2026-05-19T00:00:00.000Z',
    });
    const replayedInvoice = await store.upsertInvoice({
      id: 'invoice-postgres-b',
      productId: 'product-invoice-scope',
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
          productId: 'product-invoice-scope',
          workspaceId: 'workspace-a',
          userId: 'user-invoice',
        })
      ).length,
      1
    );
    assert.equal(
      (
        await store.listInvoices({
          productId: 'product-invoice-scope',
          workspaceId: null,
          userId: 'user-invoice',
        })
      ).length,
      0
    );
    await assert.rejects(
      () =>
        store.upsertInvoice({
          id: 'invoice-postgres-c',
          productId: 'product-invoice-scope',
          workspaceId: 'workspace-a',
          userId: 'user-invoice',
          orderId: 'order-2',
          number: 'INV-PG-1',
          status: 'paid',
          subtotal: 100,
          total: 100,
          currency: 'usd',
        }),
      /RUNTIME_STORE_INVOICE_NUMBER_CONFLICT/
    );
    const creditNote = await store.createCreditNote({
      id: 'credit-note-postgres-a',
      productId: 'product-invoice-scope',
      workspaceId: 'workspace-a',
      userId: 'user-invoice',
      orderId: 'order-1',
      invoiceId: invoice.id,
      number: 'CN-PG-1',
      amount: 25,
      currency: 'usd',
      provider: 'stripe',
      providerRef: 'refund-1',
    });
    const replayedCreditNote = await store.createCreditNote({
      id: 'credit-note-postgres-b',
      productId: 'product-invoice-scope',
      workspaceId: 'workspace-a',
      userId: 'user-invoice',
      orderId: 'order-1',
      invoiceId: invoice.id,
      number: 'CN-PG-2',
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
          productId: 'product-invoice-scope',
          workspaceId: 'workspace-a',
          userId: 'user-invoice',
        })
      ).length,
      1
    );
    assert.equal(
      (
        await store.listCreditNotes({
          productId: 'product-invoice-scope',
          workspaceId: null,
          userId: 'user-invoice',
        })
      ).length,
      0
    );
    await assert.rejects(
      () =>
        store.createCreditNote({
          id: 'credit-note-postgres-c',
          productId: 'product-invoice-scope',
          workspaceId: 'workspace-a',
          userId: 'user-invoice',
          orderId: 'order-1',
          invoiceId: invoice.id,
          number: 'CN-PG-1',
          amount: 10,
          currency: 'usd',
          provider: 'stripe',
          providerRef: 'refund-2',
        }),
      /RUNTIME_STORE_CREDIT_NOTE_NUMBER_CONFLICT/
    );
    await store.recordCreditLedger({
      productId: 'product-credit-scope',
      workspaceId: 'workspace-a',
      userId: 'user-scope',
      amount: 5,
      unit: 'credit',
      reason: 'grant',
      idempotencyKey: 'same-key',
    });
    await store.recordCreditLedger({
      productId: 'product-credit-scope',
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
          productId: 'product-credit-scope',
          workspaceId: 'workspace-a',
          userId: 'user-scope',
        })
      ).balance,
      5
    );
    assert.equal(
      (
        await store.getCreditBalance({
          productId: 'product-credit-scope',
          workspaceId: 'workspace-b',
          userId: 'user-scope',
        })
      ).balance,
      7
    );
    assert.equal(
      (
        await store.listCreditLedger({
          productId: 'product-credit-scope',
          workspaceId: null,
          userId: 'user-scope',
        })
      ).length,
      0
    );
    const raceCommercial = createRuntimeStoreCommercialRuntime({
      store,
      productId: 'product-credit-race',
      workspaceId: 'workspace-a',
    }).forModule('paid-tool');
    await store.recordCreditLedger({
      productId: 'product-credit-race',
      workspaceId: 'workspace-a',
      userId: 'user-race',
      amount: 1,
      unit: 'credit',
      reason: 'grant',
    });
    const raceResults = await Promise.allSettled([
      raceCommercial.credits.consume({
        userId: 'user-race',
        amount: 1,
        idempotencyKey: 'race-1',
      }),
      raceCommercial.credits.consume({
        userId: 'user-race',
        amount: 1,
        idempotencyKey: 'race-2',
      }),
    ]);
    assert.equal(raceResults.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(raceResults.filter((result) => result.status === 'rejected').length, 1);
    assert.equal((await raceCommercial.credits.balance('user-race')).balance, 0);
    await commercial.admin.createRedeemCode({
      session: { user: { id: 'admin-1', role: 'admin' }, actorId: 'admin-1' },
      code: 'PG_SINGLE_USE',
      entitlement: 'postgres-single',
      maxRedemptions: 1,
    });
    const redeemRaceResults = await Promise.all([
      moduleCommercial.billing.redeemCode('PG_SINGLE_USE', 'redeem-user-1'),
      moduleCommercial.billing.redeemCode('PG_SINGLE_USE', 'redeem-user-2'),
    ]);
    assert.equal(redeemRaceResults.filter((result) => result.ok).length, 1);
    assert.equal(redeemRaceResults.filter((result) => !result.ok).length, 1);
    assert.equal((await store.listRedeemRedemptions({ productId: 'product-a' })).length, 1);
    await store.recordCreditLedger({
      productId: 'product-a',
      workspaceId: 'workspace-a',
      userId: 'user-1',
      amount: 5,
      unit: 'credit',
      reason: 'expired-test',
      expiresAt: '2000-01-01T00:00:00.000Z',
      idempotencyKey: 'expired-test',
    });

    const nextStore = createPostgresRuntimeStore({ database: executor });
    const nextCommercial = createRuntimeStoreCommercialRuntime({
      store: nextStore,
      productId: 'product-a',
      workspaceId: 'workspace-a',
      planCatalog: [{ id: 'pro', name: 'Pro', entitlements: ['pro'] }],
    });
    assert.equal(
      (await nextCommercial.forModule('paid-tool').credits.balance('user-1')).balance,
      20
    );
    assert.equal(
      (
        await nextStore.listCreditLedger({
          productId: 'product-a',
          userId: 'user-1',
          status: 'expired',
        })
      )[0]?.expiresAt,
      '2000-01-01T00:00:00.000Z'
    );
    assert.equal(
      await nextCommercial.forModule('paid-tool').billing.hasEntitlement('user-1', 'pro'),
      true
    );
    assert.equal(
      (await nextStore.listCommercialOrders({ productId: 'product-a' }))[0]?.status,
      'paid'
    );
  } finally {
    await pool.end();
  }
});
