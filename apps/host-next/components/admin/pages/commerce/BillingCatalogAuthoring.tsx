import { ConfirmSubmitButton, Input, Select } from '@host/components/ui';
import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function BillingCatalogAuthoring({
  lang,
  upsertPlanAction,
  upsertSkuAction,
}: {
  lang: SupportedLanguage;
  upsertPlanAction?: AdminFormAction;
  upsertSkuAction?: AdminFormAction;
}) {
  if (!upsertPlanAction && !upsertSkuAction) {
    return null;
  }

  return (
    <AdminPanel
      title={adminInlineText(lang, 'Catalog authoring')}
      description={adminInlineText(
        lang,
        'Plan and SKU editing is grouped separately from customer ledgers so product packaging does not blend into transaction review.'
      )}
      contentClassName="connection-policy-grid"
    >
      {upsertPlanAction ? (
        <details className="rounded-admin-md border border-admin-border bg-admin-bg/40">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted/60 [&::-webkit-details-marker]:hidden">
            {adminInlineText(lang, 'Plan authoring')}
          </summary>
          <form action={upsertPlanAction} className="grid gap-4 border-t border-admin-border p-4">
            <div>
              <h2>{adminInlineText(lang, 'Plan')}</h2>
              <p>{adminInlineText(lang, '创建或更新计划，权益会进入 runtime billing guard。')}</p>
            </div>
            <Input
              name="planId"
              placeholder={adminInlineText(lang, 'team-pro')}
              aria-label={adminInlineText(lang, 'Plan ID')}
              required
            />
            <Input
              name="name"
              placeholder={adminInlineText(lang, 'Team Pro')}
              aria-label={adminInlineText(lang, 'Plan name')}
              required
            />
            <Input
              name="entitlements"
              placeholder={adminInlineText(lang, 'public-tools.pro,ai.rag')}
              aria-label={adminInlineText(lang, 'Entitlements')}
            />
            <Input
              name="features"
              placeholder={adminInlineText(lang, 'priority support,team workspace')}
              aria-label={adminInlineText(lang, 'Features')}
            />
            <Input
              name="limits"
              placeholder={adminInlineText(lang, 'credits:1000,filesMb:250')}
              aria-label={adminInlineText(lang, 'Limits')}
            />
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              confirmation={adminInlineText(lang, '确认保存 billing plan？')}
            >
              {adminInlineText(lang, 'Save Plan')}
            </ConfirmSubmitButton>
          </form>
        </details>
      ) : null}
      {upsertSkuAction ? (
        <details className="rounded-admin-md border border-admin-border bg-admin-bg/40">
          <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted/60 [&::-webkit-details-marker]:hidden">
            {adminInlineText(lang, 'SKU authoring')}
          </summary>
          <form action={upsertSkuAction} className="grid gap-4 border-t border-admin-border p-4">
            <div>
              <h2>{adminInlineText(lang, 'SKU')}</h2>
              <p>
                {adminInlineText(
                  lang,
                  '创建或更新 SKU，checkout 和 paid order benefits 会使用它。'
                )}
              </p>
            </div>
            <Input
              name="skuId"
              placeholder={adminInlineText(lang, 'team-pro-monthly')}
              aria-label={adminInlineText(lang, 'SKU ID')}
              required
            />
            <Input
              name="name"
              placeholder={adminInlineText(lang, 'Team Pro Monthly')}
              aria-label={adminInlineText(lang, 'SKU name')}
              required
            />
            <Input
              name="planId"
              placeholder={adminInlineText(lang, 'team-pro')}
              aria-label={adminInlineText(lang, 'Plan ID')}
              required
            />
            <Input
              name="amount"
              placeholder="1200"
              aria-label={adminInlineText(lang, 'Amount cents')}
              required
            />
            <Input
              name="currency"
              placeholder={adminInlineText(lang, 'USD')}
              aria-label={adminInlineText(lang, 'Currency')}
            />
            <Select
              name="interval"
              defaultValue="month"
              aria-label={adminInlineText(lang, 'Interval')}
            >
              <option value="month">{adminInlineText(lang, 'Monthly')}</option>
              <option value="one_time">{adminInlineText(lang, 'One time')}</option>
            </Select>
            <Input
              name="credits"
              placeholder="1000"
              aria-label={adminInlineText(lang, 'Credits')}
            />
            <Input
              name="creditUnit"
              placeholder={adminInlineText(lang, 'credit')}
              aria-label={adminInlineText(lang, 'Credit unit')}
            />
            <Input
              name="entitlements"
              placeholder={adminInlineText(lang, 'public-tools.pro')}
              aria-label={adminInlineText(lang, 'Entitlements')}
            />
            <Input
              name="stripePriceId"
              placeholder={adminInlineText(lang, 'price_test_...')}
              aria-label={adminInlineText(lang, 'Stripe price ID')}
            />
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              confirmation={adminInlineText(lang, '确认保存 SKU？')}
            >
              {adminInlineText(lang, 'Save SKU')}
            </ConfirmSubmitButton>
          </form>
        </details>
      ) : null}
    </AdminPanel>
  );
}
