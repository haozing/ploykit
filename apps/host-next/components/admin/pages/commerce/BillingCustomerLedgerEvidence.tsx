import Link from 'next/link';
import { BadgeDollarSign, CreditCard, ReceiptText } from 'lucide-react';
import { DataTable } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import { EntityListItem, EvidenceSection } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import {
  metadataOrderId,
  orderContextLinks,
  type BillingPageModel,
} from './BillingPageModel';

export function BillingCustomerLedgerEvidence({
  lang,
  model,
}: {
  lang: SupportedLanguage;
  model: BillingPageModel;
}) {
  const {
    showOrders,
    showEntitlements,
    showCredits,
    orders,
    entitlements,
    credits,
    benefitSummaryByOrder,
  } = model;

  return (
    <>
      {showOrders ? (
        <EvidenceSection
          title={`Order records · ${orders.length}`}
          description={adminInlineText(lang, 'Filtered order rows with user and payment state.')}
        >
          <DataTable
            className="hidden xl:block shadow-none"
            columns={adminInlineColumns(lang, [
              'Order',
              'User',
              'Amount',
              'Status',
              'Benefits',
              'Links',
            ])}
            rows={orders.map((order) => {
              const summary = benefitSummaryByOrder.get(order.id);
              return [
                <span key={`${order.id}:order`} className="block min-w-0">
                  <span className="block truncate font-semibold text-admin-text">{order.sku}</span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                    {order.id}
                  </span>
                </span>,
                <Link
                  key={`${order.id}:user`}
                  href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(order.userId)}`)}
                  className="font-medium text-admin-primary hover:underline"
                >
                  {order.userId}
                </Link>,
                `${order.amount} ${order.currency}`,
                <StatusBadge key={`${order.id}:status`} lang={lang} value={order.status} />,
                <span
                  key={`${order.id}:benefits`}
                  className="block text-xs leading-5 text-admin-text-muted"
                >
                  {summary?.missingEntitlements.length || summary?.missingCredits
                    ? [
                        summary?.missingEntitlements.length
                          ? summary.missingEntitlements.join(', ')
                          : null,
                        summary?.missingCredits ? `${summary.missingCredits} credits` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    : 'benefits satisfied'}
                </span>,
                <div key={`${order.id}:links`} className="flex flex-wrap items-center gap-2">
                  {orderContextLinks(lang, order).map((link) => (
                    <Link
                      key={link.label}
                      href={link.href}
                      className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-bg px-2.5 py-1 text-[11px] font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                    >
                      {link.label}
                    </Link>
                  ))}
                </div>,
              ];
            })}
            density="compact"
          />
          <div className="grid gap-1 xl:hidden">
            {orders.map((order) => {
              const summary = benefitSummaryByOrder.get(order.id);
              return (
                <EntityListItem
                  key={order.id}
                  href={localizedPath(lang, `/admin/revenue?q=${encodeURIComponent(order.id)}`)}
                  title={order.sku}
                  subtitle={order.userId}
                  status={order.status}
                  detail={[
                    `${order.amount} ${order.currency}`,
                    summary?.missingEntitlements.length || summary?.missingCredits
                      ? [
                          summary?.missingEntitlements.length
                            ? summary.missingEntitlements.join(', ')
                            : null,
                          summary?.missingCredits ? `${summary.missingCredits} credits` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : 'benefits satisfied',
                  ].join(' · ')}
                  meta={order.id}
                  icon={ReceiptText}
                  density="compact"
                  tone={
                    order.status === 'failed' || order.status === 'refunded' ? 'danger' : 'primary'
                  }
                />
              );
            })}
          </div>
        </EvidenceSection>
      ) : null}
      {showEntitlements ? (
        <EvidenceSection
          title={`Entitlement records · ${entitlements.length}`}
          description={adminInlineText(lang, 'Filtered grants and user access state.')}
        >
          <DataTable
            className="hidden xl:block shadow-none"
            columns={adminInlineColumns(lang, [
              'Entitlement',
              'User',
              'Source',
              'Context',
              'Status',
            ])}
            rows={entitlements.map((grant) => {
              const orderId = metadataOrderId(grant);
              return [
                grant.entitlement,
                <Link
                  key={`${grant.id}:user`}
                  href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(grant.userId)}`)}
                  className="font-medium text-admin-primary hover:underline"
                >
                  {grant.userId}
                </Link>,
                grant.source,
                <span
                  key={`${grant.id}:context`}
                  className="block text-xs leading-5 text-admin-text-muted"
                >
                  {grant.planId ?? 'no plan'}
                  {orderId ? ` · order ${orderId}` : ''}
                  {grant.expiresAt ? ` · ${grant.expiresAt}` : ''}
                </span>,
                <StatusBadge key={`${grant.id}:status`} lang={lang} value={grant.status} />,
              ];
            })}
            density="compact"
          />
          <div className="grid gap-1 xl:hidden">
            {entitlements.map((grant) => {
              const orderId = metadataOrderId(grant);
              return (
                <EntityListItem
                  key={grant.id}
                  href={localizedPath(
                    lang,
                    `/admin/entitlements?q=${encodeURIComponent(grant.userId)}`
                  )}
                  title={grant.entitlement}
                  subtitle={grant.userId}
                  status={grant.status}
                  detail={[
                    grant.source,
                    grant.planId ?? 'no plan',
                    orderId ? `order ${orderId}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  meta={grant.id}
                  icon={BadgeDollarSign}
                  density="compact"
                  tone={grant.status === 'active' ? 'primary' : 'warning'}
                />
              );
            })}
          </div>
        </EvidenceSection>
      ) : null}
      {showCredits ? (
        <EvidenceSection
          title={`Credit records · ${credits.length}`}
          description={adminInlineText(lang, 'Filtered credit ledger entries.')}
        >
          <DataTable
            className="hidden xl:block shadow-none"
            columns={adminInlineColumns(lang, ['Reason', 'User', 'Amount', 'Context'])}
            rows={credits.map((entry) => [
              entry.reason,
              <Link
                key={`${entry.id}:user`}
                href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(entry.userId)}`)}
                className="font-medium text-admin-primary hover:underline"
              >
                {entry.userId}
              </Link>,
              String(entry.amount),
              <span
                key={`${entry.id}:context`}
                className="block text-xs leading-5 text-admin-text-muted"
              >
                {entry.unit}
                {metadataOrderId(entry) ? ` · order ${metadataOrderId(entry)}` : ''}
              </span>,
            ])}
            density="compact"
          />
          <div className="grid gap-1 xl:hidden">
            {credits.map((entry) => (
              <EntityListItem
                key={entry.id}
                href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(entry.userId)}`)}
                title={entry.reason}
                subtitle={entry.userId}
                detail={[
                  `${entry.amount} ${entry.unit}`,
                  metadataOrderId(entry) ? `order ${metadataOrderId(entry)}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                meta={entry.id}
                icon={CreditCard}
                density="compact"
                tone={entry.amount < 0 ? 'danger' : 'primary'}
              />
            ))}
          </div>
        </EvidenceSection>
      ) : null}
    </>
  );
}
