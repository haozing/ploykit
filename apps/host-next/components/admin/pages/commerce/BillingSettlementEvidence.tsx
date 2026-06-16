import { DataTable } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import { AdminPanel, EvidenceSection } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminCommercialView } from '@host/lib/admin-commercial';

export function BillingSettlementEvidence({
  lang,
  commercial,
}: {
  lang: SupportedLanguage;
  commercial: AdminCommercialView;
}) {
  return (
    <AdminPanel
      title={adminInlineText(lang, 'Settlement evidence')}
      description={adminInlineText(
        lang,
        'Subscriptions, invoices, payment methods, and tax profiles are settlement evidence. They stay collapsed until an operator needs the detail.'
      )}
      contentClassName="grid gap-3"
    >
      {[
        {
          key: 'subscriptions',
          title: `${adminInlineText(lang, 'Subscriptions')} · ${commercial.subscriptions.length}`,
          description: 'Subscriptions connect customer access to plan state.',
          table: (
            <DataTable
              className="shadow-none"
              columns={adminInlineColumns(lang, ['Subscription', 'User', 'Plan', 'Status'])}
              rows={commercial.subscriptions.map((subscription) => [
                subscription.entitlement,
                subscription.userId,
                subscription.planId,
                <StatusBadge key={subscription.id} lang={lang} value={subscription.status} />,
              ])}
              density="compact"
            />
          ),
        },
        {
          key: 'invoices',
          title: `${adminInlineText(lang, 'Invoices')} · ${commercial.invoices.length}`,
          description: 'Invoices explain settlement evidence for paid orders.',
          table: (
            <DataTable
              className="shadow-none"
              columns={adminInlineColumns(lang, ['Invoice', 'Order', 'Amount', 'Status'])}
              rows={commercial.invoices.map((invoice) => [
                invoice.id,
                invoice.orderId,
                `${invoice.amount} ${invoice.currency}`,
                <StatusBadge key={invoice.id} lang={lang} value={invoice.status} />,
              ])}
              density="compact"
            />
          ),
        },
        {
          key: 'payment-methods',
          title: `${adminInlineText(lang, 'Payment methods')} · ${commercial.paymentMethods.length}`,
          description: 'Saved payment methods stay together with the settlement evidence.',
          table: (
            <DataTable
              className="shadow-none"
              columns={adminInlineColumns(lang, ['Payment Method', 'User', 'Provider', 'Status'])}
              rows={
                commercial.paymentMethods.length > 0
                  ? commercial.paymentMethods.map((method) => [
                      method.label,
                      method.userId ?? 'system',
                      method.provider,
                      <StatusBadge key={method.id} lang={lang} value={method.status} />,
                    ])
                  : [['-', '-', '-', 'No saved payment methods']]
              }
              density="compact"
            />
          ),
        },
        {
          key: 'tax',
          title: `${adminInlineText(lang, 'Tax profiles')} · ${commercial.taxProfiles.length}`,
          description: 'Tax profiles are retained as evidence, not as a separate page band.',
          table: (
            <DataTable
              className="shadow-none"
              columns={adminInlineColumns(lang, ['Tax Profile', 'Company', 'Country', 'Tax ID'])}
              rows={
                commercial.taxProfiles.length > 0
                  ? commercial.taxProfiles.map((profile) => [
                      profile.userId,
                      profile.company ?? '-',
                      profile.country ?? '-',
                      profile.taxIdMasked ?? '-',
                    ])
                  : [['-', '-', '-', 'No tax profile data']]
              }
              density="compact"
            />
          ),
        },
      ].map((section) => (
        <EvidenceSection
          key={section.key}
          title={section.title}
          description={adminInlineText(lang, section.description)}
        >
          {section.table}
        </EvidenceSection>
      ))}
    </AdminPanel>
  );
}
