import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type CommercialBenefitReconcileResult,
  type CommercialOrderEventPublisher,
  type CommercialProviderOrderState,
  type CommercialReconcileResult,
  createRuntimeStoreCommercialRuntime,
  type CommercialSkuDefinition,
  type RuntimeStoreCommercialRuntime,
} from '@/lib/module-capabilities/commercial/commercial-ledger';
import type { ModuleHostSession } from '@/lib/module-runtime/host/session';
import type {
  RuntimeStore,
  RuntimeStoreAuditRecord,
  RuntimeStoreSubscriptionEventType,
  RuntimeStoreSubscriptionStatus,
} from '@/lib/module-runtime/stores/runtime-store-types';
import {
  DEFAULT_HOST_ENVIRONMENT_ID,
  DEFAULT_HOST_PRODUCT_ID,
  DEFAULT_HOST_WORKSPACE_ID,
  defaultEnvironmentId,
  defaultProductId,
  defaultWorkspaceId,
} from './default-scope';
import { DEFAULT_LANGUAGE, localizedDashboardPath } from './i18n';
import { getHostRuntimeStore } from './runtime-store';

export interface HostBillingProviderStatus {
  mode: 'local' | 'stripe';
  stripeConfigured: boolean;
  stripeWebhookConfigured: boolean;
  priceConfigured: boolean;
}

export interface HostStripeProviderConfig {
  secretKey?: string;
  priceId?: string;
  successUrl: string;
  cancelUrl: string;
  configured: boolean;
  webhookConfigured: boolean;
}

export interface HostCheckoutResult {
  provider: 'local' | 'stripe';
  orderId: string;
  checkoutUrl: string;
  status: string;
}

export interface HostBillingProviderReconcileInput {
  providerOrders?: CommercialProviderOrderState[];
  userId?: string;
  reason?: string;
}

export interface HostBillingProviderReconcileResult {
  status: 'ok' | 'discrepancies' | 'repaired';
  auditId: string;
  orderReconcile: CommercialReconcileResult;
  benefitReconcile: CommercialBenefitReconcileResult;
  creditReconcile?: {
    userId: string;
    unit: string;
    balance: number;
    ledgerBalance: number;
    ok: boolean;
  };
}

export interface HostBillingCatalogSku {
  id: string;
  name: string;
  amount: number;
  currency: string;
  interval: 'one_time' | 'month';
  credits: number;
  creditUnit: string;
  entitlements: readonly string[];
  planId: string;
  status?: 'active' | 'archived';
  stripePriceId?: string;
}

export const HOST_PLAN_CATALOG = [
  {
    id: 'demo-pro',
    name: 'Starter Pro',
    entitlements: ['public-tools.pro'],
    status: 'active',
    features: ['public-tools.pro', 'monthly credits'],
    limits: { credits: 1000, filesMb: 250 },
  },
] as const;

export const HOST_SKU_CATALOG = {
  'demo-pro-monthly': {
    credits: { amount: 1000, unit: 'credit' },
    entitlements: ['public-tools.pro'],
    planId: 'demo-pro',
    metadata: { product: 'PloyKit starter' },
  },
} as const;

export const HOST_BILLING_SKUS: readonly HostBillingCatalogSku[] = [
  {
    id: 'demo-pro-monthly',
    name: 'Starter Pro Monthly',
    amount: 1200,
    currency: 'USD',
    interval: 'month',
    credits: 1000,
    creditUnit: 'credit',
    entitlements: ['public-tools.pro'],
    planId: 'demo-pro',
    status: 'active',
  },
] as const;

export interface HostBillingPlanCatalogItem {
  id: string;
  name: string;
  entitlements: readonly string[];
  status: 'active' | 'archived';
  features: readonly string[];
  limits: Record<string, number>;
  createdAt?: string;
  updatedAt?: string;
}

export interface HostBillingCatalog {
  plans: HostBillingPlanCatalogItem[];
  skus: HostBillingCatalogSku[];
}

const HOST_BILLING_CATALOG_NAMESPACE = 'billing';
const HOST_BILLING_CATALOG_KEY = 'catalog';

export interface HostBillingPlanInput {
  id: string;
  name: string;
  entitlements?: readonly string[];
  features?: readonly string[];
  limits?: Record<string, number>;
  status?: 'active' | 'archived';
}

export interface HostBillingSkuInput {
  id: string;
  name: string;
  amount: number;
  currency?: string;
  interval?: HostBillingCatalogSku['interval'];
  credits?: number;
  creditUnit?: string;
  entitlements?: readonly string[];
  planId: string;
  status?: 'active' | 'archived';
  stripePriceId?: string;
}

type HostStripeEnv = Partial<
  Record<
    | 'PLOYKIT_HOST_URL'
    | 'STRIPE_SECRET_KEY'
    | 'STRIPE_PRICE_DEMO_PRO_MONTHLY'
    | 'STRIPE_WEBHOOK_SECRET'
    | 'STRIPE_SUCCESS_URL'
    | 'STRIPE_CANCEL_URL',
    string | undefined
  >
>;

type StripeFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

interface StripeWebhookObject extends Record<string, unknown> {
  id?: string;
  amount_total?: number;
  currency?: string;
  subscription?: string;
  status?: string;
  current_period_start?: number;
  current_period_end?: number;
  period_start?: number;
  period_end?: number;
  trial_end?: number;
  cancel_at_period_end?: boolean;
  metadata?: Record<string, string>;
}

interface StripeWebhookEvent {
  id?: string;
  type?: string;
  created?: number;
  data?: {
    object?: StripeWebhookObject;
  };
}

function hostUrl(): string {
  return (process.env.PLOYKIT_HOST_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function readStripeEnv(): HostStripeEnv {
  return {
    PLOYKIT_HOST_URL: process.env.PLOYKIT_HOST_URL,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_PRICE_DEMO_PRO_MONTHLY: process.env.STRIPE_PRICE_DEMO_PRO_MONTHLY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_SUCCESS_URL: process.env.STRIPE_SUCCESS_URL,
    STRIPE_CANCEL_URL: process.env.STRIPE_CANCEL_URL,
  };
}

function normalizeId(value: string, prefix: string): string {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!id) {
    throw new Error(`${prefix}_ID_REQUIRED`);
  }
  return id;
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

function normalizeLimits(limits: Record<string, number> | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(limits ?? {})) {
    const normalized = key.trim();
    const amount = Number(value);
    if (normalized && Number.isFinite(amount) && amount >= 0) {
      result[normalized] = Math.floor(amount);
    }
  }
  return result;
}

function defaultHostBillingCatalog(): HostBillingCatalog {
  return {
    plans: HOST_PLAN_CATALOG.map((plan) => ({
      id: plan.id,
      name: plan.name,
      entitlements: [...plan.entitlements],
      status: plan.status,
      features: [...plan.features],
      limits: { ...plan.limits },
    })),
    skus: HOST_BILLING_SKUS.map((sku) => ({ ...sku, entitlements: [...sku.entitlements] })),
  };
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function numberMetadata(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringListMetadata(value: unknown): string[] {
  return Array.isArray(value)
    ? normalizeList(value.filter((item): item is string => typeof item === 'string'))
    : [];
}

function numericRecordMetadata(value: unknown): Record<string, number> {
  const source = metadataRecord(value);
  const result: Record<string, number> = {};
  for (const [key, amount] of Object.entries(source)) {
    const parsed = Number(amount);
    if (Number.isFinite(parsed)) {
      result[key] = Math.floor(parsed);
    }
  }
  return result;
}

function normalizePlanInput(input: HostBillingPlanInput): HostBillingPlanCatalogItem {
  return {
    id: normalizeId(input.id, 'HOST_BILLING_PLAN'),
    name: input.name.trim() || input.id,
    entitlements: normalizeList(input.entitlements),
    status: input.status ?? 'active',
    features: normalizeList(input.features),
    limits: normalizeLimits(input.limits),
  };
}

function normalizeSkuInput(input: HostBillingSkuInput): HostBillingCatalogSku {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('HOST_BILLING_SKU_AMOUNT_INVALID');
  }
  return {
    id: normalizeId(input.id, 'HOST_BILLING_SKU'),
    name: input.name.trim() || input.id,
    amount: Math.floor(amount),
    currency: (input.currency ?? 'USD').trim().toUpperCase(),
    interval: input.interval ?? 'month',
    credits: Math.max(0, Math.floor(Number(input.credits ?? 0))),
    creditUnit: input.creditUnit?.trim() || 'credit',
    entitlements: normalizeList(input.entitlements),
    planId: normalizeId(input.planId, 'HOST_BILLING_PLAN'),
    status: input.status ?? 'active',
    stripePriceId: input.stripePriceId?.trim() || undefined,
  };
}

function planFromAudit(record: RuntimeStoreAuditRecord): HostBillingPlanCatalogItem | null {
  const plan = metadataRecord(record.metadata.plan);
  const id = stringMetadata(plan.id) ?? stringMetadata(record.metadata.planId);
  if (!id) {
    return null;
  }
  return {
    id,
    name: stringMetadata(plan.name) ?? id,
    entitlements: stringListMetadata(plan.entitlements),
    status: plan.status === 'archived' ? 'archived' : 'active',
    features: stringListMetadata(plan.features),
    limits: numericRecordMetadata(plan.limits),
    createdAt: stringMetadata(plan.createdAt) ?? record.createdAt,
    updatedAt: record.createdAt,
  };
}

function skuFromAudit(record: RuntimeStoreAuditRecord): HostBillingCatalogSku | null {
  const sku = metadataRecord(record.metadata.sku);
  const id = stringMetadata(sku.id) ?? stringMetadata(record.metadata.skuId);
  const planId = stringMetadata(sku.planId);
  if (!id || !planId) {
    return null;
  }
  return {
    id,
    name: stringMetadata(sku.name) ?? id,
    amount: Math.max(0, Math.floor(numberMetadata(sku.amount) ?? 0)),
    currency: (stringMetadata(sku.currency) ?? 'USD').toUpperCase(),
    interval: sku.interval === 'one_time' ? 'one_time' : 'month',
    credits: Math.max(0, Math.floor(numberMetadata(sku.credits) ?? 0)),
    creditUnit: stringMetadata(sku.creditUnit) ?? 'credit',
    entitlements: stringListMetadata(sku.entitlements),
    planId,
    status: sku.status === 'archived' ? 'archived' : 'active',
    stripePriceId: stringMetadata(sku.stripePriceId),
  };
}

export function applyHostBillingCatalogAudit(
  auditLogs: readonly RuntimeStoreAuditRecord[],
  base: HostBillingCatalog = defaultHostBillingCatalog()
): HostBillingCatalog {
  const plans = new Map(base.plans.map((plan) => [plan.id, { ...plan }]));
  const skus = new Map(base.skus.map((sku) => [sku.id, { ...sku }]));
  for (const record of auditLogs
    .filter((item) => item.type.startsWith('host.billing.catalog.'))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))) {
    if (record.type === 'host.billing.catalog.plan_upserted') {
      const plan = planFromAudit(record);
      if (plan) {
        plans.set(plan.id, { ...(plans.get(plan.id) ?? plan), ...plan });
      }
    }
    if (record.type === 'host.billing.catalog.plan_archived') {
      const planId = stringMetadata(record.metadata.planId);
      const current = planId ? plans.get(planId) : null;
      if (planId && current) {
        plans.set(planId, { ...current, status: 'archived', updatedAt: record.createdAt });
      }
    }
    if (record.type === 'host.billing.catalog.sku_upserted') {
      const sku = skuFromAudit(record);
      if (sku) {
        skus.set(sku.id, { ...(skus.get(sku.id) ?? sku), ...sku });
      }
    }
    if (record.type === 'host.billing.catalog.sku_archived') {
      const skuId = stringMetadata(record.metadata.skuId);
      const current = skuId ? skus.get(skuId) : null;
      if (skuId && current) {
        skus.set(skuId, { ...current, status: 'archived' });
      }
    }
  }
  return {
    plans: [...plans.values()].sort((left, right) => left.id.localeCompare(right.id)),
    skus: [...skus.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function catalogFromSetting(value: unknown): HostBillingCatalog | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const catalog = value as Partial<HostBillingCatalog>;
  return Array.isArray(catalog.plans) && Array.isArray(catalog.skus)
    ? {
        plans: catalog.plans,
        skus: catalog.skus,
      }
    : null;
}

export async function loadHostBillingCatalog(
  store: RuntimeStore,
  productId = DEFAULT_HOST_PRODUCT_ID
): Promise<HostBillingCatalog> {
  const setting = await store.getSetting<HostBillingCatalog>({
    productId,
    workspaceId: null,
    namespace: HOST_BILLING_CATALOG_NAMESPACE,
    key: HOST_BILLING_CATALOG_KEY,
  });
  return catalogFromSetting(setting?.value) ?? defaultHostBillingCatalog();
}

async function saveHostBillingCatalog(input: {
  store: RuntimeStore;
  session: ModuleHostSession;
  catalog: HostBillingCatalog;
  fields: readonly string[];
}) {
  return input.store.upsertSetting({
    productId: defaultProductId(input.session.productId),
    workspaceId: null,
    actorId: input.session.actorId ?? input.session.user?.id ?? null,
    namespace: HOST_BILLING_CATALOG_NAMESPACE,
    key: HOST_BILLING_CATALOG_KEY,
    value: input.catalog,
    status: 'active',
    metadata: {
      fields: input.fields,
    },
  });
}

function withBillingPlan(catalog: HostBillingCatalog, plan: HostBillingPlanCatalogItem): HostBillingCatalog {
  const plans = new Map(catalog.plans.map((candidate) => [candidate.id, candidate]));
  plans.set(plan.id, { ...(plans.get(plan.id) ?? plan), ...plan });
  return {
    plans: [...plans.values()].sort((left, right) => left.id.localeCompare(right.id)),
    skus: [...catalog.skus].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function withBillingSku(catalog: HostBillingCatalog, sku: HostBillingCatalogSku): HostBillingCatalog {
  const skus = new Map(catalog.skus.map((candidate) => [candidate.id, candidate]));
  skus.set(sku.id, { ...(skus.get(sku.id) ?? sku), ...sku });
  return {
    plans: [...catalog.plans].sort((left, right) => left.id.localeCompare(right.id)),
    skus: [...skus.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function runtimePlanCatalog(catalog: HostBillingCatalog) {
  return catalog.plans
    .filter((plan) => plan.status === 'active')
    .map((plan) => ({
      id: plan.id,
      name: plan.name,
      entitlements: plan.entitlements,
    }));
}

function runtimeSkuCatalog(catalog: HostBillingCatalog): Record<string, CommercialSkuDefinition> {
  return Object.fromEntries(
    catalog.skus
      .filter((sku) => sku.status !== 'archived')
      .map((sku) => [
        sku.id,
        {
          credits:
            sku.credits > 0
              ? {
                  amount: sku.credits,
                  unit: sku.creditUnit,
                }
              : undefined,
          entitlements: sku.entitlements,
          planId: sku.planId,
          metadata: {
            product: 'PloyKit',
            sku: sku.id,
            stripePriceId: sku.stripePriceId,
          },
        },
      ])
  );
}

function resolveUserScope(session: ModuleHostSession) {
  const userId = session.userId ?? session.user?.id;
  const productId = defaultProductId(session.productId);
  if (!userId) {
    throw new Error('HOST_CHECKOUT_USER_REQUIRED');
  }
  return {
    userId,
    productId,
    workspaceId: session.workspaceId ?? null,
  };
}

export function getHostBillingProviderStatus(): HostBillingProviderStatus {
  const config = resolveHostStripeProviderConfig(readStripeEnv());
  return {
    mode: config.configured ? 'stripe' : 'local',
    stripeConfigured: Boolean(config.secretKey),
    stripeWebhookConfigured: config.webhookConfigured,
    priceConfigured: Boolean(config.priceId),
  };
}

export function listHostBillingCatalog() {
  return defaultHostBillingCatalog();
}

export function resolveHostStripeProviderConfig(env: HostStripeEnv): HostStripeProviderConfig {
  const baseUrl = (env.PLOYKIT_HOST_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const secretKey = env.STRIPE_SECRET_KEY;
  const priceId = env.STRIPE_PRICE_DEMO_PRO_MONTHLY;
  const billingPath = localizedDashboardPath(DEFAULT_LANGUAGE, '/billing');
  return {
    secretKey,
    priceId,
    successUrl: env.STRIPE_SUCCESS_URL ?? `${baseUrl}${billingPath}?checkout=success`,
    cancelUrl: env.STRIPE_CANCEL_URL ?? `${baseUrl}${billingPath}?checkout=cancel`,
    configured: Boolean(secretKey && priceId),
    webhookConfigured: Boolean(env.STRIPE_WEBHOOK_SECRET),
  };
}

export function createHostCommercialRuntimeFromStore(input: {
  store: RuntimeStore;
  productId?: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  catalog?: HostBillingCatalog;
}): RuntimeStoreCommercialRuntime {
  const catalog = input.catalog ?? defaultHostBillingCatalog();
  const productId = defaultProductId(input.productId);
  const environmentId = defaultEnvironmentId(input.environmentId ?? DEFAULT_HOST_ENVIRONMENT_ID);
  const workspaceId = defaultWorkspaceId(input.workspaceId);
  return createRuntimeStoreCommercialRuntime({
    store: input.store,
    productId,
    environmentId,
    workspaceId,
    planCatalog: runtimePlanCatalog(catalog),
    skuCatalog: runtimeSkuCatalog(catalog),
    events: createHostCommercialEventPublisher({
      store: input.store,
      productId,
      workspaceId,
    }),
  });
}

function createHostCommercialEventPublisher(input: {
  store: RuntimeStore;
  productId: string;
  workspaceId?: string | null;
}): CommercialOrderEventPublisher {
  return {
    publish(event) {
      return input.store.enqueueOutbox({
        productId: input.productId,
        workspaceId: input.workspaceId,
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
  };
}

export async function getHostCommercialRuntime(
  session?: ModuleHostSession
): Promise<RuntimeStoreCommercialRuntime> {
  const runtimeStore = await getHostRuntimeStore();
  const catalog = await loadHostBillingCatalog(
    runtimeStore.store,
    defaultProductId(session?.productId)
  );
  return createHostCommercialRuntimeFromStore({
    store: runtimeStore.store,
    productId: session?.productId,
    workspaceId: session?.workspaceId ?? null,
    catalog,
  });
}

function assertBillingAdmin(session: ModuleHostSession): void {
  if (session.system || session.user?.role === 'admin') {
    return;
  }
  throw new Error('HOST_BILLING_ADMIN_REQUIRED');
}

export async function upsertHostBillingPlan(
  session: ModuleHostSession,
  input: HostBillingPlanInput
) {
  assertBillingAdmin(session);
  const runtimeStore = await getHostRuntimeStore();
  const timestamp = new Date().toISOString();
  const plan = {
    ...normalizePlanInput(input),
    updatedAt: timestamp,
  };
  const catalog = await loadHostBillingCatalog(
    runtimeStore.store,
    defaultProductId(session.productId)
  );
  const saved = await saveHostBillingCatalog({
    store: runtimeStore.store,
    session,
    catalog: withBillingPlan(catalog, plan),
    fields: ['plans'],
  });
  await runtimeStore.store.recordAudit({
    productId: defaultProductId(session.productId),
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: 'host.billing.catalog.plan_upserted',
    metadata: {
      settingId: saved.id,
      version: saved.version,
      plan,
    },
  });
  return plan;
}

export async function archiveHostBillingPlan(
  session: ModuleHostSession,
  planId: string,
  reason = 'Admin archived billing plan'
) {
  assertBillingAdmin(session);
  const runtimeStore = await getHostRuntimeStore();
  const normalizedPlanId = normalizeId(planId, 'HOST_BILLING_PLAN');
  const [catalog, activeEntitlements] = await Promise.all([
    loadHostBillingCatalog(runtimeStore.store, defaultProductId(session.productId)),
    runtimeStore.store.listEntitlements({
      productId: defaultProductId(session.productId),
      workspaceId: session.workspaceId ?? undefined,
      status: 'active',
    }),
  ]);
  if (!catalog.plans.some((plan) => plan.id === normalizedPlanId)) {
    throw new Error(`HOST_BILLING_PLAN_NOT_FOUND: ${normalizedPlanId}`);
  }
  const subscribers = activeEntitlements.filter((grant) => grant.planId === normalizedPlanId);
  const nextCatalog = {
    plans: catalog.plans.map((plan) =>
      plan.id === normalizedPlanId
        ? { ...plan, status: 'archived' as const, updatedAt: new Date().toISOString() }
        : plan
    ),
    skus: catalog.skus,
  };
  const saved = await saveHostBillingCatalog({
    store: runtimeStore.store,
    session,
    catalog: nextCatalog,
    fields: ['plans'],
  });
  await runtimeStore.store.recordAudit({
    productId: defaultProductId(session.productId),
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: 'host.billing.catalog.plan_archived',
    metadata: {
      settingId: saved.id,
      version: saved.version,
      planId: normalizedPlanId,
      subscribers: subscribers.length,
      reason,
    },
  });
  return { planId: normalizedPlanId, subscribers: subscribers.length };
}

export async function upsertHostBillingSku(session: ModuleHostSession, input: HostBillingSkuInput) {
  assertBillingAdmin(session);
  const runtimeStore = await getHostRuntimeStore();
  const sku = normalizeSkuInput(input);
  const catalog = await loadHostBillingCatalog(
    runtimeStore.store,
    defaultProductId(session.productId)
  );
  if (!catalog.plans.some((plan) => plan.id === sku.planId && plan.status !== 'archived')) {
    throw new Error(`HOST_BILLING_PLAN_NOT_FOUND: ${sku.planId}`);
  }
  const saved = await saveHostBillingCatalog({
    store: runtimeStore.store,
    session,
    catalog: withBillingSku(catalog, sku),
    fields: ['skus'],
  });
  await runtimeStore.store.recordAudit({
    productId: defaultProductId(session.productId),
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: 'host.billing.catalog.sku_upserted',
    metadata: {
      settingId: saved.id,
      version: saved.version,
      sku,
    },
  });
  return sku;
}

export async function archiveHostBillingSku(
  session: ModuleHostSession,
  skuId: string,
  reason = 'Admin archived billing SKU'
) {
  assertBillingAdmin(session);
  const runtimeStore = await getHostRuntimeStore();
  const normalizedSkuId = normalizeId(skuId, 'HOST_BILLING_SKU');
  const catalog = await loadHostBillingCatalog(
    runtimeStore.store,
    defaultProductId(session.productId)
  );
  const nextCatalog = {
    plans: catalog.plans,
    skus: catalog.skus.map((sku) =>
      sku.id === normalizedSkuId ? { ...sku, status: 'archived' as const } : sku
    ),
  };
  const saved = await saveHostBillingCatalog({
    store: runtimeStore.store,
    session,
    catalog: nextCatalog,
    fields: ['skus'],
  });
  await runtimeStore.store.recordAudit({
    productId: defaultProductId(session.productId),
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: 'host.billing.catalog.sku_archived',
    metadata: {
      settingId: saved.id,
      version: saved.version,
      skuId: normalizedSkuId,
      reason,
    },
  });
  return { skuId: normalizedSkuId };
}

export async function syncHostBillingSkuToStripe(
  session: ModuleHostSession,
  skuId: string,
  reason = 'Admin Stripe SKU sync'
) {
  assertBillingAdmin(session);
  const runtimeStore = await getHostRuntimeStore();
  const provider = getHostBillingProviderStatus();
  const catalog = await loadHostBillingCatalog(
    runtimeStore.store,
    defaultProductId(session.productId)
  );
  const sku = catalog.skus.find(
    (candidate) => candidate.id === normalizeId(skuId, 'HOST_BILLING_SKU')
  );
  if (!sku) {
    throw new Error(`HOST_BILLING_SKU_NOT_FOUND: ${skuId}`);
  }
  await runtimeStore.store.recordAudit({
    productId: defaultProductId(session.productId),
    workspaceId: session.workspaceId ?? null,
    actorId: session.actorId ?? session.user?.id,
    type: 'host.billing.catalog.sku_stripe_synced',
    metadata: {
      skuId: sku.id,
      stripeConfigured: provider.stripeConfigured,
      priceConfigured: provider.priceConfigured,
      stripePriceId: sku.stripePriceId,
      result: provider.stripeConfigured ? 'ready-for-provider-sync' : 'local-fallback',
      reason,
    },
  });
  return { sku, provider };
}

export async function createStripeCheckoutSession(
  input: {
    orderId: string;
    userId: string;
    sku: string;
    planId?: string;
    mode?: 'payment' | 'subscription';
  },
  options: {
    env?: HostStripeEnv;
    fetch?: StripeFetch;
  } = {}
): Promise<{ id: string; url: string }> {
  const config = resolveHostStripeProviderConfig(options.env ?? readStripeEnv());
  if (!config.secretKey || !config.priceId) {
    throw new Error('STRIPE_CHECKOUT_NOT_CONFIGURED');
  }

  const mode = input.mode ?? 'payment';
  const body = new URLSearchParams({
    mode,
    success_url: config.successUrl,
    cancel_url: config.cancelUrl,
    'line_items[0][price]': config.priceId,
    'line_items[0][quantity]': '1',
  });
  const metadata: Record<string, string> = {
    orderId: input.orderId,
    userId: input.userId,
    sku: input.sku,
  };
  if (input.planId) {
    metadata.planId = input.planId;
  }
  for (const [key, value] of Object.entries(metadata)) {
    body.set(`metadata[${key}]`, value);
    if (mode === 'subscription') {
      body.set(`subscription_data[metadata][${key}]`, value);
    }
  }

  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = (await response.json()) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!response.ok || !payload.id || !payload.url) {
    throw new Error(payload.error?.message ?? 'STRIPE_CHECKOUT_CREATE_FAILED');
  }

  return { id: payload.id, url: payload.url };
}

export async function createStripeBillingPortalSession(
  input: {
    customerId: string;
    returnUrl: string;
  },
  options: {
    env?: HostStripeEnv;
    fetch?: StripeFetch;
  } = {}
): Promise<{ id: string; url: string }> {
  const config = resolveHostStripeProviderConfig(options.env ?? readStripeEnv());
  if (!config.secretKey) {
    throw new Error('STRIPE_PORTAL_NOT_CONFIGURED');
  }

  const body = new URLSearchParams({
    customer: input.customerId,
    return_url: input.returnUrl,
  });
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = (await response.json()) as {
    id?: string;
    url?: string;
    error?: { message?: string };
  };
  if (!response.ok || !payload.id || !payload.url) {
    throw new Error(payload.error?.message ?? 'STRIPE_PORTAL_CREATE_FAILED');
  }

  return { id: payload.id, url: payload.url };
}

export async function createHostCheckout(
  session: ModuleHostSession,
  sku = 'demo-pro-monthly'
): Promise<HostCheckoutResult> {
  const scope = resolveUserScope(session);
  const runtimeStore = await getHostRuntimeStore();
  const catalog = await loadHostBillingCatalog(runtimeStore.store, scope.productId);
  const commercial = createHostCommercialRuntimeFromStore({
    store: runtimeStore.store,
    productId: scope.productId,
    workspaceId: scope.workspaceId,
    catalog,
  });
  const provider = getHostBillingProviderStatus();
  const skuEntry = catalog.skus.find(
    (candidate) => candidate.id === sku && candidate.status !== 'archived'
  );
  if (!skuEntry) {
    throw new Error(`HOST_BILLING_SKU_NOT_FOUND: ${sku}`);
  }
  const amount = skuEntry.amount;
  const currency = skuEntry.currency;
  const checkout = await commercial.forModule('__host__').commerce.createCheckout({
    userId: scope.userId,
    sku,
    amount,
    currency,
    idempotencyKey: `checkout:${scope.userId}:${sku}:${Date.now()}`,
  });

  if (provider.mode === 'stripe') {
    const stripeSession = await createStripeCheckoutSession({
      orderId: checkout.id,
      userId: scope.userId,
      sku,
      planId: skuEntry.planId,
      mode: skuEntry.interval === 'one_time' ? 'payment' : 'subscription',
    });
    await runtimeStore.store.attachCommercialOrderProvider(
      checkout.id,
      'stripe',
      stripeSession.id,
      { checkoutUrl: stripeSession.url }
    );
    return {
      provider: 'stripe',
      orderId: checkout.id,
      checkoutUrl: stripeSession.url,
      status: checkout.status,
    };
  }

  const paid = await commercial.provider.applyCheckoutPaid({
    provider: 'local',
    providerRef: `local:${checkout.id}`,
    orderId: checkout.id,
    userId: scope.userId,
    sku,
    amount,
    currency,
    metadata: { checkout: 'local' },
  });
  return {
    provider: 'local',
    orderId: paid.order.id,
    checkoutUrl: `${hostUrl()}${localizedDashboardPath(
      DEFAULT_LANGUAGE,
      '/billing'
    )}?checkout=local-paid`,
    status: paid.order.status,
  };
}

export async function reconcileHostBillingPaidOrderBenefits(session?: ModuleHostSession) {
  const commercial = await getHostCommercialRuntime(session);
  const userId =
    session?.system || session?.user?.role === 'admin'
      ? undefined
      : (session?.userId ?? session?.user?.id);
  return commercial.provider.reconcilePaidOrderBenefits({
    userId,
  });
}

export async function reconcileHostBillingProvider(
  session?: ModuleHostSession,
  input: HostBillingProviderReconcileInput = {}
): Promise<HostBillingProviderReconcileResult> {
  const runtimeSession: ModuleHostSession =
    session ??
    ({
      user: null,
      system: true,
      productId: DEFAULT_HOST_PRODUCT_ID,
      workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    } as ModuleHostSession);
  const commercial = await getHostCommercialRuntime(runtimeSession);
  const providerOrders = input.providerOrders ?? [];
  const orderReconcile = await commercial.provider.reconcileOrders(providerOrders);
  const benefitReconcile = await commercial.provider.reconcilePaidOrderBenefits({
    userId:
      runtimeSession.system || runtimeSession.user?.role === 'admin'
        ? undefined
        : (runtimeSession.userId ?? runtimeSession.user?.id),
  });
  const creditReconcile = input.userId
    ? await commercial.admin.reconcileCredits(input.userId)
    : undefined;
  const status: 'ok' | 'discrepancies' | 'repaired' =
    creditReconcile && !creditReconcile.ok
      ? 'discrepancies'
      : orderReconcile.discrepancies.length > 0
        ? 'discrepancies'
        : benefitReconcile.repaired > 0
          ? 'repaired'
          : 'ok';
  const runtimeStore = await getHostRuntimeStore();
  const audit = await runtimeStore.store.recordAudit({
    productId: defaultProductId(runtimeSession.productId),
    workspaceId: runtimeSession.workspaceId ?? null,
    actorId: runtimeSession.actorId ?? runtimeSession.userId ?? runtimeSession.user?.id,
    type: 'host.billing.provider_reconciled',
    metadata: {
      reason: input.reason ?? 'Billing provider reconcile smoke',
      status,
      checked: orderReconcile.checked,
      orderDiscrepancies: orderReconcile.discrepancies,
      benefitReconcile,
      creditReconcile,
    },
  });
  return {
    status,
    auditId: audit.id,
    orderReconcile,
    benefitReconcile,
    creditReconcile,
  };
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyStripeWebhookSignature(input: {
  body: string;
  signatureHeader: string | null;
  secret: string;
  now?: () => Date;
  toleranceSeconds?: number;
}): boolean {
  const header = input.signatureHeader ?? '';
  const timestamp = header
    .split(',')
    .map((part) => part.trim())
    .find((part) => part.startsWith('t='))
    ?.slice(2);
  const signatures = header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice(3));

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) {
    return false;
  }
  const ageSeconds = Math.abs((input.now ?? (() => new Date()))().getTime() - timestampMs) / 1000;
  if (ageSeconds > (input.toleranceSeconds ?? 300)) {
    return false;
  }

  const expected = createHmac('sha256', input.secret)
    .update(`${timestamp}.${input.body}`)
    .digest('hex');
  return signatures.some((signature) => secureEqual(signature, expected));
}

export async function applyStripeCheckoutCompletedEvent(event: StripeWebhookEvent) {
  if (event.type !== 'checkout.session.completed') {
    return { ignored: true };
  }

  const session = event.data?.object;
  const metadata = session?.metadata ?? {};
  if (!session?.id || !metadata.userId || !metadata.sku) {
    throw new Error('STRIPE_CHECKOUT_METADATA_REQUIRED');
  }

  const runtimeStore = await getHostRuntimeStore();
  const catalog = await loadHostBillingCatalog(runtimeStore.store, DEFAULT_HOST_PRODUCT_ID);
  const sku = catalog.skus.find((candidate) => candidate.id === metadata.sku);
  const commercial = createHostCommercialRuntimeFromStore({
    store: runtimeStore.store,
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    catalog,
  });
  const result = await commercial.provider.applyCheckoutPaid({
    provider: 'stripe',
    providerRef: session.id,
    orderId: metadata.orderId,
    userId: metadata.userId,
    sku: metadata.sku,
    amount: session.amount_total ?? sku?.amount ?? 0,
    currency: (session.currency ?? sku?.currency ?? 'USD').toUpperCase(),
    idempotencyKey: event.id,
    metadata,
  });
  const checkoutPlanId = metadata.planId || sku?.planId;
  if (session.subscription && checkoutPlanId) {
    await commercial.provider.recordSubscriptionEvent({
      userId: metadata.userId,
      planId: checkoutPlanId,
      type: 'created',
      status: 'active',
      provider: 'stripe',
      providerRef: session.subscription,
      idempotencyKey: event.id ? `${event.id}:subscription` : undefined,
      metadata: {
        ...metadata,
        checkoutSessionId: session.id,
        stripeSubscriptionId: session.subscription,
      },
    });
  }
  await runtimeStore.store.recordAudit({
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    actorId: metadata.userId,
    type: 'commercial.provider.event.received',
    metadata: {
      provider: 'stripe',
      eventId: event.id,
      eventType: event.type,
      providerRef: session.id,
      orderId: metadata.orderId,
      sku: metadata.sku,
    },
  });

  return {
    ignored: false,
    order: result.order,
    credits: result.credits.length,
    entitlements: result.entitlements.length,
  };
}

function stripeTimestamp(value: unknown): string | null {
  const seconds =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Number(value))
        ? Number(value)
        : null;
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}

function stripeSubscriptionStatus(value: unknown): RuntimeStoreSubscriptionStatus {
  if (value === 'trialing') {
    return 'trialing';
  }
  if (value === 'active') {
    return 'active';
  }
  if (value === 'past_due' || value === 'unpaid' || value === 'incomplete') {
    return 'past_due';
  }
  if (value === 'paused') {
    return 'paused';
  }
  if (value === 'canceled' || value === 'incomplete_expired') {
    return 'canceled';
  }
  return 'active';
}

function stripeSubscriptionEventType(
  eventType: string,
  status: RuntimeStoreSubscriptionStatus
): RuntimeStoreSubscriptionEventType {
  if (eventType === 'customer.subscription.deleted') {
    return 'canceled';
  }
  if (eventType === 'invoice.paid') {
    return 'renewed';
  }
  if (eventType === 'invoice.payment_failed') {
    return 'past_due';
  }
  if (status === 'trialing') {
    return 'trial_started';
  }
  if (status === 'past_due') {
    return 'past_due';
  }
  if (status === 'paused') {
    return 'paused';
  }
  if (status === 'canceled') {
    return 'canceled';
  }
  if (eventType === 'customer.subscription.created') {
    return 'created';
  }
  return 'resumed';
}

export async function applyStripeSubscriptionEvent(event: StripeWebhookEvent) {
  const supportedTypes = new Set([
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.paid',
    'invoice.payment_failed',
  ]);
  if (!event.type || !supportedTypes.has(event.type)) {
    return { ignored: true };
  }

  const runtimeStore = await getHostRuntimeStore();
  const catalog = await loadHostBillingCatalog(runtimeStore.store, DEFAULT_HOST_PRODUCT_ID);
  const commercial = createHostCommercialRuntimeFromStore({
    store: runtimeStore.store,
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    catalog,
  });
  const object = event.data?.object ?? {};
  const metadata = metadataRecord(object.metadata);
  const userId = stringMetadata(metadata.userId);
  const skuId = stringMetadata(metadata.sku);
  const planId =
    stringMetadata(metadata.planId) ??
    (skuId ? catalog.skus.find((sku) => sku.id === skuId)?.planId : undefined);
  const subscriptionId =
    stringMetadata(object.subscription) ??
    stringMetadata(metadata.subscriptionId) ??
    stringMetadata(object.id);
  if (!userId || !planId || !subscriptionId) {
    throw new Error('STRIPE_SUBSCRIPTION_METADATA_REQUIRED');
  }

  const status =
    event.type === 'invoice.payment_failed'
      ? 'past_due'
      : event.type === 'invoice.paid'
        ? 'active'
        : event.type === 'customer.subscription.deleted'
          ? 'canceled'
        : stripeSubscriptionStatus(object.status);
  const result = await commercial.provider.recordSubscriptionEvent({
    userId,
    planId,
    type: stripeSubscriptionEventType(event.type, status),
    status,
    provider: 'stripe',
    providerRef: subscriptionId,
    idempotencyKey: event.id,
    currentPeriodStart:
      stripeTimestamp(object.current_period_start) ?? stripeTimestamp(object.period_start),
    currentPeriodEnd: stripeTimestamp(object.current_period_end) ?? stripeTimestamp(object.period_end),
    trialEnd: stripeTimestamp(object.trial_end),
    cancelAtPeriodEnd:
      typeof object.cancel_at_period_end === 'boolean' ? object.cancel_at_period_end : undefined,
    effectiveAt:
      stripeTimestamp(event.created ?? null) ??
      stripeTimestamp(object.current_period_start) ??
      new Date().toISOString(),
    metadata: {
      ...metadata,
      stripeEventId: event.id,
      stripeEventType: event.type,
      stripeSubscriptionId: subscriptionId,
      stripeStatus: typeof object.status === 'string' ? object.status : status,
    },
  });

  await runtimeStore.store.recordAudit({
    productId: DEFAULT_HOST_PRODUCT_ID,
    workspaceId: DEFAULT_HOST_WORKSPACE_ID,
    actorId: userId,
    type: 'commercial.provider.event.received',
    metadata: {
      provider: 'stripe',
      eventId: event.id,
      eventType: event.type,
      providerRef: subscriptionId,
      subscriptionId: result.subscriptionId,
      status: result.status,
    },
  });

  return {
    ignored: false,
    event: result,
  };
}

export async function applyStripeWebhookEvent(event: StripeWebhookEvent) {
  const result = await applyStripeCheckoutCompletedEvent(event);
  if (!result.ignored) {
    return result;
  }
  return applyStripeSubscriptionEvent(event);
}
