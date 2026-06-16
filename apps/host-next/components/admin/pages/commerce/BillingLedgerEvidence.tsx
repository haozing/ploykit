import { DataTable } from '@host/components/ui';
import { AdminPanel, EvidenceSection } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { BillingPageModel } from './BillingPageModel';
import { BillingCustomerLedgerEvidence } from './BillingCustomerLedgerEvidence';
import { BillingOperationalLedgerEvidence } from './BillingOperationalLedgerEvidence';

export function BillingLedgerEvidence({
  lang,
  model,
}: {
  lang: SupportedLanguage;
  model: BillingPageModel;
}) {
  return (
    <AdminPanel
      title={adminInlineText(lang, 'Access and credit ledger')}
      description={adminInlineText(
        lang,
        'Filtered customer-facing records stay in one ledger section instead of spreading across separate page bands.'
      )}
      contentClassName="grid gap-4"
    >
      <EvidenceSection
        title={adminInlineText(lang, 'Feature matrix')}
        description={adminInlineText(lang, 'Plan capability coverage for product packaging.')}
      >
        <DataTable
          className="shadow-none"
          columns={adminInlineColumns(lang, [
            'Capability',
            ...model.commercial.catalog.plans.map((plan) => plan.id),
          ])}
          rows={model.commercial.featureMatrix.map((row) => [
            row.capability,
            ...model.commercial.catalog.plans.map((plan) => {
              const value = row.plans[plan.id];
              return typeof value === 'boolean'
                ? value
                  ? adminInlineText(lang, 'yes')
                  : '-'
                : String(value ?? '-');
            }),
          ])}
          density="compact"
        />
      </EvidenceSection>
      <BillingCustomerLedgerEvidence lang={lang} model={model} />
      <BillingOperationalLedgerEvidence lang={lang} model={model} />
    </AdminPanel>
  );
}
