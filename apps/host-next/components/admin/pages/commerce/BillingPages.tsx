import { BadgeDollarSign, CreditCard, PackageCheck, ReceiptText } from 'lucide-react';
import { adminNav, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { ActionQueue, PageSynopsis, StatGrid } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminBillingCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { AdminCommercialView } from '@host/lib/admin-commercial';
import { buildBillingPageModel } from './BillingPageModel';
import { BillingBusinessLanes } from './BillingBusinessLanes';
import { BillingCatalogAuthoring } from './BillingCatalogAuthoring';
import { BillingCatalogWorkspace } from './BillingCatalogWorkspace';
import { BillingLedgerEvidence } from './BillingLedgerEvidence';
import { BillingOrderDetailDrawer } from './BillingOrderDetailDrawer';
import { BillingSettlementEvidence } from './BillingSettlementEvidence';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function AdminBillingOperationsPage({
  lang,
  commercial,
  upsertPlanAction,
  archivePlanAction,
  upsertSkuAction,
  archiveSkuAction,
  syncSkuAction,
  query,
}: {
  lang: SupportedLanguage;
  commercial: AdminCommercialView;
  upsertPlanAction?: AdminFormAction;
  archivePlanAction?: AdminFormAction;
  upsertSkuAction?: AdminFormAction;
  archiveSkuAction?: AdminFormAction;
  syncSkuAction?: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminBillingCopy(lang);
  const billingModel = buildBillingPageModel(lang, commercial, query);
  const {
    failedOrders,
    inactiveEntitlements,
    activeSubscriptions,
    openInvoices,
    savedPaymentMethods,
    taxProfiles,
    commerceReviewItems,
  } = billingModel;

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Orders')}
          value={String(commercial.orders.length)}
          helper={adminInlineText(lang, 'value_need_review_fee2a156', {
            value1: failedOrders.length,
          })}
          tone="blue"
          icon={ReceiptText}
        />
        <StatCard
          label={adminInlineText(lang, 'Entitlements')}
          value={String(commercial.entitlements.length)}
          helper={adminInlineText(lang, 'value_inactive_c9d6730a', {
            value1: inactiveEntitlements.length,
          })}
          icon={BadgeDollarSign}
        />
        <StatCard
          label={adminInlineText(lang, 'Credits')}
          value={String(commercial.credits.length)}
          helper={adminInlineText(lang, 'Ledger entries')}
          tone="amber"
          icon={CreditCard}
        />
        <StatCard
          label={adminInlineText(lang, 'Plans')}
          value={String(commercial.catalog.plans.length)}
          helper={`${commercial.catalog.skus.length} SKUs`}
          icon={PackageCheck}
        />
      </StatGrid>
      <PageSynopsis
        lang={lang}
        title={adminInlineText(lang, 'Billing operating model')}
        description={adminInlineText(
          lang,
          'The page keeps billing exceptions and access review before catalog editing; catalog objects remain available as a secondary workspace.'
        )}
        status={failedOrders.length > 0 || inactiveEntitlements.length > 0 ? 'review' : 'healthy'}
        statusTone={
          failedOrders.length > 0
            ? 'danger'
            : inactiveEntitlements.length > 0
              ? 'warning'
              : 'success'
        }
        items={[
          {
            key: 'settlement',
            label: adminInlineText(lang, 'Settlement'),
            value: adminInlineText(lang, 'value_open_d19c38f3', { value1: openInvoices.length }),
            detail: adminInlineText(lang, 'value_failed_orders_9ca0c0f7', {
              value1: failedOrders.length,
            }),
            tone: openInvoices.length > 0 || failedOrders.length > 0 ? 'warning' : 'success',
          },
          {
            key: 'access',
            label: adminInlineText(lang, 'Access'),
            value: adminInlineText(lang, 'value_active_c668ccbe', { value1: activeSubscriptions }),
            detail: adminInlineText(lang, 'value_inactive_grants_a556f8e3', {
              value1: inactiveEntitlements.length,
            }),
            tone: inactiveEntitlements.length > 0 ? 'warning' : 'success',
          },
          {
            key: 'catalog',
            label: adminInlineText(lang, 'Catalog'),
            value: adminInlineText(lang, 'value_plans_a759f4a7', {
              value1: commercial.catalog.plans.length,
            }),
            detail: `${commercial.catalog.skus.length} SKUs`,
            tone: 'primary',
          },
          {
            key: 'profiles',
            label: adminInlineText(lang, 'Profiles'),
            value: `${savedPaymentMethods + taxProfiles}`,
            detail: adminInlineText(lang, 'Payment and tax records'),
            tone: 'info',
          },
        ]}
      />
      {commerceReviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'Billing review')}
          description={adminInlineText(
            lang,
            'Payment and access states that need human review are promoted before commercial ledgers.'
          )}
          status="warning"
          items={commerceReviewItems}
        />
      ) : null}
      <BillingOrderDetailDrawer lang={lang} model={billingModel} />
      <BillingBusinessLanes lang={lang} model={billingModel} />
      <BillingCatalogAuthoring
        lang={lang}
        upsertPlanAction={upsertPlanAction}
        upsertSkuAction={upsertSkuAction}
      />
      <BillingCatalogWorkspace
        lang={lang}
        model={billingModel}
        archivePlanAction={archivePlanAction}
        archiveSkuAction={archiveSkuAction}
        syncSkuAction={syncSkuAction}
      />
      <BillingLedgerEvidence lang={lang} model={billingModel} />
      <BillingSettlementEvidence lang={lang} commercial={commercial} />
    </WorkspaceShell>
  );
}
