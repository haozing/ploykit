import { ConfirmSubmitButton, DataTable } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import {
  DangerZone,
  FilterBar,
  MoreActionMenu,
  SegmentedWorkspace,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatCurrencyMinor } from '@host/lib/i18n-format';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import {
  billingCommercialTypeOptions,
  type BillingPageModel,
} from './BillingPageModel';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

function FilterResultHint({
  lang,
  visible,
  total,
}: {
  lang: SupportedLanguage;
  visible: number;
  total: number;
}) {
  if (visible === total) {
    return null;
  }
  return (
    <p className="muted">
      {adminInlineText(lang, 'current_filter_shows_value_value_records_ffd8ee7a', {
        value1: visible,
        value2: total,
      })}
    </p>
  );
}

export function BillingCatalogWorkspace({
  lang,
  model,
  archivePlanAction,
  archiveSkuAction,
  syncSkuAction,
}: {
  lang: SupportedLanguage;
  model: BillingPageModel;
  archivePlanAction?: AdminFormAction;
  archiveSkuAction?: AdminFormAction;
  syncSkuAction?: AdminFormAction;
}) {
  const { commercial, tableQuery, visibleCount, totalCount, skusByPlan } = model;

  return (
    <>
      <SegmentedWorkspace
        lang={lang}
        title={adminInlineText(lang, 'Commercial catalog')}
        description={adminInlineText(
          lang,
          'Plans and SKUs are the primary billing workspace. They are grouped as product packages first, with row-level maintenance behind compact actions.'
        )}
        sections={[
          {
            key: 'billing-plans',
            label: 'Plans',
            count: commercial.catalog.plans.length,
            content: (
              <DataTable
                className="shadow-none"
                density="compact"
                columns={adminInlineColumns(lang, [
                  'Plan',
                  'Package',
                  'Subscribers',
                  'Coverage',
                  'Maintenance',
                ])}
                rows={commercial.catalog.plans.map((plan) => {
                  const skus = skusByPlan[plan.id] ?? [];
                  const monthlySku = skus.find((sku) => sku.interval === 'month');
                  const oneTimeSku = skus.find((sku) => sku.interval === 'one_time');
                  return [
                    <span key={`${plan.id}:plan`} className="block min-w-0">
                      <span className="block truncate font-semibold text-admin-text">
                        {plan.name}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                        {plan.id}
                      </span>
                    </span>,
                    <span
                      key={`${plan.id}:package`}
                      className="block text-xs leading-5 text-admin-text-muted"
                    >
                      {monthlySku
                        ? `${formatCurrencyMinor(monthlySku.amount, monthlySku.currency, lang)} / month`
                        : 'no monthly SKU'}
                      {oneTimeSku
                        ? ` · ${formatCurrencyMinor(oneTimeSku.amount, oneTimeSku.currency, lang)} one-time`
                        : ''}
                    </span>,
                    String(commercial.planSubscribers[plan.id] ?? 0),
                    <span
                      key={`${plan.id}:coverage`}
                      className="block max-w-sm text-xs leading-5 text-admin-text-muted"
                    >
                      {plan.entitlements.join(', ') || 'No entitlements'}
                      {Object.keys(plan.limits).length > 0
                        ? ` · ${Object.entries(plan.limits)
                            .map(([key, value]) => `${key}:${value}`)
                            .join(', ')}`
                        : ''}
                    </span>,
                    <div key={`${plan.id}:action`} className="flex items-center gap-2">
                      <StatusBadge lang={lang} value={plan.status} />
                      {archivePlanAction ? (
                        <MoreActionMenu label={adminInlineText(lang, 'Maintain')}>
                          <form action={archivePlanAction}>
                            <input type="hidden" name="planId" value={plan.id} />
                            <input type="hidden" name="reason" value={`Archive plan ${plan.id}`} />
                            <ConfirmSubmitButton
                              type="submit"
                              className="inline-flex w-full min-h-8 items-center justify-center rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 px-3 py-1.5 text-xs font-semibold text-admin-danger transition hover:bg-admin-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                              disabled={plan.status === 'archived'}
                              confirmation={adminInlineText(
                                lang,
                                'archive_plan_value_existing_subscriptions_will_not_b_da179b8e',
                                { value1: plan.name }
                              )}
                            >
                              {adminInlineText(lang, 'Archive plan')}
                            </ConfirmSubmitButton>
                          </form>
                        </MoreActionMenu>
                      ) : null}
                    </div>,
                  ];
                })}
              />
            ),
          },
          {
            key: 'billing-skus',
            label: 'SKU packages',
            count: commercial.catalog.skus.length,
            content: (
              <DataTable
                className="shadow-none"
                density="compact"
                columns={adminInlineColumns(lang, [
                  'SKU',
                  'Plan',
                  'Price',
                  'Credits',
                  'Maintenance',
                ])}
                rows={commercial.catalog.skus.map((sku) => [
                  <span key={`${sku.id}:sku`} className="block min-w-0">
                    <span className="block truncate font-semibold text-admin-text">{sku.name}</span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                      {sku.id}
                    </span>
                  </span>,
                  sku.planId,
                  `${formatCurrencyMinor(sku.amount, sku.currency, lang)} · ${sku.interval}`,
                  `${sku.credits} ${sku.creditUnit}`,
                  <div key={`${sku.id}:actions`} className="flex items-center gap-2">
                    <StatusBadge lang={lang} value={sku.status ?? 'active'} />
                    {syncSkuAction || archiveSkuAction ? (
                      <MoreActionMenu label={adminInlineText(lang, 'Maintain')}>
                        {syncSkuAction ? (
                          <form action={syncSkuAction}>
                            <input type="hidden" name="skuId" value={sku.id} />
                            <input type="hidden" name="reason" value={`Sync SKU ${sku.id}`} />
                            <ConfirmSubmitButton
                              type="submit"
                              className="inline-flex w-full min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                              confirmation={adminInlineText(
                                lang,
                                'sync_sku_value_to_the_stripe_status_check_919dc3f3',
                                { value1: sku.name }
                              )}
                            >
                              {adminInlineText(lang, 'Sync provider')}
                            </ConfirmSubmitButton>
                          </form>
                        ) : null}
                        {archiveSkuAction ? (
                          <form action={archiveSkuAction}>
                            <input type="hidden" name="skuId" value={sku.id} />
                            <input type="hidden" name="reason" value={`Archive SKU ${sku.id}`} />
                            <ConfirmSubmitButton
                              type="submit"
                              className="inline-flex w-full min-h-8 items-center justify-center rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 px-3 py-1.5 text-xs font-semibold text-admin-danger transition hover:bg-admin-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                              disabled={sku.status === 'archived'}
                              confirmation={adminInlineText(lang, 'archive_sku_value_6fe9d791', {
                                value1: sku.name,
                              })}
                            >
                              {adminInlineText(lang, 'Archive SKU')}
                            </ConfirmSubmitButton>
                          </form>
                        ) : null}
                      </MoreActionMenu>
                    ) : null}
                  </div>,
                ])}
              />
            ),
          },
          {
            key: 'billing-catalog-filter',
            label: 'Ledger filter',
            count: visibleCount,
            content: (
              <div className="grid gap-3">
                <FilterBar
                  lang={lang}
                  embedded
                  searchValue={tableQuery.q}
                  searchPlaceholder="搜索订单、权益、用户或 credit reason"
                  filterName="type"
                  filterValue={tableQuery.type}
                  filterLabel="记录"
                  filterOptions={billingCommercialTypeOptions}
                  resetHref={localizedPath(lang, '/admin/billing')}
                />
                <FilterResultHint lang={lang} visible={visibleCount} total={totalCount} />
              </div>
            ),
          },
        ]}
      />
      {archivePlanAction || archiveSkuAction ? (
        <DangerZone
          title={adminInlineText(lang, 'Catalog archive controls')}
          description={adminInlineText(
            lang,
            'Archive actions are intentionally hidden in row-level Maintain menus. They never appear as primary catalog actions.'
          )}
        />
      ) : null}
    </>
  );
}
