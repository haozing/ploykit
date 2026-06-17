import { normalizeRuntimeStoreEntitlementGrant } from '@/lib/module-capabilities/commercial/commercial-ledger';
import type { ModuleHostSession } from '@/lib/module-runtime';
import type {
  RuntimeStoreApiKeyRecord,
  RuntimeStoreAuditRecord,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreCreditReservation,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreRedeemCode,
  RuntimeStoreRedeemRedemption,
  RuntimeStoreRiskBlock,
  RuntimeStoreRiskEvent,
} from '@/lib/module-runtime/stores/runtime-store-types';
import { loadHostBillingCatalog, type HostBillingCatalog } from './commercial-provider';
import { getHostRuntime } from './create-host';
import { defaultProductId } from './default-scope';
import { requireCapability } from './rbac';

export interface AdminCommercialSubjectView {
  type: 'user' | 'workspace' | 'organization' | 'apiKey';
  id: string;
  label: string;
}

export type AdminCommercialEntitlementGrant = RuntimeStoreEntitlementGrant & {
  subject: AdminCommercialSubjectView;
};

export type AdminCommercialCreditLedgerEntry = RuntimeStoreCreditLedgerEntry & {
  subject: AdminCommercialSubjectView;
  orderId?: string;
  reservationId?: string;
};

export type AdminCommercialCreditReservation = RuntimeStoreCreditReservation & {
  subject: AdminCommercialSubjectView;
};

export type AdminCommercialApiKey = Omit<RuntimeStoreApiKeyRecord, 'keyHash'> & {
  owner?: AdminCommercialSubjectView;
};

export interface AdminCommercialRedeemCode {
  id: string;
  productId: string;
  codeHashPrefix: string;
  batchId?: string;
  prefix?: string;
  maskedCode?: string;
  entitlement?: string;
  creditsAmount?: number;
  creditsUnit: string;
  maxRedemptions: number;
  status: 'active' | 'frozen' | 'revoked' | 'expired';
  expiresAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AdminCommercialRedeemRedemption {
  id: string;
  productId: string;
  codeHashPrefix: string;
  codeId?: string;
  subject: AdminCommercialSubjectView;
  entitlement?: string;
  creditsAmount?: number;
  creditsUnit?: string;
  idempotencyKey?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminCommercialRedeemAttempt {
  id: string;
  productId: string;
  codeHashPrefix?: string;
  subject?: AdminCommercialSubjectView;
  ok: boolean;
  reason?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type AdminCommercialRiskEvent = RuntimeStoreRiskEvent & {
  subject?: AdminCommercialSubjectView;
};

export type AdminCommercialRiskBlock = RuntimeStoreRiskBlock & {
  subject: AdminCommercialSubjectView;
};

export interface AdminCommercialView {
  orders: RuntimeStoreCommercialOrder[];
  entitlements: AdminCommercialEntitlementGrant[];
  credits: AdminCommercialCreditLedgerEntry[];
  creditReservations: AdminCommercialCreditReservation[];
  redeemCodes: AdminCommercialRedeemCode[];
  redeemRedemptions: AdminCommercialRedeemRedemption[];
  redeemAttempts: AdminCommercialRedeemAttempt[];
  apiKeys: AdminCommercialApiKey[];
  riskEvents: AdminCommercialRiskEvent[];
  riskBlocks: AdminCommercialRiskBlock[];
  catalog: HostBillingCatalog;
  planSubscribers: Record<string, number>;
  planUsage: Record<string, number>;
  featureMatrix: {
    capability: string;
    plans: Record<string, boolean | number | string>;
  }[];
  invoices: {
    id: string;
    orderId: string;
    status: string;
    amount: number;
    currency: string;
    hostedUrl: string;
    createdAt: string;
  }[];
  subscriptions: {
    id: string;
    userId: string;
    planId: string;
    entitlement: string;
    status: string;
    source: string;
    currentPeriodEnd?: string;
  }[];
  paymentMethods: {
    id: string;
    provider: string;
    type: string;
    label: string;
    status: string;
    last4?: string;
    userId?: string;
  }[];
  taxProfiles: {
    userId: string;
    company?: string;
    country?: string;
    taxIdMasked?: string;
  }[];
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function adminSubjectFromStoredUserId(userId: string): AdminCommercialSubjectView {
  const [type, ...idParts] = userId.split(':');
  if (
    (type === 'workspace' || type === 'organization' || type === 'apiKey') &&
    idParts.length > 0
  ) {
    const id = idParts.join(':');
    return { type, id, label: `${type}:${id}` };
  }
  return { type: 'user', id: userId, label: userId };
}

function adminSubjectFromParts(
  type: AdminCommercialSubjectView['type'] | undefined,
  id: string | undefined
): AdminCommercialSubjectView | undefined {
  if (!type || !id) {
    return undefined;
  }
  return { type, id, label: type === 'user' ? id : `${type}:${id}` };
}

function metadataString(
  record: { metadata?: Record<string, unknown> },
  key: string
): string | undefined {
  return stringMetadata(record.metadata?.[key]);
}

function isCommercialAdminMetadataSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[\s_-]/g, '').toLowerCase();
  if (normalized.endsWith('masked') || normalized === 'maskedcode') {
    return false;
  }
  return (
    [
      'rawcode',
      'keyhash',
      'codehash',
      'contacthash',
      'apikey',
      'secret',
      'token',
      'password',
      'authorization',
      'signature',
      'privatekey',
      'clientsecret',
      'accesskey',
      'email',
      'phone',
      'taxid',
      'vatid',
      'ssn',
    ].includes(normalized) ||
    normalized.endsWith('email') ||
    normalized.endsWith('apikey') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('token')
  );
}

function redactCommercialAdminString(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+\b/g, '[REDACTED_AUTH]');
}

function commercialAdminMetadata(value: unknown): Record<string, unknown> {
  const redact = (item: unknown): unknown => {
    if (typeof item === 'string') {
      return redactCommercialAdminString(item);
    }
    if (Array.isArray(item)) {
      return item.map(redact);
    }
    if (!item || typeof item !== 'object') {
      return item;
    }
    return Object.fromEntries(
      Object.entries(item as Record<string, unknown>).map(([key, nested]) => [
        key,
        isCommercialAdminMetadataSensitiveKey(key) ? '[REDACTED]' : redact(nested),
      ])
    );
  };
  return metadataRecord(redact(value));
}

function redeemCodeStatus(record: RuntimeStoreRedeemCode): AdminCommercialRedeemCode['status'] {
  const status = stringMetadata(record.metadata.status);
  if (status === 'frozen' || status === 'revoked') {
    return status;
  }
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
    return 'expired';
  }
  return 'active';
}

function toAdminRedeemCode(record: RuntimeStoreRedeemCode): AdminCommercialRedeemCode {
  return {
    id: `${record.productId}:${record.code.slice(0, 12)}`,
    productId: record.productId,
    codeHashPrefix: record.code.slice(0, 12),
    batchId: metadataString(record, 'batchId'),
    prefix: stringMetadata(record.metadata.prefix),
    maskedCode: stringMetadata(record.metadata.maskedCode),
    entitlement: record.entitlement,
    creditsAmount: record.creditsAmount,
    creditsUnit: record.creditsUnit,
    maxRedemptions: record.maxRedemptions,
    status: redeemCodeStatus(record),
    expiresAt: record.expiresAt,
    metadata: commercialAdminMetadata(record.metadata),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toAdminRedeemRedemption(
  record: RuntimeStoreRedeemRedemption
): AdminCommercialRedeemRedemption {
  return {
    id: record.id,
    productId: record.productId,
    codeHashPrefix: record.code.slice(0, 12),
    codeId: metadataString(record, 'codeId'),
    subject: adminSubjectFromStoredUserId(record.userId),
    entitlement: record.entitlement,
    creditsAmount: record.creditsAmount,
    creditsUnit: record.creditsUnit,
    idempotencyKey: record.idempotencyKey,
    metadata: commercialAdminMetadata(record.metadata),
    createdAt: record.createdAt,
  };
}

function toAdminRedeemAttempt(record: RuntimeStoreAuditRecord): AdminCommercialRedeemAttempt {
  const metadata = metadataRecord(record.metadata);
  const subject = metadataRecord(metadata.subject);
  const subjectType = stringMetadata(subject.type) as
    | AdminCommercialSubjectView['type']
    | undefined;
  const subjectId = stringMetadata(subject.id);
  const codeHash = stringMetadata(metadata.codeHash);
  return {
    id: record.id,
    productId: record.productId,
    codeHashPrefix: codeHash?.slice(0, 12),
    subject: adminSubjectFromParts(subjectType, subjectId),
    ok: metadata.ok === true,
    reason: stringMetadata(metadata.reason),
    metadata: commercialAdminMetadata(metadata),
    createdAt: record.createdAt,
  };
}

export async function getAdminCommercialView(
  session: ModuleHostSession
): Promise<AdminCommercialView> {
  requireCapability(session, 'billing.read');
  const hostRuntime = await getHostRuntime();
  const productId = defaultProductId(session.productId);
  const [
    orders,
    rawEntitlements,
    rawCredits,
    rawCreditReservations,
    rawRedeemCodes,
    rawRedeemRedemptions,
    rawRedeemAttempts,
    rawApiKeys,
    rawRiskEvents,
    rawRiskBlocks,
    catalog,
    users,
    usage,
    invoices,
    subscriptions,
  ] = await Promise.all([
    hostRuntime.runtimeStore.store.listCommercialOrders({ productId }),
    hostRuntime.runtimeStore.store.listEntitlements({ productId }),
    hostRuntime.runtimeStore.store.listCreditLedger({ productId }),
    hostRuntime.runtimeStore.store.listCreditReservations({ productId }),
    hostRuntime.runtimeStore.store.listRedeemCodes({ productId }),
    hostRuntime.runtimeStore.store.listRedeemRedemptions({ productId }),
    hostRuntime.runtimeStore.store.listAudit({
      productId,
      type: 'commercial.redeem_code.attempt',
    }),
    hostRuntime.runtimeStore.store.listApiKeys({ productId }),
    hostRuntime.runtimeStore.store.listRiskEvents({ productId }),
    hostRuntime.runtimeStore.store.listRiskBlocks({ productId }),
    loadHostBillingCatalog(hostRuntime.runtimeStore.store, productId),
    hostRuntime.runtimeStore.store.listHostUsers({ productId }),
    hostRuntime.runtimeStore.store.listUsage({ productId }),
    hostRuntime.runtimeStore.store.listInvoices({ productId }),
    hostRuntime.runtimeStore.store.listSubscriptions({ productId }),
  ]);
  const entitlements = rawEntitlements.map((grant) => {
    const normalized = normalizeRuntimeStoreEntitlementGrant(grant);
    return { ...normalized, subject: adminSubjectFromStoredUserId(normalized.userId) };
  });
  const credits = rawCredits.map((entry) => ({
    ...entry,
    subject: adminSubjectFromStoredUserId(entry.userId),
    orderId: metadataString(entry, 'orderId'),
    reservationId: metadataString(entry, 'reservationId'),
  }));
  const creditReservations = rawCreditReservations.map((reservation) => ({
    ...reservation,
    subject: adminSubjectFromStoredUserId(reservation.userId),
  }));
  const redeemCodes = rawRedeemCodes.map(toAdminRedeemCode);
  const redeemRedemptions = rawRedeemRedemptions.map(toAdminRedeemRedemption);
  const redeemAttempts = rawRedeemAttempts.map(toAdminRedeemAttempt);
  const apiKeys = rawApiKeys.map(({ keyHash: _keyHash, ...record }) => ({
    ...record,
    metadata: commercialAdminMetadata(record.metadata),
    owner: adminSubjectFromParts(record.ownerSubjectType, record.ownerSubjectId),
  }));
  const riskEvents = rawRiskEvents.map((event) => ({
    ...event,
    metadata: commercialAdminMetadata(event.metadata),
    subject: adminSubjectFromParts(event.subjectType, event.subjectId),
  }));
  const riskBlocks = rawRiskBlocks.map((block) => ({
    ...block,
    metadata: commercialAdminMetadata(block.metadata),
    subject: adminSubjectFromParts(block.subjectType, block.subjectId) ?? {
      type: block.subjectType,
      id: block.subjectId,
      label:
        block.subjectType === 'user' ? block.subjectId : `${block.subjectType}:${block.subjectId}`,
    },
  }));
  const planSubscribers = entitlements.reduce<Record<string, number>>((acc, grant) => {
    if (grant.status === 'active' && grant.planId) {
      acc[grant.planId] = (acc[grant.planId] ?? 0) + 1;
    }
    return acc;
  }, {});
  const planUsage = usage.reduce<Record<string, number>>((acc, record) => {
    const planId = String(record.metadata.planId ?? record.metadata.plan ?? 'unknown');
    acc[planId] = (acc[planId] ?? 0) + record.quantity;
    return acc;
  }, {});
  const capabilityNames = new Set<string>();
  for (const plan of catalog.plans) {
    for (const entitlement of plan.entitlements) {
      capabilityNames.add(entitlement);
    }
    for (const feature of plan.features) {
      capabilityNames.add(feature);
    }
    for (const limit of Object.keys(plan.limits)) {
      capabilityNames.add(`limit:${limit}`);
    }
  }
  const featureMatrix = [...capabilityNames].sort().map((capability) => ({
    capability,
    plans: Object.fromEntries(
      catalog.plans.map((plan) => [
        plan.id,
        capability.startsWith('limit:')
          ? (plan.limits[capability.slice('limit:'.length)] ?? '-')
          : plan.entitlements.includes(capability) || plan.features.includes(capability),
      ])
    ),
  }));
  const billingEvidence = await Promise.all(
    users.map(async (user) => ({
      user,
      billingAccount: await hostRuntime.runtimeStore.store.getBillingAccount(
        productId,
        user.id,
        user.workspaceId ?? null
      ),
      taxProfile: await hostRuntime.runtimeStore.store.getTaxProfile(
        productId,
        user.id,
        user.workspaceId ?? null
      ),
    }))
  );
  const settlementInvoices =
    invoices.length > 0
      ? invoices.map((invoice) => ({
          id: invoice.id,
          orderId: invoice.orderId ?? '',
          status: invoice.status,
          amount: invoice.total,
          currency: invoice.currency,
          hostedUrl: `/api/billing/invoices?id=${invoice.id}`,
          createdAt: invoice.issuedAt ?? invoice.createdAt,
        }))
      : orders
          .filter((order) => order.status === 'paid' || order.status === 'refunded')
          .map((order) => ({
            id: `invoice-${order.id}`,
            orderId: order.id,
            status: order.status === 'refunded' ? 'refunded' : 'paid',
            amount: order.amount,
            currency: order.currency,
            hostedUrl: `/api/billing/invoices?id=invoice-${order.id}`,
            createdAt: order.updatedAt,
          }));
  const settlementSubscriptions =
    subscriptions.length > 0
      ? subscriptions.map((subscription) => ({
          id: subscription.id,
          userId: subscription.userId,
          planId: subscription.planId,
          entitlement: String(subscription.metadata.entitlement ?? subscription.planId),
          status: subscription.status,
          source: subscription.provider ?? 'runtime-store',
          currentPeriodEnd: subscription.currentPeriodEnd ?? undefined,
        }))
      : entitlements.map((grant) => ({
          id: `subscription-${grant.id}`,
          userId: grant.userId,
          planId: grant.planId ?? 'none',
          entitlement: grant.entitlement,
          status: grant.status,
          source: grant.source,
          currentPeriodEnd: grant.expiresAt,
        }));
  const paymentMethods = billingEvidence.flatMap(({ user, billingAccount }) => {
    const billing = metadataRecord(user.metadata.billing);
    const accountMethods = Array.isArray(billingAccount?.paymentMethods)
      ? billingAccount.paymentMethods
      : [];
    const methods =
      accountMethods.length > 0
        ? accountMethods
        : Array.isArray(billing.paymentMethods)
          ? billing.paymentMethods
          : [];
    return methods
      .filter((method): method is Record<string, unknown> =>
        Boolean(method && typeof method === 'object')
      )
      .map((method) => ({
        id: String(method.id ?? `method-${user.id}`),
        provider: String(method.provider ?? 'local'),
        type: String(method.type ?? 'local'),
        label: String(method.label ?? 'Payment method'),
        status: String(method.status ?? 'active'),
        last4: typeof method.last4 === 'string' ? method.last4 : undefined,
        userId: user.id,
      }));
  });
  const taxProfiles = billingEvidence
    .map(({ user, taxProfile }) => {
      const billingTax = metadataRecord(user.metadata.billing).taxProfile;
      const source = { ...metadataRecord(billingTax), ...metadataRecord(taxProfile?.profile) };
      const taxId =
        typeof source.taxId === 'string'
          ? source.taxId
          : typeof source.vatId === 'string'
            ? source.vatId
            : typeof source.businessId === 'string'
              ? source.businessId
              : undefined;
      return {
        userId: user.id,
        company: typeof source.company === 'string' ? source.company : undefined,
        country: typeof source.country === 'string' ? source.country : undefined,
        taxIdMasked: taxId ? `***${taxId.slice(-4)}` : undefined,
      };
    })
    .filter((profile) => profile.company || profile.country || profile.taxIdMasked);

  return {
    orders,
    entitlements,
    credits,
    creditReservations,
    redeemCodes,
    redeemRedemptions,
    redeemAttempts,
    apiKeys,
    riskEvents,
    riskBlocks,
    catalog,
    planSubscribers,
    planUsage,
    featureMatrix,
    invoices: settlementInvoices,
    subscriptions: settlementSubscriptions,
    paymentMethods,
    taxProfiles,
  };
}
