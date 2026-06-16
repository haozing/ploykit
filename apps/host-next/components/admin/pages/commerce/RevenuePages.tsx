import { BadgeDollarSign, CreditCard, PackageCheck, ReceiptText } from 'lucide-react';
import { adminNav, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { ActionQueue, StatGrid } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminEntitlementsCopy, getAdminRevenueCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type {
  RuntimeStoreAuditRecord,
  RuntimeStoreCommercialOrder,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreEntitlementStatus,
} from '@/lib/module-runtime';
import type { HostBillingOverview } from '@host/lib/billing-api';
import type { AdminCommercialView } from '@host/lib/admin-commercial';
import {
  cleanRevenueTableQuery,
  metadataOrderId,
  orderBenefitSummary,
  type AdminPagedResult,
} from './RevenuePageModel';
import {
  RevenueEntitlementWorkspace,
  type RevenueEntitlementGrantContext,
} from './RevenueEntitlementWorkspace';
import { RevenueOverviewPanels } from './RevenueOverviewPanels';
import { RevenueOrderEvidence } from './RevenueOrderEvidence';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function AdminRevenueOperationsPage({
  lang,
  revenue,
  commercial,
  reconcileBillingAction,
  query,
}: {
  lang: SupportedLanguage;
  revenue: AdminPagedResult<RuntimeStoreCommercialOrder> & {
    totals: Record<string, number>;
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
  commercial?: AdminCommercialView;
  reconcileBillingAction?: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminRevenueCopy(lang);
  const tableQuery = cleanRevenueTableQuery(query);
  const paidOrders = revenue.items.filter((order) => order.status === 'paid');
  const refundedOrders = revenue.items.filter((order) => order.status === 'refunded');
  const failedOrders = revenue.items.filter((order) => order.status === 'failed');
  const benefitSummaryByOrder = commercial
    ? new Map(commercial.orders.map((order) => [order.id, orderBenefitSummary(order, commercial)]))
    : new Map<string, ReturnType<typeof orderBenefitSummary>>();
  const missingBenefitOrders = commercial
    ? commercial.orders.filter((order) => {
        const summary = benefitSummaryByOrder.get(order.id);
        return (
          order.status === 'paid' &&
          Boolean(summary) &&
          (summary!.missingCredits > 0 || summary!.missingEntitlements.length > 0)
        );
      })
    : [];
  const focusOrder =
    missingBenefitOrders[0] ?? failedOrders[0] ?? refundedOrders[0] ?? revenue.items[0] ?? null;
  const revenueReviewItems = [
    failedOrders.length > 0
      ? {
          key: 'failed-orders',
          title: adminInlineText(lang, 'Failed orders'),
          description:
            lang === 'zh'
              ? `${failedOrders.length} 个订单失败。重试结账或变更访问权限前，请先检查供应商事件证据。`
              : `${failedOrders.length} orders failed. Check provider event evidence before retrying checkout or changing access.`,
          actionLabel: adminInlineText(lang, 'Review orders'),
          href: localizedPath(lang, '/admin/revenue?status=failed'),
          status: 'failed',
          tone: 'danger' as const,
        }
      : null,
    refundedOrders.length > 0
      ? {
          key: 'refunded-orders',
          title: adminInlineText(lang, 'Refunded orders'),
          description:
            lang === 'zh'
              ? `${refundedOrders.length} 个订单已退款。请确认贷项记录和权益撤销证据。`
              : `${refundedOrders.length} orders were refunded. Confirm credit notes and entitlement revocation evidence.`,
          actionLabel: adminInlineText(lang, 'Review refunds'),
          href: localizedPath(lang, '/admin/revenue?status=refunded'),
          status: 'refunded',
          tone: 'warning' as const,
        }
      : null,
    missingBenefitOrders.length > 0
      ? {
          key: 'missing-benefits',
          title: adminInlineText(lang, 'Missing benefits'),
          description:
            lang === 'zh'
              ? `${missingBenefitOrders.length} 个已支付订单缺少点数或权益。`
              : `${missingBenefitOrders.length} paid orders are missing credits or entitlements.`,
          actionLabel: adminInlineText(lang, 'Reconcile'),
          href: localizedPath(lang, '/admin/revenue'),
          status: 'failed',
          tone: 'danger' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <RevenueOverviewPanels
        lang={lang}
        totals={revenue.totals}
        totalOrders={revenue.page.total}
        failedOrders={failedOrders}
        missingBenefitOrders={missingBenefitOrders}
        reviewItems={revenueReviewItems}
        reconcileBillingAction={reconcileBillingAction}
      />
      <RevenueOrderEvidence
        lang={lang}
        revenue={revenue}
        tableQuery={tableQuery}
        paidOrders={paidOrders}
        refundedOrders={refundedOrders}
        failedOrders={failedOrders}
        focusOrder={focusOrder}
        benefitSummaryByOrder={benefitSummaryByOrder}
      />
    </WorkspaceShell>
  );
}

export function AdminEntitlementsOperationsPage({
  lang,
  entitlements,
  commercial,
  grantEntitlementAction,
  overrideEntitlementAction,
  revokeEntitlementAction,
  query,
}: {
  lang: SupportedLanguage;
  entitlements: AdminPagedResult<RuntimeStoreEntitlementGrant> & {
    statusCounts: Record<RuntimeStoreEntitlementStatus, number>;
  };
  commercial?: AdminCommercialView;
  grantEntitlementAction?: AdminFormAction;
  overrideEntitlementAction?: AdminFormAction;
  revokeEntitlementAction?: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminEntitlementsCopy(lang);
  const tableQuery = cleanRevenueTableQuery(query);
  const statusCounts = entitlements.statusCounts;
  const activeGrants = statusCounts.active;
  const revokedGrants = statusCounts.revoked;
  const expiredGrants = statusCounts.expired;
  const grantContextById = commercial
    ? new Map(
        entitlements.items.map((grant) => {
          const grantOrderId = metadataOrderId(grant);
          const grantSku = commercial.catalog.skus.find(
            (sku) => sku.planId === grant.planId && sku.entitlements.includes(grant.entitlement)
          );
          const grantOrder = grantOrderId
            ? commercial.orders.find((order) => order.id === grantOrderId)
            : commercial.orders.find(
                (order) => order.userId === grant.userId && order.sku === grantSku?.id
              );
          const grantSubscription = grant.planId
            ? commercial.subscriptions.find(
                (subscription) =>
                  subscription.userId === grant.userId && subscription.planId === grant.planId
              )
            : undefined;
          return [
            grant.id,
            {
              grantOrder,
              grantSubscription,
              grantOrderId,
            },
          ] as const;
        })
      )
    : new Map<string, RevenueEntitlementGrantContext>();
  const mismatchGrants = commercial
    ? entitlements.items.filter((grant) => {
        const context = grantContextById.get(grant.id);
        if (!context) {
          return false;
        }
        if (
          grant.source === 'order' &&
          (!context.grantOrder || context.grantOrder.status !== 'paid')
        ) {
          return true;
        }
        if (grant.source !== 'order' && grant.planId && !context.grantSubscription) {
          return true;
        }
        return false;
      })
    : [];
  const focusGrant =
    mismatchGrants[0] ??
    entitlements.items.find((grant) => grant.status !== 'active') ??
    entitlements.items[0] ??
    null;
  const focusGrantContext = focusGrant ? grantContextById.get(focusGrant.id) : undefined;
  const totalPages = Math.max(1, Math.ceil(entitlements.page.total / entitlements.page.limit));
  const currentPage = Math.min(
    Math.max(Math.floor(entitlements.page.offset / entitlements.page.limit) + 1, 1),
    totalPages
  );
  const entitlementReviewItems = [
    revokedGrants > 0
      ? {
          key: 'revoked-grants',
          title: adminInlineText(lang, 'Revoked entitlements'),
          description: adminInlineText(
            lang,
            'value_grants_are_revoked_verify_whether_matching_sub_8bd63058',
            { value1: revokedGrants }
          ),
          actionLabel: adminInlineText(lang, 'Filter revoked'),
          href: localizedPath(lang, '/admin/entitlements?status=revoked'),
          status: 'revoked',
          tone: 'warning' as const,
        }
      : null,
    expiredGrants > 0
      ? {
          key: 'expired-grants',
          title: adminInlineText(lang, 'Expired entitlements'),
          description: adminInlineText(
            lang,
            'value_grants_have_expired_confirm_renewal_grace_peri_c5e9044c',
            { value1: expiredGrants }
          ),
          actionLabel: adminInlineText(lang, 'Filter expired'),
          href: localizedPath(lang, '/admin/entitlements?status=expired'),
          status: 'expired',
          tone: 'warning' as const,
        }
      : null,
    mismatchGrants.length > 0
      ? {
          key: 'mismatch-grants',
          title: adminInlineText(lang, 'Entitlement mismatch'),
          description: `${mismatchGrants.length} grants have incomplete order or subscription evidence and should be reviewed before granting access.`,
          actionLabel: adminInlineText(lang, 'Review mismatch'),
          href: localizedPath(lang, '/admin/entitlements'),
          status: 'warning',
          tone: 'warning' as const,
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <StatGrid>
        <StatCard
          label={adminInlineText(lang, 'Grants')}
          value={String(entitlements.page.total)}
          helper={adminInlineText(lang, 'value_loaded_0827bcbc', {
            value1: entitlements.items.length,
          })}
          icon={BadgeDollarSign}
        />
        <StatCard
          label={adminInlineText(lang, 'Active')}
          value={String(activeGrants)}
          helper={adminInlineText(lang, 'Currently effective')}
          tone="green"
          icon={PackageCheck}
        />
        <StatCard
          label={adminInlineText(lang, 'Revoked')}
          value={String(revokedGrants)}
          helper={adminInlineText(lang, 'Manual or billing removal')}
          tone={revokedGrants > 0 ? 'amber' : 'neutral'}
          icon={CreditCard}
        />
        <StatCard
          label={adminInlineText(lang, 'Expired')}
          value={String(expiredGrants)}
          helper={adminInlineText(lang, 'Grace or renewal review')}
          tone={expiredGrants > 0 ? 'amber' : 'neutral'}
          icon={ReceiptText}
        />
      </StatGrid>
      {entitlementReviewItems.length > 0 ? (
        <ActionQueue
          lang={lang}
          title={adminInlineText(lang, 'Access review')}
          description={adminInlineText(
            lang,
            'Revoked and expired grants are promoted before the full entitlement ledger.'
          )}
          status="warning"
          items={entitlementReviewItems}
        />
      ) : null}
      <RevenueEntitlementWorkspace
        lang={lang}
        entitlements={entitlements}
        tableQuery={tableQuery}
        grantContextById={grantContextById}
        focusGrant={focusGrant}
        focusGrantContext={focusGrantContext}
        totalPages={totalPages}
        currentPage={currentPage}
        grantEntitlementAction={grantEntitlementAction}
        overrideEntitlementAction={overrideEntitlementAction}
        revokeEntitlementAction={revokeEntitlementAction}
      />
    </WorkspaceShell>
  );
}
