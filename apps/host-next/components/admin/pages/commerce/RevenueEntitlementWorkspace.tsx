import Link from 'next/link';
import { FormField } from '@host/components/ProductShell';
import { ConfirmSubmitButton, DetailDrawer, Input } from '@host/components/ui';
import {
  ActionPanel,
  FactList,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type {
  RuntimeStoreCommercialOrder,
  RuntimeStoreEntitlementGrant,
} from '@/lib/module-runtime';
import { type AdminPagedResult } from './RevenuePageModel';
import { RevenueEntitlementLedger } from './RevenueEntitlementLedger';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export interface RevenueEntitlementGrantContext {
  grantOrder?: RuntimeStoreCommercialOrder;
  grantSubscription?: { id: string; userId: string; planId: string; status: string };
  grantOrderId?: string;
}

export function RevenueEntitlementWorkspace({
  lang,
  entitlements,
  tableQuery,
  grantContextById,
  focusGrant,
  focusGrantContext,
  totalPages,
  currentPage,
  grantEntitlementAction,
  overrideEntitlementAction,
  revokeEntitlementAction,
}: {
  lang: SupportedLanguage;
  entitlements: AdminPagedResult<RuntimeStoreEntitlementGrant>;
  tableQuery: Required<AdminTableQuery>;
  grantContextById: Map<string, RevenueEntitlementGrantContext>;
  focusGrant: RuntimeStoreEntitlementGrant | null;
  focusGrantContext?: RevenueEntitlementGrantContext;
  totalPages: number;
  currentPage: number;
  grantEntitlementAction?: AdminFormAction;
  overrideEntitlementAction?: AdminFormAction;
  revokeEntitlementAction?: AdminFormAction;
}) {
  return (
    <>
      {grantEntitlementAction ? (
        <ActionPanel
          title={adminInlineText(lang, 'Manual grant')}
          description={adminInlineText(
            lang,
            'Manual access changes require explicit user, entitlement, plan, and confirmation; no demo defaults are prefilled.'
          )}
          tone="warning"
        >
          <form
            action={grantEntitlementAction}
            className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end"
          >
            <FormField label={adminInlineText(lang, 'User ID')} htmlFor="grant-user-id">
              <Input
                id="grant-user-id"
                name="userId"
                placeholder={adminInlineText(lang, 'user id')}
                required
              />
            </FormField>
            <FormField label={adminInlineText(lang, 'Entitlement')} htmlFor="grant-entitlement">
              <Input
                id="grant-entitlement"
                name="entitlement"
                placeholder={adminInlineText(lang, 'public-tools.pro')}
                required
              />
            </FormField>
            <FormField label={adminInlineText(lang, 'Plan')} htmlFor="grant-plan">
              <Input id="grant-plan" name="planId" placeholder={adminInlineText(lang, 'plan id')} />
            </FormField>
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              confirmation={adminInlineText(lang, '确认手动授予该 entitlement？')}
            >
              {adminInlineText(lang, 'Grant')}
            </ConfirmSubmitButton>
          </form>
        </ActionPanel>
      ) : null}
      {focusGrant ? (
        <DetailDrawer
          open
          title={adminInlineText(lang, 'Entitlement detail')}
          description={`${focusGrant.entitlement} · ${focusGrant.userId}`}
          className="mb-5"
          actions={[
            <Link
              key="user"
              href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(focusGrant.userId)}`)}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'User')}
            </Link>,
            <Link
              key="revenue"
              href={localizedPath(
                lang,
                `/admin/revenue?q=${encodeURIComponent(focusGrant.userId)}`
              )}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Revenue')}
            </Link>,
            <Link
              key="audit"
              href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(focusGrant.id)}`)}
              className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            >
              {adminInlineText(lang, 'Audit')}
            </Link>,
          ]}
        >
          <FactList
            lang={lang}
            density="compact"
            items={[
              {
                label: 'Entitlement',
                value: focusGrant.entitlement,
                copyValue: focusGrant.entitlement,
              },
              { label: 'User', value: focusGrant.userId, copyValue: focusGrant.userId, mono: true },
              { label: 'Plan', value: focusGrant.planId ?? 'none' },
              { label: 'Source', value: focusGrant.source },
              {
                label: 'Order',
                value:
                  focusGrantContext?.grantOrder?.id ?? focusGrantContext?.grantOrderId ?? 'none',
                mono: true,
              },
              {
                label: 'Subscription',
                value: focusGrantContext?.grantSubscription
                  ? `${focusGrantContext.grantSubscription.planId} · ${focusGrantContext.grantSubscription.status}`
                  : 'none',
              },
              { label: 'Expires', value: focusGrant.expiresAt ?? 'none' },
              { label: 'Status', value: focusGrant.status },
            ]}
          />
        </DetailDrawer>
      ) : null}
      <RevenueEntitlementLedger
        lang={lang}
        entitlements={entitlements}
        tableQuery={tableQuery}
        grantContextById={grantContextById}
        totalPages={totalPages}
        currentPage={currentPage}
        overrideEntitlementAction={overrideEntitlementAction}
        revokeEntitlementAction={revokeEntitlementAction}
      />
    </>
  );
}
