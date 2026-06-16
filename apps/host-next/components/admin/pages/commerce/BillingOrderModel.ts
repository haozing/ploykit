import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { RuntimeStoreCommercialOrder } from '@/lib/module-runtime';
import type { AdminCommercialView } from '@host/lib/admin-commercial';

export function joinOrNone(values: readonly string[], fallback = 'none'): string {
  return values.length > 0 ? values.join(', ') : fallback;
}

export function metadataOrderId(record: {
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
}) {
  const orderId = record.metadata?.orderId;
  return typeof orderId === 'string' && orderId.length > 0
    ? orderId
    : record.idempotencyKey?.startsWith('order:')
      ? record.idempotencyKey.split(':')[1]
      : undefined;
}

export function orderBenefitSummary(
  order: RuntimeStoreCommercialOrder,
  commercial: AdminCommercialView
) {
  const sku = commercial.catalog.skus.find((item) => item.id === order.sku);
  const expectedEntitlements = [...new Set(sku?.entitlements ?? [])];
  const expectedCredits = sku?.credits ?? 0;
  const entitlements = commercial.entitlements.filter((grant) => {
    const grantOrderId = metadataOrderId(grant);
    return (
      grant.userId === order.userId &&
      (grantOrderId === order.id ||
        grant.idempotencyKey?.startsWith(`order:${order.id}:entitlement:`) ||
        grant.source === 'order')
    );
  });
  const credits = commercial.credits.filter((entry) => {
    const entryOrderId = metadataOrderId(entry);
    return (
      entry.userId === order.userId &&
      (entryOrderId === order.id ||
        entry.idempotencyKey?.startsWith(`order:${order.id}:credits:`) ||
        entry.reason === 'order.paid')
    );
  });
  const missingEntitlements =
    order.status === 'paid'
      ? expectedEntitlements.filter(
          (entitlement) =>
            !entitlements.some(
              (grant) => grant.entitlement === entitlement && grant.status === 'active'
            )
        )
      : [];
  const creditGranted = credits.reduce((sum, entry) => sum + Math.max(0, entry.amount), 0);
  const missingCredits =
    order.status === 'paid' && expectedCredits > creditGranted
      ? expectedCredits - creditGranted
      : 0;
  return {
    sku,
    expectedEntitlements,
    expectedCredits,
    entitlements,
    credits,
    missingEntitlements,
    missingCredits,
  };
}

export function orderContextLinks(lang: SupportedLanguage, order: RuntimeStoreCommercialOrder) {
  return [
    {
      label: adminInlineText(lang, 'User'),
      href: localizedPath(lang, `/admin/users?q=${encodeURIComponent(order.userId)}`),
    },
    {
      label: adminInlineText(lang, 'Revenue'),
      href: localizedPath(lang, `/admin/revenue?q=${encodeURIComponent(order.id)}`),
    },
    {
      label: adminInlineText(lang, 'Entitlements'),
      href: localizedPath(lang, `/admin/entitlements?q=${encodeURIComponent(order.userId)}`),
    },
    {
      label: adminInlineText(lang, 'Audit'),
      href: localizedPath(lang, `/admin/audit?q=${encodeURIComponent(order.id)}`),
    },
  ];
}
