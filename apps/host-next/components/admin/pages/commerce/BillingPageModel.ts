import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { AdminCommercialView } from '@host/lib/admin-commercial';
import { orderBenefitSummary } from './BillingOrderModel';

export {
  joinOrNone,
  metadataOrderId,
  orderBenefitSummary,
  orderContextLinks,
} from './BillingOrderModel';

export const billingCommercialTypeOptions = [
  { value: 'orders', label: 'Orders' },
  { value: 'entitlements', label: 'Entitlements' },
  { value: 'credits', label: 'Credits' },
  { value: 'reservations', label: 'Reservations' },
  { value: 'redeem', label: 'Redeem codes' },
  { value: 'api_keys', label: 'API keys' },
  { value: 'risk', label: 'Risk' },
] as const;

export function cleanBillingTableQuery(query?: AdminTableQuery): Required<AdminTableQuery> {
  return {
    q: query?.q?.trim() ?? '',
    status: query?.status?.trim() ?? '',
    role: query?.role?.trim() ?? '',
    type: query?.type?.trim() ?? '',
    moduleId: query?.moduleId?.trim() ?? '',
    service: query?.service?.trim() ?? '',
    workspace: query?.workspace?.trim() ?? '',
    environment: query?.environment?.trim() ?? '',
    range: query?.range?.trim() ?? '',
    from: query?.from?.trim() ?? '',
    to: query?.to?.trim() ?? '',
    owner: query?.owner?.trim() ?? '',
    mime: query?.mime?.trim() ?? '',
    provider: query?.provider?.trim() ?? '',
    path: query?.path?.trim() ?? '',
    minSize: query?.minSize ?? 0,
    maxSize: query?.maxSize ?? 0,
    page: query?.page ?? 1,
    pageSize: query?.pageSize ?? 20,
    operation: query?.operation?.trim() ?? '',
    outcome: query?.outcome?.trim() ?? '',
    matched: query?.matched ?? 0,
    processed: query?.processed ?? 0,
    failed: query?.failed ?? 0,
    skipped: query?.skipped ?? 0,
    deadLettered: query?.deadLettered ?? 0,
  };
}

function matchesTextSearch(query: string, values: readonly unknown[]): boolean {
  if (query.length === 0) {
    return true;
  }
  const needle = query.toLowerCase();
  return values.some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(needle)
  );
}

function matchesExactFilter(filter: string, value: unknown): boolean {
  return filter.length === 0 || String(value ?? '') === filter;
}

export function buildBillingPageModel(
  lang: SupportedLanguage,
  commercial: AdminCommercialView,
  query?: AdminTableQuery
) {
  const tableQuery = cleanBillingTableQuery(query);
  const showOrders = tableQuery.type.length === 0 || tableQuery.type === 'orders';
  const showEntitlements = tableQuery.type.length === 0 || tableQuery.type === 'entitlements';
  const showCredits = tableQuery.type.length === 0 || tableQuery.type === 'credits';
  const showReservations = tableQuery.type.length === 0 || tableQuery.type === 'reservations';
  const showRedeem = tableQuery.type.length === 0 || tableQuery.type === 'redeem';
  const showApiKeys = tableQuery.type.length === 0 || tableQuery.type === 'api_keys';
  const showRisk = tableQuery.type.length === 0 || tableQuery.type === 'risk';
  const orders = commercial.orders.filter(
    (order) =>
      matchesTextSearch(tableQuery.q, [order.id, order.sku, order.userId, order.status]) &&
      matchesExactFilter(tableQuery.status, order.status)
  );
  const entitlements = commercial.entitlements.filter(
    (grant) =>
      matchesTextSearch(tableQuery.q, [grant.id, grant.entitlement, grant.userId, grant.status]) &&
      matchesExactFilter(tableQuery.status, grant.status)
  );
  const credits = commercial.credits.filter((entry) =>
    matchesTextSearch(tableQuery.q, [entry.id, entry.reason, entry.userId, entry.amount])
  );
  const reservations = commercial.creditReservations.filter(
    (reservation) =>
      matchesTextSearch(tableQuery.q, [
        reservation.id,
        reservation.subject.label,
        reservation.reason,
        reservation.source,
        reservation.status,
      ]) && matchesExactFilter(tableQuery.status, reservation.status)
  );
  const redeemCodes = commercial.redeemCodes.filter(
    (code) =>
      matchesTextSearch(tableQuery.q, [
        code.id,
        code.batchId,
        code.prefix,
        code.maskedCode,
        code.entitlement,
        code.status,
      ]) && matchesExactFilter(tableQuery.status, code.status)
  );
  const redeemRedemptions = commercial.redeemRedemptions.filter((redemption) =>
    matchesTextSearch(tableQuery.q, [
      redemption.id,
      redemption.codeHashPrefix,
      redemption.subject.label,
      redemption.entitlement,
    ])
  );
  const redeemAttempts = commercial.redeemAttempts.filter((attempt) =>
    matchesTextSearch(tableQuery.q, [
      attempt.id,
      attempt.codeHashPrefix,
      attempt.subject?.label,
      attempt.reason,
      attempt.ok ? 'success' : 'failed',
    ])
  );
  const apiKeys = commercial.apiKeys.filter(
    (key) =>
      matchesTextSearch(tableQuery.q, [
        key.id,
        key.name,
        key.prefix,
        key.owner?.label,
        key.moduleId,
        key.status,
      ]) && matchesExactFilter(tableQuery.status, key.status)
  );
  const riskRows = [...commercial.riskEvents, ...commercial.riskBlocks].filter((record) =>
    matchesTextSearch(tableQuery.q, [
      record.id,
      'type' in record ? record.type : 'block',
      record.subject?.label,
      'severity' in record ? record.severity : undefined,
      'reason' in record ? record.reason : undefined,
    ])
  );
  const visibleCount =
    (showOrders ? orders.length : 0) +
    (showEntitlements ? entitlements.length : 0) +
    (showCredits ? credits.length : 0) +
    (showReservations ? reservations.length : 0) +
    (showRedeem ? redeemCodes.length + redeemRedemptions.length + redeemAttempts.length : 0) +
    (showApiKeys ? apiKeys.length : 0) +
    (showRisk ? riskRows.length : 0);
  const totalCount =
    commercial.orders.length +
    commercial.entitlements.length +
    commercial.credits.length +
    commercial.creditReservations.length +
    commercial.redeemCodes.length +
    commercial.redeemRedemptions.length +
    commercial.redeemAttempts.length +
    commercial.apiKeys.length +
    commercial.riskEvents.length +
    commercial.riskBlocks.length;
  const failedOrders = commercial.orders.filter((order) =>
    ['failed', 'voided', 'canceled', 'expired'].includes(order.status)
  );
  const inactiveEntitlements = commercial.entitlements.filter((grant) =>
    ['revoked', 'expired'].includes(grant.status)
  );
  const activeSubscriptions = commercial.subscriptions.filter(
    (subscription) => subscription.status === 'active'
  ).length;
  const pastDueSubscriptions = commercial.subscriptions.filter(
    (subscription) => subscription.status === 'past_due'
  );
  const openInvoices = commercial.invoices.filter((invoice) => invoice.status === 'open');
  const savedPaymentMethods = commercial.paymentMethods.length;
  const taxProfiles = commercial.taxProfiles.length;
  const benefitSummaryByOrder = new Map(
    commercial.orders.map((order) => [order.id, orderBenefitSummary(order, commercial)])
  );
  const missingBenefitOrders = commercial.orders.filter((order) => {
    const summary = benefitSummaryByOrder.get(order.id);
    return (
      order.status === 'paid' &&
      Boolean(summary) &&
      (summary!.missingCredits > 0 || summary!.missingEntitlements.length > 0)
    );
  });
  const focusOrder =
    missingBenefitOrders[0] ??
    failedOrders[0] ??
    commercial.orders.find((order) => order.status === 'paid') ??
    commercial.orders[0] ??
    null;
  const commerceReviewItems = [
    failedOrders.length > 0
      ? {
          key: 'failed-orders',
          title: 'Orders need review',
          description: `${failedOrders.length} orders are failed, expired, canceled, or voided. Review payment provider evidence before changing access.`,
          actionLabel: 'Filter orders',
          href: localizedPath(lang, '/admin/billing?type=orders&status=failed'),
          status: 'failed',
          tone: 'danger' as const,
        }
      : null,
    openInvoices.length > 0
      ? {
          key: 'open-invoices',
          title: 'Open invoices',
          description: `${openInvoices.length} invoices are still open. Reconcile them against the matching order and subscription state.`,
          actionLabel: 'Review invoices',
          href: localizedPath(lang, '/admin/revenue?status=open'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    pastDueSubscriptions.length > 0
      ? {
          key: 'past-due-subscriptions',
          title: 'Past due subscriptions',
          description: `${pastDueSubscriptions.length} subscriptions are past due and may block access renewal.`,
          actionLabel: 'Review subscriptions',
          href: localizedPath(lang, '/admin/billing?type=entitlements'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
    missingBenefitOrders.length > 0
      ? {
          key: 'missing-benefits',
          title: 'Missing paid order benefits',
          description: `${missingBenefitOrders.length} paid orders are missing expected credits or entitlements. Reconcile by idempotency key before shipping access.`,
          actionLabel: 'Reconcile benefits',
          href: localizedPath(lang, '/admin/revenue'),
          status: 'failed',
          tone: 'danger' as const,
        }
      : null,
    inactiveEntitlements.length > 0
      ? {
          key: 'inactive-entitlements',
          title: 'Inactive entitlements',
          description: `${inactiveEntitlements.length} grants are revoked or expired. Check whether users still have matching subscriptions.`,
          actionLabel: 'Review grants',
          href: localizedPath(lang, '/admin/billing?type=entitlements'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  const skusByPlan = commercial.catalog.skus.reduce<
    Record<string, Array<(typeof commercial.catalog.skus)[number]>>
  >((acc, sku) => {
    acc[sku.planId] ??= [];
    acc[sku.planId].push(sku);
    return acc;
  }, {});

  return {
    commercial,
    tableQuery,
    showOrders,
    showEntitlements,
    showCredits,
    showReservations,
    showRedeem,
    showApiKeys,
    showRisk,
    orders,
    entitlements,
    credits,
    reservations,
    redeemCodes,
    redeemRedemptions,
    redeemAttempts,
    apiKeys,
    riskRows,
    visibleCount,
    totalCount,
    failedOrders,
    inactiveEntitlements,
    activeSubscriptions,
    pastDueSubscriptions,
    openInvoices,
    savedPaymentMethods,
    taxProfiles,
    benefitSummaryByOrder,
    missingBenefitOrders,
    focusOrder,
    commerceReviewItems,
    skusByPlan,
  };
}

export type BillingPageModel = ReturnType<typeof buildBillingPageModel>;
