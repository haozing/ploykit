import { BadgeDollarSign, CreditCard, PackageCheck, ReceiptText } from 'lucide-react';
import { StatCard } from '@host/components/ProductShell';
import { ConfirmSubmitButton } from '@host/components/ui';
import {
  ActionPanel,
  ActionQueue,
  StatGrid,
} from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { type SupportedLanguage } from '@host/lib/i18n';
import type { RuntimeStoreCommercialOrder } from '@/lib/module-runtime';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function RevenueOverviewPanels({
  lang,
  totals,
  totalOrders,
  failedOrders,
  missingBenefitOrders,
  reviewItems,
  reconcileBillingAction,
}: {
  lang: SupportedLanguage;
  totals: Record<string, number>;
  totalOrders: number;
  failedOrders: readonly RuntimeStoreCommercialOrder[];
  missingBenefitOrders: readonly RuntimeStoreCommercialOrder[];
  reviewItems: ReadonlyArray<{
    key: string;
    title: string;
    description: string;
    actionLabel: string;
    href: string;
    status: string;
    tone: 'danger' | 'warning';
  }>;
  reconcileBillingAction?: AdminFormAction;
}) {
  return (
    <>
      <StatGrid>
        {Object.entries(totals).map(([currency, amount]) => (
          <StatCard
            key={currency}
            label={currency}
            value={String(amount)}
            helper={adminInlineText(lang, 'Recognized total')}
            tone="blue"
            icon={BadgeDollarSign}
          />
        ))}
        <StatCard
          label={adminInlineText(lang, 'Orders')}
          value={String(totalOrders)}
          helper={adminInlineText(lang, 'Commercial ledger rows')}
          icon={ReceiptText}
        />
        <StatCard
          label={adminInlineText(lang, 'Failed orders')}
          value={String(failedOrders.length)}
          helper={adminInlineText(lang, 'Needs payment follow-up')}
          tone={failedOrders.length > 0 ? 'amber' : 'green'}
          icon={CreditCard}
        />
        <StatCard
          label={adminInlineText(lang, 'Missing benefits')}
          value={String(missingBenefitOrders.length)}
          helper={adminInlineText(lang, 'Credits or entitlements')}
          tone={missingBenefitOrders.length > 0 ? 'red' : 'green'}
          icon={PackageCheck}
        />
      </StatGrid>
      {reviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'Revenue review')}
          description={adminInlineText(
            lang,
            'Failed, refunded, and missing-benefit orders are promoted before the ledger so reconcile has a concrete target.'
          )}
          status="warning"
          items={reviewItems}
        />
      ) : null}
      {reconcileBillingAction ? (
        <ActionPanel
          title={adminInlineText(lang, 'Billing reconcile')}
          description={adminInlineText(
            lang,
            'Replay paid order benefits and repair missing entitlements or credits by idempotency key.'
          )}
          tone={failedOrders.length > 0 ? 'warning' : 'primary'}
          actions={
            <form action={reconcileBillingAction}>
              <ConfirmSubmitButton
                type="submit"
                className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                confirmation={adminInlineText(
                  lang,
                  '确认执行 Billing reconcile？该操作会补齐缺失的 paid order benefits。'
                )}
              >
                {adminInlineText(lang, 'Reconcile')}
              </ConfirmSubmitButton>
            </form>
          }
        />
      ) : null}
    </>
  );
}
