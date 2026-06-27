import assert from 'node:assert/strict';
import nodeTest from 'node:test';
import { createInMemoryRuntimeStore } from '../src/lib/module-runtime';
import { COMMERCIAL_ORDER_STATUS_EVENT_NAME } from '../src/lib/module-capabilities';
import {
  archiveHostBillingPlan,
  createHostCommercialRuntimeFromStore,
  getHostCommercialRuntime,
  loadHostBillingCatalog,
  syncHostBillingSkuToStripe,
  upsertHostBillingPlan,
  upsertHostBillingSku,
} from '../apps/host-next/lib/commercial-provider';
import {
  createHostBillingPortal,
  getHostBillingOverview,
  getHostBillingTaxProfile,
} from '../apps/host-next/lib/billing-api';
import { getAdminCommercialView } from '../apps/host-next/lib/admin-commercial';
import { listAdminEntitlements } from '../apps/host-next/lib/admin-api';
import {
  createHostPasswordHash,
  createHostSessionCookie,
  ensureHostIdentitySeeded,
} from '../apps/host-next/lib/auth';
import { getHostRuntime } from '../apps/host-next/lib/create-host';
import { createDemoHostSession } from '../apps/host-next/lib/module-host';
import { createHostRequest } from '../apps/host-next/lib/paths';
import { getUserSaasSnapshot } from '../apps/host-next/lib/saas-operations';
import { PATCH as patchAdminEntitlements } from '../apps/host-next/app/api/admin/entitlements/route';

type WebShellTestCallback = (context: unknown) => void | Promise<void>;
type WebShellTestOptions = Record<string, unknown>;
type WebShellTestRunner = {
  (name: string, fn: WebShellTestCallback): void;
  (name: string, options: WebShellTestOptions, fn: WebShellTestCallback): void;
};

const runNodeTest = nodeTest as unknown as WebShellTestRunner;
let webShellTestQueue: Promise<void> = Promise.resolve();

const test: WebShellTestRunner = ((
  name: string,
  optionsOrFn: WebShellTestOptions | WebShellTestCallback,
  maybeFn?: WebShellTestCallback
) => {
  const options = typeof optionsOrFn === 'function' ? undefined : optionsOrFn;
  const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;

  if (!fn) {
    throw new Error(`WEB_SHELL_TEST_CALLBACK_MISSING: ${name}`);
  }

  const queued = async (context: unknown) => {
    const run = webShellTestQueue.then(() => fn(context));
    webShellTestQueue = run.then(
      () => undefined,
      () => undefined
    );
    await run;
  };

  const testOptions = { ...(options ?? {}), concurrency: false };

  if (options) {
    runNodeTest(name, testOptions, queued);
  } else {
    runNodeTest(name, testOptions, queued);
  }
}) as WebShellTestRunner;

function restoreEnvValue(name: string, value: string | undefined): void {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
  } else {
    Reflect.set(process.env, name, value);
  }
}

async function withDemoHostUsers<T>(run: () => T | Promise<T>): Promise<T> {
  const previousDemoUsers = process.env.PLOYKIT_ENABLE_DEMO_USERS;
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.PLOYKIT_ENABLE_DEMO_USERS = 'true';
  if (process.env.NODE_ENV === 'production') {
    restoreEnvValue('NODE_ENV', 'test');
  }
  try {
    return await run();
  } finally {
    restoreEnvValue('PLOYKIT_ENABLE_DEMO_USERS', previousDemoUsers);
    restoreEnvValue('NODE_ENV', previousNodeEnv);
  }
}

async function seedDemoHostIdentity(
  store?: Parameters<typeof ensureHostIdentitySeeded>[0]
): Promise<void> {
  const targetStore = store ?? (await getHostRuntime()).runtimeStore.store;
  await withDemoHostUsers(() => ensureHostIdentitySeeded(targetStore));
}

test('X6 admin entitlement API can override entitlement status with audit', async () => {
  await seedDemoHostIdentity();
  const cookie = createHostSessionCookie('demo-admin').split(';')[0]!;
  const hostRuntime = await getHostRuntime();
  const grant = await hostRuntime.runtimeStore.store.grantEntitlement({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: 'demo-admin',
    entitlement: `override.demo.${Date.now()}`,
    planId: 'demo-pro',
    source: 'test',
    idempotencyKey: `override-demo-${Date.now()}`,
  });

  const response = await patchAdminEntitlements(
    createHostRequest('/api/admin/entitlements', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'override',
        entitlementId: grant.id,
        status: 'expired',
        reason: 'test override',
      }),
    })
  );
  const body = (await response.json()) as {
    ok: boolean;
    data: { grant: { id: string; status: string; metadata: Record<string, unknown> } };
  };
  const audit = await hostRuntime.runtimeStore.store.listAudit({
    productId: 'demo-product',
    type: 'commercial.entitlement.overridden',
  });

  assert.equal(response.status, 200);
  assert.equal(body.data.grant.id, grant.id);
  assert.equal(body.data.grant.status, 'expired');
  assert.equal(body.data.grant.metadata.overrideReason, 'test override');
  assert.ok(audit.some((record) => record.metadata.entitlementId === grant.id));
});

test('A8 admin entitlement views normalize expiry and paginate the ledger', async () => {
  const hostRuntime = await getHostRuntime();
  const suffix = `${Date.now()}`;
  const planId = `demo-plan-${suffix}`;
  const entitlementBase = `pagination.demo.${suffix}`;

  await hostRuntime.runtimeStore.store.grantEntitlement({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: 'demo-admin',
    entitlement: `${entitlementBase}.active`,
    planId,
    source: 'test',
    idempotencyKey: `pagination-active-${suffix}`,
  });
  await hostRuntime.runtimeStore.store.grantEntitlement({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: 'demo-admin',
    entitlement: `${entitlementBase}.expired`,
    planId,
    source: 'test',
    expiresAt: '2000-01-01T00:00:00.000Z',
    idempotencyKey: `pagination-expired-${suffix}`,
  });

  const commercial = await getAdminCommercialView(createDemoHostSession());
  const activeGrant = commercial.entitlements.find(
    (grant) => grant.entitlement === `${entitlementBase}.active`
  );
  const expiredGrant = commercial.entitlements.find(
    (grant) => grant.entitlement === `${entitlementBase}.expired`
  );
  assert.equal(activeGrant?.status, 'active');
  assert.equal(expiredGrant?.status, 'expired');
  assert.equal(commercial.planSubscribers[planId], 1);

  const paged = await listAdminEntitlements({ q: entitlementBase, limit: 1, offset: 1 });
  assert.equal(paged.page.total, 2);
  assert.equal(paged.page.limit, 1);
  assert.equal(paged.page.offset, 1);
  assert.equal(paged.items.length, 1);
  assert.equal(paged.statusCounts.active, 1);
  assert.equal(paged.statusCounts.expired, 1);
  assert.equal(paged.statusCounts.revoked, 0);

  const snapshot = await getUserSaasSnapshot(createDemoHostSession());
  const snapshotGrant = snapshot.entitlements.find(
    (item) => item.entitlement === `${entitlementBase}.expired`
  );
  assert.equal(snapshotGrant?.status, 'expired');
});

test('A8 admin commercial view redacts commercial secret metadata', async () => {
  const hostRuntime = await getHostRuntime();
  const suffix = `${Date.now()}`;
  const codeHash = `redeem_code_hash_${suffix}`;

  await hostRuntime.runtimeStore.store.upsertRedeemCode({
    productId: 'demo-product',
    code: codeHash,
    entitlement: `redaction.demo.${suffix}`,
    creditsUnit: 'credit',
    maxRedemptions: 1,
    metadata: {
      batchId: `redaction-${suffix}`,
      rawCode: 'PLAIN-REDEEM-CODE',
      codeHash,
      bind: { email: 'buyer@example.com' },
      contactHash: 'contact-hash',
      contactMasked: 'b***@example.com',
    },
  });
  await hostRuntime.runtimeStore.store.recordAudit({
    productId: 'demo-product',
    type: 'commercial.redeem_code.attempt',
    metadata: {
      codeHash,
      ok: false,
      reason: 'email_binding_mismatch',
      subject: { type: 'user', id: 'demo-admin' },
      email: 'buyer@example.com',
      contactHash: 'contact-hash',
      contactMasked: 'b***@example.com',
    },
  });
  await hostRuntime.runtimeStore.store.createApiKey({
    id: `api_key_redaction_${suffix}`,
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    moduleId: 'public-tool-smoke',
    name: 'Redaction key',
    prefix: `pk_redact_${suffix}`.slice(0, 24),
    keyHash: 'stored-key-hash',
    ownerSubjectType: 'workspace',
    ownerSubjectId: 'demo-workspace',
    metadata: {
      apiKey: 'pk_live_secret',
      ownerEmail: 'owner@example.com',
      publicLabel: 'keep me',
    },
  });

  const commercial = await getAdminCommercialView(createDemoHostSession());
  const code = commercial.redeemCodes.find(
    (record) => record.codeHashPrefix === codeHash.slice(0, 12)
  );
  const attempt = commercial.redeemAttempts.find(
    (record) => record.codeHashPrefix === codeHash.slice(0, 12)
  );
  const apiKey = commercial.apiKeys.find((record) => record.id === `api_key_redaction_${suffix}`);

  assert.equal(code?.metadata.rawCode, '[REDACTED]');
  assert.equal(code?.metadata.codeHash, '[REDACTED]');
  assert.equal((code?.metadata.bind as Record<string, unknown> | undefined)?.email, '[REDACTED]');
  assert.equal(code?.metadata.contactHash, '[REDACTED]');
  assert.equal(code?.metadata.contactMasked, 'b***@example.com');
  assert.equal(attempt?.metadata.codeHash, '[REDACTED]');
  assert.equal(attempt?.metadata.email, '[REDACTED]');
  assert.equal(attempt?.metadata.contactHash, '[REDACTED]');
  assert.equal(apiKey?.metadata.apiKey, '[REDACTED]');
  assert.equal(apiKey?.metadata.ownerEmail, '[REDACTED]');
  assert.equal(apiKey?.metadata.publicLabel, 'keep me');
  assert.equal(apiKey ? 'keyHash' in apiKey : true, false);
});

test('M6 user SaaS snapshot seeds credits, entitlements, orders and tasks', async () => {
  const snapshot = await getUserSaasSnapshot(createDemoHostSession());

  assert.equal(snapshot.creditBalance.balance, 117);
  assert.ok(
    snapshot.entitlements.some((entitlement) => entitlement.entitlement === 'public-tools.pro')
  );
  assert.ok(snapshot.orders.some((order) => order.status === 'paid'));
  assert.ok(
    snapshot.tasks.some(
      (run) => run.moduleId === 'web-shell' && run.name === 'public tools export'
    )
  );
});

test('M6 host commercial provider applies local paid checkout benefits', async () => {
  const store = createInMemoryRuntimeStore();
  const commercial = createHostCommercialRuntimeFromStore({
    store,
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
  });

  const result = await commercial.provider.applyCheckoutPaid({
    provider: 'local',
    providerRef: 'local-test',
    userId: 'demo-admin',
    sku: 'demo-pro-monthly',
    amount: 1200,
    currency: 'USD',
  });
  const balance = await commercial.forModule('public-tool-smoke').credits.balance('demo-admin');
  const orderEvents = await store.listOutbox({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    name: `event:${COMMERCIAL_ORDER_STATUS_EVENT_NAME}`,
  });
  const orderEventPayload = orderEvents[0]?.payload as { status?: string } | undefined;

  assert.equal(result.order.status, 'paid');
  assert.equal(result.entitlements[0]?.entitlement, 'public-tools.pro');
  assert.equal(balance.balance, 1000);
  assert.equal(orderEvents.length, 1);
  assert.equal(orderEvents[0]?.moduleId, null);
  assert.equal(orderEventPayload?.status, 'paid');

  const brokenPaidOrder = await store.createCommercialOrder({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: 'demo-admin',
    sku: 'demo-pro-monthly',
    amount: 1200,
    currency: 'USD',
    provider: 'local',
    providerRef: 'local-repair',
  });
  await store.updateCommercialOrderStatus(brokenPaidOrder.id, 'paid');
  const repaired = await commercial.provider.reconcilePaidOrderBenefits({
    userId: 'demo-admin',
  });

  assert.equal(repaired.repaired, 1);
  assert.equal(
    (await commercial.forModule('public-tool-smoke').credits.balance('demo-admin')).balance,
    2000
  );
});

test('X6 host billing overview exposes subscriptions, invoices, payment methods and tax profile', async () => {
  await seedDemoHostIdentity();
  const overview = await getHostBillingOverview(createDemoHostSession());

  assert.equal(overview.catalog.skus[0]?.id, 'demo-pro-monthly');
  assert.ok(Array.isArray(overview.subscriptions));
  assert.ok(Array.isArray(overview.invoices));
  assert.ok(Array.isArray(overview.paymentMethods));
  assert.equal(overview.provider.mode === 'local' || overview.provider.mode === 'stripe', true);
});

test('A7 admin billing catalog changes feed runtime entitlements and user billing', async () => {
  const session = createDemoHostSession();
  await seedDemoHostIdentity();
  const suffix = Date.now().toString(36);
  const planId = `ops-pro-${suffix}`;
  const skuId = `ops-pro-monthly-${suffix}`;

  await upsertHostBillingPlan(session, {
    id: planId,
    name: 'Ops Pro',
    entitlements: ['ops.pro'],
    features: ['priority runs', 'workspace billing'],
    limits: { credits: 777, seats: 5 },
  });
  await upsertHostBillingSku(session, {
    id: skuId,
    name: 'Ops Pro Monthly',
    planId,
    amount: 1500,
    currency: 'USD',
    interval: 'month',
    credits: 777,
    entitlements: ['ops.extra'],
    stripePriceId: `price_${suffix}`,
  });

  const runtime = await getHostCommercialRuntime(session);
  const paid = await runtime.provider.applyCheckoutPaid({
    provider: 'local',
    providerRef: `local:${skuId}`,
    userId: 'demo-admin',
    sku: skuId,
    amount: 1500,
    currency: 'USD',
  });
  const billing = runtime.forModule('web-shell').billing;
  const credits = await runtime.forModule('web-shell').credits.balance('demo-admin');
  const overview = await getHostBillingOverview(session);
  const hostRuntime = await getHostRuntime();
  const billingViewUserId = `billing-view-${suffix}`;
  const billingViewInvoiceId = `invoice-${billingViewUserId}`;
  const billingViewSubscriptionId = `subscription-${billingViewUserId}`;
  await hostRuntime.runtimeStore.store.upsertHostUser({
    id: billingViewUserId,
    email: `${billingViewUserId}@example.com`,
    passwordHash: createHostPasswordHash('BillingView@123'),
    role: 'user',
    status: 'active',
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    workspaceRole: 'editor',
    permissions: [],
    metadata: {},
  });
  await hostRuntime.runtimeStore.store.upsertBillingAccount({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: billingViewUserId,
    providerCustomers: { stripe: `cus_${suffix}` },
    paymentMethods: [
      {
        id: `pm_${suffix}`,
        provider: 'stripe',
        type: 'card',
        label: 'Stripe card',
        status: 'active',
        last4: '4242',
      },
    ],
    metadata: { source: 'test' },
  });
  await hostRuntime.runtimeStore.store.upsertInvoice({
    id: billingViewInvoiceId,
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: billingViewUserId,
    orderId: null,
    subscriptionId: null,
    number: `PK-20260524-${suffix.slice(-6)}`,
    status: 'open',
    subtotal: 2500,
    discount: 0,
    tax: 0,
    total: 2500,
    refunded: 0,
    fee: 0,
    net: 2500,
    currency: 'USD',
    provider: 'stripe',
    providerRef: `pi_${suffix}`,
    taxSnapshot: { country: 'DE' },
    lines: [{ sku: 'billing-view', quantity: 1 }],
    metadata: { source: 'test' },
  });
  await hostRuntime.runtimeStore.store.upsertSubscription({
    id: billingViewSubscriptionId,
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: billingViewUserId,
    planId,
    status: 'past_due',
    provider: 'stripe',
    providerRef: `sub_${suffix}`,
    currentPeriodStart: new Date().toISOString(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    cancelAtPeriodEnd: false,
    renewalStrategy: 'provider',
    metadata: { entitlement: `billing.${suffix}` },
  });
  await hostRuntime.runtimeStore.store.upsertTaxProfile({
    productId: 'demo-product',
    workspaceId: 'demo-workspace',
    userId: billingViewUserId,
    status: 'validated',
    jurisdiction: 'DE',
    validationStatus: 'valid',
    profile: {
      company: 'Billing View Ltd',
      country: 'DE',
      taxId: 'DE12345678',
    },
    evidence: { source: 'test' },
    metadata: { source: 'test' },
  });
  await hostRuntime.runtimeStore.store.upsertTaxProfile({
    productId: 'demo-product',
    workspaceId: null,
    userId: billingViewUserId,
    status: 'validated',
    jurisdiction: 'FR',
    validationStatus: 'valid',
    profile: {
      company: 'Wrong Scope Ltd',
      country: 'FR',
      taxId: 'FR00000000',
    },
    evidence: { source: 'test-null-scope' },
    metadata: { source: 'test-null-scope' },
  });
  const resolvedTaxProfile = await getHostBillingTaxProfile({
    user: { id: billingViewUserId, role: 'user' },
    userId: billingViewUserId,
    actorId: billingViewUserId,
    productId: 'demo-product',
    workspaceRole: 'editor',
    permissions: [],
  } as any);
  const commercialView = await getAdminCommercialView(createDemoHostSession());
  const syncResult = await syncHostBillingSkuToStripe(session, skuId);

  assert.equal(paid.order.status, 'paid');
  assert.ok(paid.entitlements.some((grant) => grant.entitlement === 'ops.pro'));
  assert.ok(paid.entitlements.some((grant) => grant.entitlement === 'ops.extra'));
  assert.equal(await billing.hasEntitlement('demo-admin', 'ops.pro'), true);
  assert.ok(credits.balance >= 777);
  assert.ok(overview.catalog.plans.some((plan) => plan.id === planId));
  assert.ok(overview.subscriptions.some((subscription) => subscription.planId === planId));
  assert.equal(resolvedTaxProfile.country, 'DE');
  assert.equal(resolvedTaxProfile.taxId, 'DE12345678');
  assert.ok(
    commercialView.paymentMethods.some(
      (method) =>
        method.userId === billingViewUserId &&
        method.provider === 'stripe' &&
        method.last4 === '4242'
    )
  );
  assert.ok(
    commercialView.invoices.some(
      (invoice) =>
        invoice.id === billingViewInvoiceId && invoice.status === 'open' && invoice.orderId === ''
    )
  );
  assert.ok(
    commercialView.subscriptions.some(
      (subscription) =>
        subscription.id === billingViewSubscriptionId &&
        subscription.status === 'past_due' &&
        subscription.source === 'stripe'
    )
  );
  assert.ok(
    commercialView.taxProfiles.some(
      (profile) =>
        profile.userId === billingViewUserId &&
        profile.company === 'Billing View Ltd' &&
        profile.country === 'DE' &&
        profile.taxIdMasked === '***5678'
    )
  );
  const previousStripeSecret = process.env.STRIPE_SECRET_KEY;
  const previousStripePrice = process.env.STRIPE_PRICE_DEMO_PRO_MONTHLY;
  const previousFetch = globalThis.fetch;
  const portalCalls: { input: string; body: URLSearchParams }[] = [];
  process.env.STRIPE_SECRET_KEY = 'sk_test_portal';
  process.env.STRIPE_PRICE_DEMO_PRO_MONTHLY = `price_${suffix}`;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    portalCalls.push({
      input: String(input),
      body: new URLSearchParams(String(init?.body ?? '')),
    });
    return Response.json({ id: 'bps_test', url: 'https://billing.stripe.test/session' });
  }) as typeof fetch;
  try {
    const portal = await createHostBillingPortal({
      user: { id: billingViewUserId, role: 'user' },
      userId: billingViewUserId,
      actorId: billingViewUserId,
      productId: 'demo-product',
      workspaceId: 'demo-workspace',
      workspaceRole: 'editor',
      permissions: [],
    } as any);
    assert.equal(portal.provider, 'stripe');
    assert.equal(portal.url, 'https://billing.stripe.test/session');
    assert.equal(portalCalls[0]?.input, 'https://api.stripe.com/v1/billing_portal/sessions');
    assert.equal(portalCalls[0]?.body.get('customer'), `cus_${suffix}`);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousStripeSecret === undefined) {
      delete process.env.STRIPE_SECRET_KEY;
    } else {
      process.env.STRIPE_SECRET_KEY = previousStripeSecret;
    }
    if (previousStripePrice === undefined) {
      delete process.env.STRIPE_PRICE_DEMO_PRO_MONTHLY;
    } else {
      process.env.STRIPE_PRICE_DEMO_PRO_MONTHLY = previousStripePrice;
    }
  }
  assert.ok(commercialView.featureMatrix.some((row) => row.capability === 'ops.pro'));
  assert.equal(syncResult.sku.id, skuId);

  await archiveHostBillingPlan(session, planId, 'test cleanup');
  const catalogAfterArchive = await loadHostBillingCatalog(
    (await getHostRuntime()).runtimeStore.store,
    'demo-product'
  );
  assert.equal(catalogAfterArchive.plans.find((plan) => plan.id === planId)?.status, 'archived');
});
