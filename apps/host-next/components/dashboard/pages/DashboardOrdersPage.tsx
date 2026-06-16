import { WorkspaceShell } from '@host/components/ProductShell';
import { ButtonLink } from '@host/components/ui';
import { AdminPanel, PageSynopsis } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatCurrencyMinor } from '@host/lib/i18n-format';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import type { UserSaasSnapshot } from '@host/lib/saas-operations';
import {
  FriendlyStatusBadge,
  UserEmptyState,
  formatBillingSku,
  formatOrderAmount,
  formatUserDate,
} from './DashboardPageUtils';

export function DashboardOrdersOperationsPage({
  lang,
  snapshot,
}: {
  lang: SupportedLanguage;
  snapshot: UserSaasSnapshot;
}) {
  const copy = getDashboardCopy(lang).orders;
  const paidOrders = snapshot.orders.filter((order) => order.status === 'paid').length;
  const totalAmount = snapshot.orders.reduce((total, order) => total + order.amount, 0);
  const currency = snapshot.orders[0]?.currency ?? 'USD';

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <div className="grid gap-4">
        <PageSynopsis
          lang={lang}
          title={dashboardInlineText(lang, 'orders_7e89b24b')}
          description={dashboardInlineText(
            lang,
            'the_orders_page_should_start_as_a_purchase_histo_c1feea91'
          )}
          items={[
            {
              key: 'orders',
              label: dashboardInlineText(lang, 'orders_ca187bf2'),
              value: String(snapshot.orders.length),
              tone: 'primary',
            },
            {
              key: 'paid',
              label: dashboardInlineText(lang, 'completed_58782c56'),
              value: String(paidOrders),
              tone: 'success',
            },
            {
              key: 'amount',
              label: dashboardInlineText(lang, 'total_2c4e661e'),
              value:
                totalAmount === 0
                  ? dashboardInlineText(lang, 'free_demo_orders_d0fb6a4c')
                  : formatCurrencyMinor(totalAmount, currency, lang),
              tone: 'info',
            },
          ]}
        />

        <AdminPanel
          title={dashboardInlineText(lang, 'order_records_3a7874ee')}
          description={dashboardInlineText(
            lang,
            'a_chronological_list_for_checking_plan_amount_st_979cb88e'
          )}
          action={
            <ButtonLink
              href={localizedPath(lang, '/dashboard/billing')}
              variant="secondary"
              size="small"
            >
              {dashboardInlineText(lang, 'back_to_billing_93a176f0')}
            </ButtonLink>
          }
        >
          {snapshot.orders.length > 0 ? (
            <div className="overflow-hidden rounded-admin-md border border-admin-border bg-admin-bg/40">
              <div className="hidden grid-cols-[minmax(0,1.2fr)_0.8fr_0.8fr_0.8fr_auto] gap-3 border-b border-admin-border px-4 py-2 text-xs font-semibold uppercase text-admin-text-subtle md:grid">
                <span>{dashboardInlineText(lang, 'order_4e19c211')}</span>
                <span>{dashboardInlineText(lang, 'date_f14abad2')}</span>
                <span>{dashboardInlineText(lang, 'amount_a72e74a9')}</span>
                <span>{dashboardInlineText(lang, 'status_8042eaf1')}</span>
                <span className="text-right">{dashboardInlineText(lang, 'action_c3ce74b0')}</span>
              </div>
              <div className="divide-y divide-admin-border">
                {snapshot.orders.map((order) => (
                  <div
                    key={order.id}
                    className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.2fr)_0.8fr_0.8fr_0.8fr_auto] md:items-center"
                  >
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-admin-text">
                        {formatBillingSku(order.sku)}
                      </h3>
                      <p className="mt-1 text-xs text-admin-text-subtle">
                        {dashboardInlineText(lang, 'order_2702bd80')}{' '}
                        {order.id.slice(0, 8).toUpperCase()}
                      </p>
                    </div>
                    <span className="text-sm text-admin-text-muted">
                      {formatUserDate(lang, order.createdAt)}
                    </span>
                    <span className="text-sm font-semibold text-admin-text">
                      {formatOrderAmount(lang, order.amount, order.currency)}
                    </span>
                    <FriendlyStatusBadge lang={lang} value={order.status} />
                    <div className="flex justify-start md:justify-end">
                      <ButtonLink
                        href={`/api/billing/invoices?id=invoice-${order.id}`}
                        variant="secondary"
                        size="small"
                      >
                        {dashboardInlineText(lang, 'view_document_27875c3d')}
                      </ButtonLink>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <UserEmptyState
              title={dashboardInlineText(lang, 'no_orders_yet_b6d57cb8')}
              body={dashboardInlineText(
                lang,
                'after_checkout_your_purchase_records_and_payment_cbfd13fa'
              )}
              action={
                <ButtonLink
                  href={localizedPath(lang, '/dashboard/billing')}
                  variant="secondary"
                  size="small"
                >
                  {dashboardInlineText(lang, 'view_billing_3d3e1480')}
                </ButtonLink>
              }
            />
          )}
        </AdminPanel>
      </div>
    </WorkspaceShell>
  );
}
