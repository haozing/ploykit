import { AdminBillingOperationsPage } from '@host/components/admin/AdminPages';
import { getAdminCommercialView } from '@host/lib/admin-commercial';
import { invalidateHostRuntime } from '@host/lib/create-host';
import {
  archiveHostBillingPlan,
  archiveHostBillingSku,
  syncHostBillingSkuToStripe,
  upsertHostBillingPlan,
  upsertHostBillingSku,
} from '@host/lib/commercial-provider';
import { createAdminAction } from '@host/lib/admin-action';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';

function readFormString(formData: FormData, name: string, fallback = ''): string {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function readOptionalFormString(formData: FormData, name: string): string | undefined {
  const value = readFormString(formData, name);
  return value || undefined;
}

function readFormNumber(formData: FormData, name: string, fallback = 0): number {
  const parsed = Number(readFormString(formData, name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function csvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLimits(value: string | undefined): Record<string, number> {
  const limits: Record<string, number> = {};
  for (const part of (value ?? '').split(',')) {
    const [key, rawAmount] = part.split(':').map((item) => item.trim());
    const amount = Number(rawAmount);
    if (key && Number.isFinite(amount)) {
      limits[key] = amount;
    }
  }
  return limits;
}

function revalidateBillingPages() {
  invalidateHostRuntime();
}

const billingRevalidatePaths = ['/admin/billing', '/admin/revenue', '/admin/entitlements'] as const;

const upsertPlanAction = createAdminAction({
  id: 'billing.upsertPlan',
  parse: (formData) => ({
    id: readFormString(formData, 'planId'),
    name: readFormString(formData, 'name'),
    entitlements: csvList(readOptionalFormString(formData, 'entitlements')),
    features: csvList(readOptionalFormString(formData, 'features')),
    limits: parseLimits(readOptionalFormString(formData, 'limits')),
  }),
  run: async ({ session, input }) => {
    await upsertHostBillingPlan(session, input);
    revalidateBillingPages();
  },
  revalidate: () => billingRevalidatePaths,
  audit: { metadata: ({ input }) => ({ planId: input.id }) },
});

const archivePlanAction = createAdminAction({
  id: 'billing.archivePlan',
  parse: (formData) => ({
    planId: readFormString(formData, 'planId'),
    reason: readOptionalFormString(formData, 'reason'),
  }),
  run: async ({ session, input }) => {
    await archiveHostBillingPlan(session, input.planId, input.reason);
    revalidateBillingPages();
  },
  revalidate: () => billingRevalidatePaths,
  audit: { metadata: ({ input }) => ({ planId: input.planId, reason: input.reason }) },
});

const upsertSkuAction = createAdminAction({
  id: 'billing.upsertSku',
  parse: (formData) => {
    const rawInterval = readFormString(formData, 'interval', 'month');
    const interval: 'one_time' | 'month' = rawInterval === 'one_time' ? 'one_time' : 'month';
    return {
      id: readFormString(formData, 'skuId'),
      name: readFormString(formData, 'name'),
      amount: readFormNumber(formData, 'amount'),
      currency: readFormString(formData, 'currency', 'USD'),
      interval,
      credits: readFormNumber(formData, 'credits'),
      creditUnit: readFormString(formData, 'creditUnit', 'credit'),
      entitlements: csvList(readOptionalFormString(formData, 'entitlements')),
      planId: readFormString(formData, 'planId'),
      stripePriceId: readOptionalFormString(formData, 'stripePriceId'),
    };
  },
  run: async ({ session, input }) => {
    await upsertHostBillingSku(session, input);
    revalidateBillingPages();
  },
  revalidate: () => billingRevalidatePaths,
  audit: { metadata: ({ input }) => ({ skuId: input.id, planId: input.planId }) },
});

const archiveSkuAction = createAdminAction({
  id: 'billing.archiveSku',
  parse: (formData) => ({
    skuId: readFormString(formData, 'skuId'),
    reason: readOptionalFormString(formData, 'reason'),
  }),
  run: async ({ session, input }) => {
    await archiveHostBillingSku(session, input.skuId, input.reason);
    revalidateBillingPages();
  },
  revalidate: () => billingRevalidatePaths,
  audit: { metadata: ({ input }) => ({ skuId: input.skuId, reason: input.reason }) },
});

const syncSkuAction = createAdminAction({
  id: 'billing.syncSku',
  parse: (formData) => ({
    skuId: readFormString(formData, 'skuId'),
    reason: readOptionalFormString(formData, 'reason'),
  }),
  run: async ({ session, input }) => {
    await syncHostBillingSkuToStripe(session, input.skuId, input.reason);
    revalidateBillingPages();
  },
  revalidate: () => billingRevalidatePaths,
  audit: { metadata: ({ input }) => ({ skuId: input.skuId, reason: input.reason }) },
});

export default async function AdminBillingPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang] = await readLanguageAndRequireAdmin(params, '/admin/billing');
  const query = await readAdminTableQuery(searchParams);
  const commercial = await getAdminCommercialView();
  return (
    <AdminBillingOperationsPage
      lang={lang}
      commercial={commercial}
      upsertPlanAction={upsertPlanAction}
      archivePlanAction={archivePlanAction}
      upsertSkuAction={upsertSkuAction}
      archiveSkuAction={archiveSkuAction}
      syncSkuAction={syncSkuAction}
      query={query}
    />
  );
}
