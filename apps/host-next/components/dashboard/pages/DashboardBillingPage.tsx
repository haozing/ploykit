import { FormField, WorkspaceShell } from '@host/components/ProductShell';
import { ButtonLink, Input } from '@host/components/ui';
import { AdminPanel, FactList, PageSynopsis } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import type { HostBillingOverview } from '@host/lib/billing-api';
import {
  FriendlyStatusBadge,
  UserEmptyState,
  UserRecordCard,
  dashboardGhostButtonClass,
  dashboardPrimaryButtonClass,
  formatBillingPlan,
  formatCreditUnit,
  formatEntitlementLabel,
  formatMoneyAmount,
  formatPaymentMethodLabel,
  formatUserDate,
} from './DashboardPageUtils';

export function DashboardBillingOperationsPage({
  lang,
  overview,
}: {
  lang: SupportedLanguage;
  overview: HostBillingOverview;
}) {
  const copy = getDashboardCopy(lang).billing;
  const { snapshot, provider, invoices, paymentMethods, taxProfile, catalog } = overview;
  const profileText = (key: string) =>
    typeof taxProfile[key] === 'string' ? String(taxProfile[key]) : '';
  const checkoutSku = catalog.skus.find((sku) => sku.status !== 'archived') ?? catalog.skus[0];
  const activeEntitlement =
    snapshot.entitlements.find((item) => item.status === 'active') ?? snapshot.entitlements[0];
  const activePlan = activeEntitlement?.planId ?? checkoutSku?.planId;
  const paymentReadyLabel = provider.stripeConfigured
    ? dashboardInlineText(lang, 'ready_to_pay_7785f707')
    : dashboardInlineText(lang, 'demo_environment_d24b1a24');

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <div className="grid gap-4">
        <PageSynopsis
          lang={lang}
          title={dashboardInlineText(lang, 'billing_center_6b7cb102')}
          description={dashboardInlineText(
            lang,
            'start_with_the_current_plan_and_cost_then_review_7f86edcd'
          )}
          items={[
            {
              key: 'plan',
              label: dashboardInlineText(lang, 'current_plan_45e3ad53'),
              value: formatBillingPlan(lang, activePlan),
              tone: activePlan ? 'primary' : 'neutral',
            },
            {
              key: 'credits',
              label: dashboardInlineText(lang, 'credits_70d04d46'),
              value: String(snapshot.creditBalance.balance),
              tone: 'info',
            },
            {
              key: 'payment',
              label: dashboardInlineText(lang, 'payment_8c189583'),
              value: paymentReadyLabel,
              tone: provider.stripeConfigured ? 'success' : 'warning',
            },
            {
              key: 'invoices',
              label: dashboardInlineText(lang, 'billing_documents_a3d328b6'),
              value: String(invoices.length),
              tone: 'neutral',
            },
          ]}
        />

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <AdminPanel
            title={dashboardInlineText(lang, 'current_plan_45e3ad53')}
            description={dashboardInlineText(
              lang,
              'users_first_need_to_know_what_they_have_what_is__af154f49'
            )}
            action={
              checkoutSku ? (
                <form action="/api/billing/checkout" method="post">
                  <input type="hidden" name="sku" value={checkoutSku.id} />
                  <input
                    type="hidden"
                    name="next"
                    value={localizedPath(lang, '/dashboard/billing')}
                  />
                  <button type="submit" className={dashboardPrimaryButtonClass}>
                    {activePlan
                      ? dashboardInlineText(lang, 'manage_plan_3dafd87f')
                      : dashboardInlineText(lang, 'start_plan_b7964c9d')}
                  </button>
                </form>
              ) : null
            }
          >
            <div className="grid gap-4">
              <div className="rounded-admin-md border border-admin-primary/20 bg-admin-primary/10 p-4">
                <p className="text-sm font-semibold text-admin-primary">
                  {formatBillingPlan(lang, activePlan)}
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-admin-text">
                  {checkoutSku
                    ? formatMoneyAmount(lang, checkoutSku.amount, checkoutSku.currency)
                    : dashboardInlineText(lang, 'no_plan_selected_4a647345')}
                </h2>
                <p className="mt-2 text-sm leading-6 text-admin-text-muted">
                  {provider.stripeConfigured
                    ? dashboardInlineText(
                        lang,
                        'continue_to_checkout_orders_and_invoices_will_ap_f409b3d6'
                      )
                    : dashboardInlineText(
                        lang,
                        'this_open_source_demo_environment_does_not_charg_ae8ed90f'
                      )}
                </p>
              </div>
              {activeEntitlement ? (
                <UserRecordCard
                  lang={lang}
                  title={formatEntitlementLabel(lang, activeEntitlement.entitlement)}
                  description={formatBillingPlan(lang, activeEntitlement.planId)}
                  status={activeEntitlement.status}
                />
              ) : (
                <UserEmptyState
                  title={dashboardInlineText(lang, 'no_plan_access_yet_378471e2')}
                  body={dashboardInlineText(
                    lang,
                    'after_starting_a_plan_your_included_access_will__b1384780'
                  )}
                />
              )}
            </div>
          </AdminPanel>

          <AdminPanel
            title={dashboardInlineText(lang, 'billing_summary_b4243c3b')}
            description={dashboardInlineText(
              lang,
              'billing_details_work_better_as_a_summary_before__120a4515'
            )}
          >
            <FactList
              lang={lang}
              items={[
                {
                  label: dashboardInlineText(lang, 'payment_method_24c3775e'),
                  value: paymentMethods[0]
                    ? formatPaymentMethodLabel(
                        lang,
                        paymentMethods[0].label,
                        paymentMethods[0].provider
                      )
                    : dashboardInlineText(lang, 'not_saved_cff35d61'),
                },
                {
                  label: dashboardInlineText(lang, 'latest_invoice_a74cff15'),
                  value: invoices[0]?.number ?? dashboardInlineText(lang, 'none_yet_fab6c8d8'),
                },
                {
                  label: dashboardInlineText(lang, 'invoice_profile_36a4297f'),
                  value: profileText('company') || dashboardInlineText(lang, 'not_set_1e264983'),
                },
                {
                  label: dashboardInlineText(lang, 'orders_b34d55aa'),
                  value: String(snapshot.orders.length),
                },
              ]}
            />
          </AdminPanel>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <AdminPanel
            title={dashboardInlineText(lang, 'plans_776b71f3')}
            description={dashboardInlineText(
              lang,
              'plan_cards_should_show_only_what_users_need_to_d_d94069fd'
            )}
          >
            <div className="grid gap-3">
              {catalog.skus.map((sku) => (
                <UserRecordCard
                  key={sku.id}
                  lang={lang}
                  title={sku.name}
                  description={formatBillingPlan(lang, sku.planId)}
                  status={sku.status}
                  details={[
                    {
                      label: dashboardInlineText(lang, 'price_ef94daec'),
                      value: formatMoneyAmount(lang, sku.amount, sku.currency),
                    },
                    {
                      label: dashboardInlineText(lang, 'credits_80975d91'),
                      value: `${sku.credits} ${formatCreditUnit(lang, sku.creditUnit)}`,
                    },
                  ]}
                  actions={
                    <form action="/api/billing/checkout" method="post">
                      <input type="hidden" name="sku" value={sku.id} />
                      <input
                        type="hidden"
                        name="next"
                        value={localizedPath(lang, '/dashboard/billing')}
                      />
                      <button type="submit" className={dashboardGhostButtonClass}>
                        {dashboardInlineText(lang, 'select_700cb936')}
                      </button>
                    </form>
                  }
                />
              ))}
            </div>
          </AdminPanel>

          <AdminPanel
            title={dashboardInlineText(lang, 'invoices_and_receipts_10b7975e')}
            description={dashboardInlineText(
              lang,
              'users_may_need_these_for_reimbursement_refunds_o_6c6836dd'
            )}
          >
            {invoices.length > 0 ? (
              <div className="divide-y divide-admin-border rounded-admin-md border border-admin-border bg-admin-bg/40">
                {invoices.map((invoice) => (
                  <div
                    key={invoice.id}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-admin-text">{invoice.number}</h3>
                        <FriendlyStatusBadge lang={lang} value={invoice.status} />
                      </div>
                      <p className="mt-1 text-sm text-admin-text-muted">
                        {formatUserDate(lang, invoice.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm font-semibold text-admin-text">
                        {formatMoneyAmount(lang, invoice.amount, invoice.currency)}
                      </span>
                      <ButtonLink href={invoice.hostedUrl} variant="secondary" size="small">
                        {dashboardInlineText(lang, 'view_document_27875c3d')}
                      </ButtonLink>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <UserEmptyState
                title={dashboardInlineText(lang, 'no_invoices_or_receipts_yet_153fe281')}
                body={dashboardInlineText(
                  lang,
                  'billing_documents_will_appear_here_after_a_purch_3d102256'
                )}
              />
            )}
          </AdminPanel>
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <AdminPanel
            title={dashboardInlineText(lang, 'payment_methods_2db7ab78')}
            description={dashboardInlineText(
              lang,
              'show_payment_methods_in_language_users_recognize_5abbcd7a'
            )}
          >
            {paymentMethods.length > 0 ? (
              <div className="grid gap-3">
                {paymentMethods.map((method) => (
                  <UserRecordCard
                    key={method.id}
                    lang={lang}
                    title={formatPaymentMethodLabel(lang, method.label, method.provider)}
                    description={
                      method.brand ?? dashboardInlineText(lang, 'saved_payment_method_7abd12b6')
                    }
                    status={method.status}
                  />
                ))}
              </div>
            ) : (
              <UserEmptyState
                title={dashboardInlineText(lang, 'no_payment_method_yet_01d902be')}
                body={dashboardInlineText(
                  lang,
                  'payment_methods_will_appear_here_after_the_first_068e91d9'
                )}
              />
            )}
          </AdminPanel>

          <AdminPanel
            title={copy.taxProfile}
            description={dashboardInlineText(
              lang,
              'used_for_invoice_headers_and_tax_details_db146188'
            )}
          >
            <form action="/api/billing/tax-profile" method="post" className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label={copy.company} htmlFor="billing-company">
                  <Input
                    id="billing-company"
                    name="company"
                    defaultValue={profileText('company')}
                  />
                </FormField>
                <FormField
                  label={dashboardInlineText(lang, 'tax_id_f8871caf')}
                  htmlFor="billing-tax-id"
                >
                  <Input id="billing-tax-id" name="taxId" defaultValue={profileText('taxId')} />
                </FormField>
                <FormField
                  label={dashboardInlineText(lang, 'country_region_9439aec8')}
                  htmlFor="billing-country"
                >
                  <Input
                    id="billing-country"
                    name="country"
                    defaultValue={profileText('country')}
                  />
                </FormField>
              </div>
              <button type="submit" className={`${dashboardPrimaryButtonClass} w-fit`}>
                {copy.save}
              </button>
            </form>
          </AdminPanel>
        </section>
      </div>
    </WorkspaceShell>
  );
}
