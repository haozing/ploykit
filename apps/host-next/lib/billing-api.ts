import type { ModuleHostSession, RuntimeStoreInvoiceStatus } from '@/lib/module-runtime';
import { getUserSaasSnapshot } from './saas-operations';
import { getHostRuntimeStore } from './runtime-store';
import {
  createStripeBillingPortalSession,
  getHostBillingProviderStatus,
  loadHostBillingCatalog,
} from './commercial-provider';
import { defaultProductId } from './default-scope';
import { DEFAULT_LANGUAGE, localizedPath, type SupportedLanguage } from './i18n';
import { hostBaseUrl } from './paths';

export interface HostBillingInvoice {
  id: string;
  orderId: string;
  number: string;
  status: RuntimeStoreInvoiceStatus;
  amount: number;
  currency: string;
  hostedUrl: string;
  createdAt: string;
}

export interface HostBillingPaymentMethod {
  id: string;
  provider: 'local' | 'stripe';
  type: 'local' | 'card';
  label: string;
  status: 'active' | 'expired';
  last4?: string;
  brand?: string;
  updatedAt?: string;
}

export interface HostBillingSubscription {
  id: string;
  entitlement: string;
  planId: string;
  planName: string;
  status: string;
  source: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
}

export interface HostBillingOverview {
  snapshot: Awaited<ReturnType<typeof getUserSaasSnapshot>>;
  invoices: HostBillingInvoice[];
  paymentMethods: HostBillingPaymentMethod[];
  subscriptions: HostBillingSubscription[];
  taxProfile: Record<string, unknown>;
  provider: ReturnType<typeof getHostBillingProviderStatus>;
  catalog: Awaited<ReturnType<typeof loadHostBillingCatalog>>;
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function currentUser(session: ModuleHostSession) {
  const userId = session.userId ?? session.user?.id;
  if (!userId) {
    throw new Error('HOST_USER_REQUIRED');
  }
  const runtimeStore = await getHostRuntimeStore();
  const user = await runtimeStore.store.getHostUser(userId);
  if (!user) {
    throw new Error('HOST_USER_NOT_FOUND');
  }
  return { runtimeStore, user };
}

function billingWorkspaceId(
  session: ModuleHostSession,
  user: Awaited<ReturnType<typeof currentUser>>['user']
): string | null {
  return session.workspaceId ?? user.workspaceId ?? null;
}

export async function listHostBillingOrders(session: ModuleHostSession) {
  return (await getUserSaasSnapshot(session)).orders;
}

export async function listHostBillingInvoices(session: ModuleHostSession) {
  const runtimeStore = await getHostRuntimeStore();
  const userId = session.userId ?? session.user?.id;
  const invoices = await runtimeStore.store.listInvoices({
    productId: defaultProductId(session.productId),
    workspaceId: session.workspaceId ?? null,
    userId,
  });
  if (invoices.length > 0) {
    return invoices.map((invoice): HostBillingInvoice => ({
      id: invoice.id,
      orderId: invoice.orderId ?? '',
      number: invoice.number,
      status: invoice.status,
      amount: invoice.total,
      currency: invoice.currency,
      hostedUrl: `/api/billing/invoices?id=${invoice.id}`,
      createdAt: invoice.issuedAt ?? invoice.createdAt,
    }));
  }
  const orders = await listHostBillingOrders(session);
  return orders
    .filter((order) => order.status === 'paid' || order.status === 'refunded')
    .map((order): HostBillingInvoice => ({
      id: `invoice-${order.id}`,
      orderId: order.id,
      number: `PK-${order.createdAt.slice(0, 10).replaceAll('-', '')}-${order.id.slice(-6)}`,
      status: order.status === 'refunded' ? 'refunded' : 'paid',
      amount: order.amount,
      currency: order.currency,
      hostedUrl: `/api/billing/invoices?id=invoice-${order.id}`,
      createdAt: order.updatedAt,
    }));
}

export async function listHostBillingPaymentMethods(session: ModuleHostSession) {
  const { runtimeStore, user } = await currentUser(session);
  const account = await runtimeStore.store.getBillingAccount(
    defaultProductId(session.productId),
    user.id,
    session.workspaceId ?? null
  );
  if (account?.paymentMethods.length) {
    return account.paymentMethods as unknown as HostBillingPaymentMethod[];
  }
  const billing = metadataRecord(user.metadata.billing);
  const paymentMethods = billing.paymentMethods;
  if (Array.isArray(paymentMethods)) {
    return paymentMethods as HostBillingPaymentMethod[];
  }
  const orders = await listHostBillingOrders(session);
  if (orders.some((order) => order.provider === 'local' && order.status === 'paid')) {
    const localMethods: HostBillingPaymentMethod[] = [
      {
        id: 'local-ledger',
        provider: 'local',
        type: 'local',
        label: 'Demo payment',
        status: 'active',
        updatedAt: orders[0]?.updatedAt,
      },
    ];
    return localMethods;
  }
  return [];
}

export async function listHostBillingSubscriptions(session: ModuleHostSession) {
  const snapshot = await getUserSaasSnapshot(session);
  const runtimeStore = await getHostRuntimeStore();
  const catalog = await loadHostBillingCatalog(
    runtimeStore.store,
    defaultProductId(session.productId)
  );
  const plans = new Map<string, (typeof catalog.plans)[number]>(
    catalog.plans.map((plan) => [plan.id, plan])
  );
  const userId = session.userId ?? session.user?.id;
  const subscriptions = await runtimeStore.store.listSubscriptions({
    productId: defaultProductId(session.productId),
    workspaceId: session.workspaceId ?? null,
    userId,
  });
  if (subscriptions.length > 0) {
    return subscriptions.map((subscription): HostBillingSubscription => ({
      id: subscription.id,
      entitlement: String(subscription.metadata.entitlement ?? subscription.planId),
      planId: subscription.planId,
      planName: plans.get(subscription.planId)?.name ?? subscription.planId,
      status: subscription.status,
      source: subscription.provider ?? 'runtime-store',
      currentPeriodEnd: subscription.currentPeriodEnd ?? undefined,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    }));
  }
  return snapshot.entitlements.map((grant): HostBillingSubscription => ({
    id: `subscription-${grant.id}`,
    entitlement: grant.entitlement,
    planId: grant.planId ?? 'demo',
    planName: plans.get(grant.planId ?? '')?.name ?? grant.planId ?? 'Demo',
    status: grant.status,
    source: grant.source,
    currentPeriodEnd: grant.expiresAt,
    cancelAtPeriodEnd: grant.status !== 'active',
  }));
}

export async function getHostBillingTaxProfile(session: ModuleHostSession) {
  const { runtimeStore, user } = await currentUser(session);
  const workspaceId = billingWorkspaceId(session, user);
  const taxProfile = await runtimeStore.store.getTaxProfile(
    defaultProductId(session.productId),
    user.id,
    workspaceId
  );
  if (taxProfile) {
    return taxProfile.profile;
  }
  return metadataRecord(metadataRecord(user.metadata.billing).taxProfile);
}

export async function updateHostBillingTaxProfile(
  session: ModuleHostSession,
  taxProfile: Record<string, unknown>
) {
  const { runtimeStore, user } = await currentUser(session);
  const workspaceId = billingWorkspaceId(session, user);
  const billing = metadataRecord(user.metadata.billing);
  const nextProfile = {
    ...metadataRecord(billing.taxProfile),
    ...taxProfile,
  };
  await runtimeStore.store.upsertHostUser({
    ...user,
    metadata: {
      ...user.metadata,
      billing: {
        ...billing,
        taxProfile: nextProfile,
      },
    },
  });
  await runtimeStore.store.upsertTaxProfile({
    productId: session.productId ?? user.productId,
    workspaceId,
    userId: user.id,
    profile: nextProfile,
    jurisdiction: typeof nextProfile.country === 'string' ? nextProfile.country : null,
    validationStatus: 'unverified',
    evidence: {
      source: 'user-dashboard',
      fields: Object.keys(taxProfile),
    },
  });
  await runtimeStore.store.recordAudit({
    productId: session.productId ?? user.productId,
    workspaceId,
    actorId: session.actorId ?? user.id,
    type: 'host.billing.tax_profile.updated',
    metadata: { fields: Object.keys(taxProfile) },
  });
  return nextProfile;
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export async function createHostBillingPortal(
  session: ModuleHostSession,
  lang: SupportedLanguage = DEFAULT_LANGUAGE
) {
  const provider = getHostBillingProviderStatus();
  const { runtimeStore, user } = await currentUser(session);
  const billing = metadataRecord(user.metadata.billing);
  const account = await runtimeStore.store.getBillingAccount(
    defaultProductId(session.productId),
    user.id,
    session.workspaceId ?? null
  );
  const stripeCustomerId = stringMetadata(
    account?.providerCustomers.stripe ?? billing.stripeCustomerId ?? billing.customerId
  );
  if (provider.stripeConfigured && stripeCustomerId) {
    const portal = await createStripeBillingPortalSession({
      customerId: stripeCustomerId,
      returnUrl: `${hostBaseUrl().replace(/\/$/, '')}${localizedPath(lang, '/dashboard/billing')}`,
    });
    await runtimeStore.store.recordAudit({
      productId: session.productId ?? user.productId,
      workspaceId: session.workspaceId ?? user.workspaceId,
      actorId: session.actorId ?? user.id,
      type: 'host.billing.portal.created',
      metadata: {
        provider: 'stripe',
        providerRef: portal.id,
      },
    });
    return {
      provider: 'stripe',
      url: portal.url,
      userId: user.id,
      stripeConfigured: provider.stripeConfigured,
      status: 'created',
      actions: ['orders', 'invoices', 'payment-methods', 'subscriptions', 'tax-profile'],
    };
  }
  return {
    provider: provider.mode,
    url: localizedPath(lang, '/dashboard/billing'),
    userId: user.id,
    stripeConfigured: provider.stripeConfigured,
    status: provider.stripeConfigured ? 'missing-stripe-customer' : 'local-fallback',
    actions: ['orders', 'invoices', 'payment-methods', 'subscriptions', 'tax-profile'],
  };
}

export async function getHostBillingOverview(session: ModuleHostSession): Promise<HostBillingOverview> {
  const runtimeStore = await getHostRuntimeStore();
  const [snapshot, invoices, paymentMethods, subscriptions, taxProfile, catalog] = await Promise.all([
    getUserSaasSnapshot(session),
    listHostBillingInvoices(session),
    listHostBillingPaymentMethods(session),
    listHostBillingSubscriptions(session),
    getHostBillingTaxProfile(session),
    loadHostBillingCatalog(runtimeStore.store, defaultProductId(session.productId)),
  ]);
  return {
    snapshot,
    invoices,
    paymentMethods,
    subscriptions,
    taxProfile,
    provider: getHostBillingProviderStatus(),
    catalog,
  };
}
