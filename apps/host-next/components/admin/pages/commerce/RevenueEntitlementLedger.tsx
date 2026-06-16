import Link from 'next/link';
import { BadgeDollarSign } from 'lucide-react';
import { ConfirmSubmitButton, DataTable, Input, Pagination, Select } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import {
  AdminPanel,
  EntityListItem,
  FilterBar,
} from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { RuntimeStoreEntitlementGrant } from '@/lib/module-runtime';
import { adminListHref, type AdminPagedResult } from './RevenuePageModel';
import type { RevenueEntitlementGrantContext } from './RevenueEntitlementWorkspace';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function RevenueEntitlementLedger({
  lang,
  entitlements,
  tableQuery,
  grantContextById,
  totalPages,
  currentPage,
  overrideEntitlementAction,
  revokeEntitlementAction,
}: {
  lang: SupportedLanguage;
  entitlements: AdminPagedResult<RuntimeStoreEntitlementGrant>;
  tableQuery: Required<AdminTableQuery>;
  grantContextById: Map<string, RevenueEntitlementGrantContext>;
  totalPages: number;
  currentPage: number;
  overrideEntitlementAction?: AdminFormAction;
  revokeEntitlementAction?: AdminFormAction;
}) {
  return (
    <>
      <AdminPanel
        title={adminInlineText(lang, 'Entitlement ledger')}
        description={adminInlineText(
          lang,
          'Filter grants by user, entitlement, plan, source, or status.'
        )}
        contentClassName="p-0"
      >
        <FilterBar
          lang={lang}
          embedded
          searchValue={tableQuery.q}
          searchPlaceholder="搜索用户、权益、套餐或状态"
          filterValue={tableQuery.status}
          filterOptions={[
            { value: 'active', label: 'Active' },
            { value: 'revoked', label: 'Revoked' },
            { value: 'expired', label: 'Expired' },
          ]}
          resetHref={localizedPath(lang, '/admin/entitlements')}
        />
        <RevenueEntitlementDesktopTable
          lang={lang}
          grants={entitlements.items}
          grantContextById={grantContextById}
          overrideEntitlementAction={overrideEntitlementAction}
          revokeEntitlementAction={revokeEntitlementAction}
        />
        <RevenueEntitlementMobileList
          lang={lang}
          grants={entitlements.items}
          grantContextById={grantContextById}
        />
      </AdminPanel>
      {totalPages > 1 ? (
        <Pagination
          page={currentPage}
          totalPages={totalPages}
          previousHref={
            currentPage > 1
              ? adminListHref(
                  lang,
                  '/admin/entitlements',
                  { ...tableQuery, pageSize: entitlements.page.limit },
                  currentPage - 1
                )
              : undefined
          }
          nextHref={
            currentPage < totalPages
              ? adminListHref(
                  lang,
                  '/admin/entitlements',
                  { ...tableQuery, pageSize: entitlements.page.limit },
                  currentPage + 1
                )
              : undefined
          }
        />
      ) : null}
    </>
  );
}

function RevenueEntitlementDesktopTable({
  lang,
  grants,
  grantContextById,
  overrideEntitlementAction,
  revokeEntitlementAction,
}: {
  lang: SupportedLanguage;
  grants: readonly RuntimeStoreEntitlementGrant[];
  grantContextById: Map<string, RevenueEntitlementGrantContext>;
  overrideEntitlementAction?: AdminFormAction;
  revokeEntitlementAction?: AdminFormAction;
}) {
  return (
    <DataTable
      className="hidden xl:block rounded-none border-x-0 border-b-0 shadow-none"
      columns={adminInlineColumns(lang, [
        'Entitlement',
        'User',
        'Plan / Context',
        'Expires',
        'Source',
        'Status',
        'Override',
        'Action',
      ])}
      rows={grants.map((grant) => {
        const context = grantContextById.get(grant.id);
        return [
          grant.entitlement,
          <Link
            key={`${grant.id}:user`}
            href={localizedPath(lang, `/admin/users?q=${encodeURIComponent(grant.userId)}`)}
            className="font-medium text-admin-primary hover:underline"
          >
            {grant.userId}
          </Link>,
          <span key={`${grant.id}:context`} className="block text-xs leading-5 text-admin-text-muted">
            {grant.planId ?? 'none'}
            {context?.grantOrder?.id
              ? ` · order ${context.grantOrder.id}`
              : context?.grantOrderId
                ? ` · order ${context.grantOrderId}`
                : ''}
            {context?.grantSubscription
              ? ` · sub ${context.grantSubscription.planId} ${context.grantSubscription.status}`
              : ''}
          </span>,
          grant.expiresAt ?? 'none',
          <span key={`${grant.id}:source`} className="block text-xs leading-5 text-admin-text-muted">
            {grant.source}
            {grant.source === 'order' && context?.grantOrder?.status
              ? ` · ${context.grantOrder.status}`
              : ''}
          </span>,
          <StatusBadge key={`${grant.id}:status`} lang={lang} value={grant.status} />,
          <RevenueEntitlementOverrideAction
            key={`override-${grant.id}`}
            lang={lang}
            grant={grant}
            overrideEntitlementAction={overrideEntitlementAction}
          />,
          <RevenueEntitlementRevokeAction
            key={`revoke-${grant.id}`}
            lang={lang}
            grant={grant}
            revokeEntitlementAction={revokeEntitlementAction}
          />,
        ];
      })}
    />
  );
}

function RevenueEntitlementOverrideAction({
  lang,
  grant,
  overrideEntitlementAction,
}: {
  lang: SupportedLanguage;
  grant: RuntimeStoreEntitlementGrant;
  overrideEntitlementAction?: AdminFormAction;
}) {
  if (!overrideEntitlementAction) {
    return adminInlineText(lang, 'none');
  }

  return (
    <form action={overrideEntitlementAction} className="inline-flex flex-wrap items-center gap-2">
      <input type="hidden" name="entitlementId" value={grant.id} />
      <Select
        name="status"
        aria-label={adminInlineText(lang, 'override_value_status_0da851a6', {
          value1: grant.entitlement,
        })}
        defaultValue={grant.status}
      >
        <option value="active">{adminInlineText(lang, 'Active')}</option>
        <option value="expired">{adminInlineText(lang, 'Expired')}</option>
        <option value="revoked">{adminInlineText(lang, 'Revoked')}</option>
      </Select>
      <Input
        name="reason"
        placeholder={adminInlineText(lang, 'reason')}
        aria-label={adminInlineText(lang, 'override_value_reason_bed3b42a', {
          value1: grant.entitlement,
        })}
      />
      <ConfirmSubmitButton
        type="submit"
        className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
        confirmation={adminInlineText(lang, 'override_value_s_value_status_a76f8235', {
          value1: grant.userId,
          value2: grant.entitlement,
        })}
      >
        {adminInlineText(lang, 'Override')}
      </ConfirmSubmitButton>
    </form>
  );
}

function RevenueEntitlementRevokeAction({
  lang,
  grant,
  revokeEntitlementAction,
}: {
  lang: SupportedLanguage;
  grant: RuntimeStoreEntitlementGrant;
  revokeEntitlementAction?: AdminFormAction;
}) {
  if (!revokeEntitlementAction || grant.status !== 'active') {
    return adminInlineText(lang, 'none');
  }

  return (
    <form action={revokeEntitlementAction} className="inline-flex">
      <input type="hidden" name="entitlementId" value={grant.id} />
      <ConfirmSubmitButton
        type="submit"
        className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
        confirmation={adminInlineText(lang, 'revoke_value_s_value_3da7b9d1', {
          value1: grant.userId,
          value2: grant.entitlement,
        })}
      >
        {adminInlineText(lang, 'Revoke')}
      </ConfirmSubmitButton>
    </form>
  );
}

function RevenueEntitlementMobileList({
  lang,
  grants,
  grantContextById,
}: {
  lang: SupportedLanguage;
  grants: readonly RuntimeStoreEntitlementGrant[];
  grantContextById: Map<string, RevenueEntitlementGrantContext>;
}) {
  return (
    <div className="grid gap-1 xl:hidden">
      {grants.map((grant) => {
        const context = grantContextById.get(grant.id);
        return (
          <EntityListItem
            key={grant.id}
            href={localizedPath(lang, `/admin/entitlements?q=${encodeURIComponent(grant.userId)}`)}
            title={grant.entitlement}
            subtitle={grant.userId}
            status={grant.status}
            detail={[
              grant.planId ?? 'none',
              context?.grantOrder?.id
                ? `order ${context.grantOrder.id}`
                : context?.grantOrderId
                  ? `order ${context.grantOrderId}`
                  : null,
              context?.grantSubscription
                ? `sub ${context.grantSubscription.planId} ${context.grantSubscription.status}`
                : null,
              grant.source,
            ]
              .filter(Boolean)
              .join(' · ')}
            meta={grant.id}
            icon={BadgeDollarSign}
            density="compact"
            tone={grant.status === 'active' ? 'primary' : 'warning'}
          />
        );
      })}
    </div>
  );
}
