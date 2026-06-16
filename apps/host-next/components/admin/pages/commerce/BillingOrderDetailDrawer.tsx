import Link from 'next/link';
import { DetailDrawer } from '@host/components/ui';
import { FactList } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import { orderContextLinks, type BillingPageModel } from './BillingPageModel';

export function BillingOrderDetailDrawer({
  lang,
  model,
}: {
  lang: SupportedLanguage;
  model: BillingPageModel;
}) {
  const { commercial, focusOrder, benefitSummaryByOrder } = model;

  if (!focusOrder) {
    return null;
  }

  const summary = benefitSummaryByOrder.get(focusOrder.id);
  const invoice = commercial.invoices.find((item) => item.orderId === focusOrder.id);
  const subscription = commercial.subscriptions.find(
    (item) => item.userId === focusOrder.userId && item.planId === summary?.sku?.planId
  );

  return (
    <DetailDrawer
      open
      title={adminInlineText(lang, 'Order detail')}
      description={`${focusOrder.id} · ${focusOrder.sku}`}
      className="mb-5"
      actions={orderContextLinks(lang, focusOrder).map((link) => (
        <Link
          key={link.label}
          href={link.href}
          className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
        >
          {link.label}
        </Link>
      ))}
    >
      <FactList
        lang={lang}
        density="compact"
        items={[
          { label: 'Order ID', value: focusOrder.id, copyValue: focusOrder.id, mono: true },
          {
            label: 'Customer',
            value: focusOrder.userId,
            copyValue: focusOrder.userId,
            mono: true,
          },
          { label: 'Status', value: focusOrder.status },
          { label: 'Amount', value: `${focusOrder.amount} ${focusOrder.currency}` },
          { label: 'SKU package', value: summary?.sku?.name ?? focusOrder.sku },
          {
            label: 'Expected benefits',
            value:
              [
                summary?.expectedEntitlements.length
                  ? `${summary.expectedEntitlements.length} entitlements`
                  : null,
                summary?.expectedCredits ? `${summary.expectedCredits} credits` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'none',
          },
          {
            label: 'Missing benefits',
            value:
              [
                summary?.missingEntitlements.length ? summary.missingEntitlements.join(', ') : null,
                summary?.missingCredits ? `${summary.missingCredits} credits` : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'none',
            tone:
              summary && (summary.missingCredits > 0 || summary.missingEntitlements.length > 0)
                ? 'warning'
                : 'success',
          },
          {
            label: 'Invoice',
            value: invoice ? `${invoice.status} · ${invoice.id}` : 'none',
          },
          {
            label: 'Subscription',
            value: subscription ? `${subscription.status} · ${subscription.planId}` : 'none',
          },
        ]}
      />
    </DetailDrawer>
  );
}
