import {
  AdminPanel,
  HealthRowList,
} from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { BillingPageModel } from './BillingPageModel';

export function BillingBusinessLanes({
  lang,
  model,
}: {
  lang: SupportedLanguage;
  model: BillingPageModel;
}) {
  const {
    commercial,
    failedOrders,
    inactiveEntitlements,
    activeSubscriptions,
    openInvoices,
    savedPaymentMethods,
    taxProfiles,
  } = model;

  return (
    <AdminPanel
      title={adminInlineText(lang, 'Business lanes')}
      description={adminInlineText(
        lang,
        'Billing should read as product packaging, customer access, settlement, and compliance lanes before raw ledger rows.'
      )}
    >
      <HealthRowList
        lang={lang}
        items={[
          {
            key: 'catalog',
            title: 'Product packaging',
            detail: adminInlineText(
              lang,
              '{plans} plans and {skus} SKUs define sellable offers.',
              {
                plans: commercial.catalog.plans.length,
                skus: commercial.catalog.skus.length,
              }
            ),
            meta: adminInlineText(lang, '{count} SKUs', {
              count: commercial.catalog.skus.length,
            }),
            status: commercial.catalog.skus.length > 0 ? 'ready' : 'empty',
            statusTone: commercial.catalog.skus.length > 0 ? 'success' : 'warning',
            tone: commercial.catalog.skus.length > 0 ? 'success' : 'warning',
          },
          {
            key: 'access',
            title: 'Customer access',
            detail: adminInlineText(
              lang,
              '{active} active subscriptions and {inactive} inactive grants.',
              {
                active: activeSubscriptions,
                inactive: inactiveEntitlements.length,
              }
            ),
            meta: adminInlineText(lang, '{count} grants', {
              count: commercial.entitlements.length,
            }),
            status: inactiveEntitlements.length > 0 ? 'review' : 'clear',
            statusTone: inactiveEntitlements.length > 0 ? 'warning' : 'success',
            tone: inactiveEntitlements.length > 0 ? 'warning' : 'success',
            href:
              inactiveEntitlements.length > 0
                ? localizedPath(lang, '/admin/billing?type=entitlements')
                : undefined,
          },
          {
            key: 'settlement',
            title: 'Settlement',
            detail: adminInlineText(
              lang,
              '{count} invoices are not settled; failed orders must be checked against provider evidence.',
              { count: openInvoices.length }
            ),
            meta: adminInlineText(lang, '{count} invoices', {
              count: commercial.invoices.length,
            }),
            status: openInvoices.length > 0 || failedOrders.length > 0 ? 'review' : 'clear',
            statusTone: openInvoices.length > 0 || failedOrders.length > 0 ? 'warning' : 'success',
            tone: openInvoices.length > 0 || failedOrders.length > 0 ? 'warning' : 'success',
          },
          {
            key: 'profiles',
            title: 'Payment and tax profiles',
            detail: adminInlineText(
              lang,
              '{paymentMethods} saved payment methods and {taxProfiles} tax profiles are available.',
              {
                paymentMethods: savedPaymentMethods,
                taxProfiles,
              }
            ),
            meta: adminInlineText(lang, '{count} tax profiles', { count: taxProfiles }),
            status: taxProfiles > 0 || savedPaymentMethods > 0 ? 'ready' : 'empty',
            statusTone: taxProfiles > 0 || savedPaymentMethods > 0 ? 'info' : 'neutral',
            tone: taxProfiles > 0 || savedPaymentMethods > 0 ? 'info' : 'neutral',
          },
        ]}
      />
    </AdminPanel>
  );
}
