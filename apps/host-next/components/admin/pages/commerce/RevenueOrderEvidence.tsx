import Link from 'next/link';
import { ReceiptText } from 'lucide-react';
import { DataTable, DetailDrawer } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import {
  AdminPanel,
  ChartPanel,
  EntityListItem,
  EvidenceSection,
  FactList,
  FilterBar,
  TimelineList,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { RuntimeStoreAuditRecord, RuntimeStoreCommercialOrder } from '@/lib/module-runtime';
import type { HostBillingOverview } from '@host/lib/billing-api';
import {
  compactJson,
  orderContextLinks,
  type AdminPagedResult,
  type RevenueOrderBenefitSummary,
} from './RevenuePageModel';

type RevenueOrderEvidenceData = AdminPagedResult<RuntimeStoreCommercialOrder> & {
  providerEvents: RuntimeStoreAuditRecord[];
  catalog: HostBillingOverview['catalog'];
  dailyBuckets: {
    day: string;
    total: number;
    paid: number;
    refunded: number;
    failed: number;
    currencies: Record<string, number>;
  }[];
};

export function RevenueOrderEvidence({
  lang,
  revenue,
  tableQuery,
  paidOrders,
  refundedOrders,
  failedOrders,
  focusOrder,
  benefitSummaryByOrder,
}: {
  lang: SupportedLanguage;
  revenue: RevenueOrderEvidenceData;
  tableQuery: Required<AdminTableQuery>;
  paidOrders: RuntimeStoreCommercialOrder[];
  refundedOrders: RuntimeStoreCommercialOrder[];
  failedOrders: RuntimeStoreCommercialOrder[];
  focusOrder: RuntimeStoreCommercialOrder | null;
  benefitSummaryByOrder: Map<string, RevenueOrderBenefitSummary>;
}) {
  const dailyBuckets = revenue.dailyBuckets;
  const chartBuckets = dailyBuckets.slice(-14);

  return (
    <>
      {focusOrder ? (
        <DetailDrawer
          open
          title={adminInlineText(lang, 'Order evidence')}
          description={`${focusOrder.id} · ${focusOrder.sku}`}
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
              { label: 'Provider', value: focusOrder.provider ?? 'local' },
              { label: 'Provider Ref', value: focusOrder.providerRef ?? 'none', mono: true },
              {
                label: 'Benefit status',
                value: (() => {
                  const summary = benefitSummaryByOrder.get(focusOrder.id);
                  return summary
                    ? [
                        summary.missingEntitlements.length
                          ? summary.missingEntitlements.join(', ')
                          : null,
                        summary.missingCredits ? `${summary.missingCredits} credits` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'satisfied'
                    : 'not loaded';
                })(),
                tone: (() => {
                  const summary = benefitSummaryByOrder.get(focusOrder.id);
                  return summary &&
                    (summary.missingCredits > 0 || summary.missingEntitlements.length > 0)
                    ? 'warning'
                    : 'success';
                })(),
              },
            ]}
          />
        </DetailDrawer>
      ) : null}
      <ChartPanel
        title={adminInlineText(lang, 'Revenue pulse')}
        description={adminInlineText(
          lang,
          'Daily paid revenue buckets are returned by the admin API so filtering the order table does not collapse the trend context.'
        )}
        values={chartBuckets.map((bucket) => bucket.total)}
        labels={chartBuckets.map((bucket) => bucket.day.slice(5))}
        axisLabel="paid amount"
        legend={[
          { key: 'paid', label: 'Paid', value: paidOrders.length, tone: 'success' },
          {
            key: 'refunded',
            label: 'Refunded',
            value: refundedOrders.length,
            tone: refundedOrders.length > 0 ? 'warning' : 'neutral',
          },
          {
            key: 'failed',
            label: 'Failed',
            value: failedOrders.length,
            tone: failedOrders.length > 0 ? 'danger' : 'neutral',
          },
        ]}
        drilldownHref={localizedPath(lang, '/admin/billing')}
        drilldownLabel="Billing detail"
        stats={[
          {
            key: 'paid',
            label: 'Paid orders',
            value: paidOrders.length,
            detail: `${revenue.page.total} total rows`,
            tone: 'success',
          },
          {
            key: 'refunded',
            label: 'Refunded',
            value: refundedOrders.length,
            detail: 'watch revenue leakage',
            tone: refundedOrders.length > 0 ? 'warning' : 'neutral',
          },
          {
            key: 'failed',
            label: 'Failed',
            value: failedOrders.length,
            detail: failedOrders.length > 0 ? 'needs review' : 'clear',
            tone: failedOrders.length > 0 ? 'danger' : 'success',
          },
        ]}
        empty={adminInlineText(lang, 'No revenue orders in this window.')}
      />
      <AdminPanel
        title={adminInlineText(lang, 'Order ledger')}
        description={adminInlineText(
          lang,
          'Filter revenue records by order, SKU, user, or payment status.'
        )}
        contentClassName="p-0"
      >
        <FilterBar
          lang={lang}
          embedded
          searchValue={tableQuery.q}
          searchPlaceholder="搜索订单、SKU、用户或状态"
          filterValue={tableQuery.status}
          filterOptions={[
            { value: 'paid', label: 'Paid' },
            { value: 'pending', label: 'Pending' },
            { value: 'failed', label: 'Failed' },
            { value: 'refunded', label: 'Refunded' },
          ]}
          resetHref={localizedPath(lang, '/admin/revenue')}
        />
        <DataTable
          title={adminInlineText(lang, 'Daily buckets')}
          description={adminInlineText(lang, 'Revenue grouped by order created date and currency.')}
          className="rounded-none border-x-0 shadow-none"
          columns={adminInlineColumns(lang, ['Date', 'Paid Amount', 'Paid', 'Refunded', 'Failed'])}
          rows={dailyBuckets.map((bucket) => [
            bucket.day,
            Object.entries(bucket.currencies)
              .map(([currency, amount]) => `${amount} ${currency}`)
              .join(', ') || '0',
            String(bucket.paid),
            String(bucket.refunded),
            String(bucket.failed),
          ])}
          empty={adminInlineText(lang, 'No daily revenue buckets in this window.')}
        />
        <DataTable
          className="rounded-none border-x-0 border-b-0 shadow-none"
          columns={adminInlineColumns(lang, ['Order', 'SKU', 'User', 'Amount', 'Status', 'Links'])}
          rows={revenue.items.map((order) => [
            <span key={`${order.id}:order`} className="font-mono text-xs">
              {order.id}
            </span>,
            order.sku,
            <Link
              key={`${order.id}:user`}
              href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(order.userId)}`)}
              className="font-medium text-admin-primary hover:underline"
            >
              {order.userId}
            </Link>,
            `${order.amount} ${order.currency}`,
            <StatusBadge key={order.id} lang={lang} value={order.status} />,
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
          ])}
        />
        <div className="grid gap-1 px-2 py-2 xl:hidden">
          {revenue.items.map((order) => (
            <EntityListItem
              key={order.id}
              href={localizedPath(lang, `/admin/revenue?q=${encodeURIComponent(order.id)}`)}
              title={order.sku}
              subtitle={order.userId}
              status={order.status}
              detail={`${order.amount} ${order.currency}`}
              meta={order.id}
              icon={ReceiptText}
              density="compact"
              tone={
                order.status === 'failed'
                  ? 'danger'
                  : order.status === 'refunded'
                    ? 'warning'
                    : 'primary'
              }
            />
          ))}
        </div>
      </AdminPanel>
      <AdminPanel
        title={adminInlineText(lang, 'Commercial evidence')}
        description={adminInlineText(
          lang,
          'Pricing package details and provider events stay available for audit without taking over the revenue workflow.'
        )}
        contentClassName="grid gap-3"
      >
        <EvidenceSection
          title={adminInlineText(lang, 'SKU catalog')}
          description={adminInlineText(
            lang,
            'Pricing packages shown as business objects, not raw config.'
          )}
        >
          <DataTable
            className="shadow-none"
            columns={adminInlineColumns(lang, ['SKU', 'Plan', 'Amount', 'Credits'])}
            rows={revenue.catalog.skus.map((sku) => [
              sku.name,
              sku.planId,
              `${sku.amount} ${sku.currency}`,
              `${sku.credits} ${sku.creditUnit}`,
            ])}
            minWidthClass="min-w-[720px]"
          />
        </EvidenceSection>
        <EvidenceSection
          title={adminInlineText(lang, 'Provider events')}
          description={adminInlineText(
            lang,
            'Payment provider and reconcile evidence grouped as a timeline.'
          )}
        >
          <TimelineList
            lang={lang}
            items={revenue.providerEvents.map((record) => ({
              key: record.id,
              title: record.type,
              description: compactJson(record.metadata, 180),
              meta: record.actorId ?? 'system',
              tone: record.type.includes('failed')
                ? 'danger'
                : record.type.includes('reconcile')
                  ? 'warning'
                  : 'primary',
            }))}
            empty={adminInlineText(lang, 'No provider or reconcile events yet.')}
          />
        </EvidenceSection>
      </AdminPanel>
    </>
  );
}
