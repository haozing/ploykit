import Link from 'next/link';
import { DataTable } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import { EntityListItem } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatRelativeTime } from '@host/lib/i18n-format';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminUsersCopy } from '@host/lib/admin-copy';
import type { RuntimeStoreHostUser } from '@/lib/module-runtime';
import {
  userAuthSummary,
  userVerificationState,
} from './IdentityPageModel';

export function UsersDirectoryRecords({
  lang,
  pageUsers,
}: {
  lang: SupportedLanguage;
  pageUsers: readonly RuntimeStoreHostUser[];
}) {
  const copy = getAdminUsersCopy(lang);

  return (
    <>
      <div className="hidden lg:block">
        <DataTable
          className="rounded-none border-x-0 border-b-0 shadow-none"
          columns={adminInlineColumns(lang, [
            'User',
            'Access',
            'Status',
            'Verification',
            'Activity',
            'Created / Updated',
            'Action',
          ])}
          rows={pageUsers.map((user) => {
            const summary = userAuthSummary(user);
            return [
              <div key={`${user.id}:user`} className="min-w-0">
                <Link
                  href={localizedPath(lang, `/admin/users/${user.id}`)}
                  className="block truncate font-semibold text-admin-primary hover:underline"
                >
                  {user.email ?? user.id}
                </Link>
                <div className="mt-1 truncate text-xs text-admin-text-muted">{user.id}</div>
              </div>,
              <div key={`${user.id}:access`}>
                <span className="font-medium text-admin-text">
                  {adminInlineText(lang, user.role)}
                </span>
                <div className="mt-1 text-xs text-admin-text-muted">
                  {adminInlineText(lang, user.workspaceRole)}
                </div>
              </div>,
              <StatusBadge key={`${user.id}:status`} lang={lang} value={user.status} />,
              <div key={`${user.id}:verification`} className="grid gap-1">
                <span className="text-sm text-admin-text">{userVerificationState(lang, user)}</span>
                <span className="text-xs text-admin-text-muted">
                  {summary.emailVerifiedAt
                    ? `${adminInlineText(lang, 'verified_95165cf5')} ${formatRelativeTime(summary.emailVerifiedAt, lang)}`
                    : summary.verificationMailAt
                      ? `${adminInlineText(lang, 'mail_9e08b3fd')} ${formatRelativeTime(summary.verificationMailAt, lang)}`
                      : adminInlineText(lang, 'no_mail_record_8b6c8250')}
                </span>
              </div>,
              <div key={`${user.id}:activity`} className="grid gap-1">
                <span className="text-sm text-admin-text">
                  {summary.lastSessionAt
                    ? `${adminInlineText(lang, 'last_session_b422e3c7')} ${formatRelativeTime(summary.lastSessionAt, lang)}`
                    : adminInlineText(lang, 'no_sessions_b30fd382')}
                </span>
                <span className="text-xs text-admin-text-muted">
                  {adminInlineText(lang, 'value_sessions_40272bb0', {
                    value1: summary.sessionCount,
                  })}
                </span>
              </div>,
              <div key={`${user.id}:timestamps`} className="grid gap-1">
                <span className="text-sm text-admin-text">
                  {formatRelativeTime(user.createdAt, lang)}
                </span>
                <span className="text-xs text-admin-text-muted">
                  {adminInlineText(lang, 'updated_value_ac1856f8', {
                    value1: formatRelativeTime(user.updatedAt, lang),
                  })}
                </span>
              </div>,
              <div key={`${user.id}:action`} className="flex flex-wrap gap-2">
                <Link
                  href={localizedPath(lang, `/admin/users/${user.id}`)}
                  className="text-xs font-semibold text-admin-primary hover:underline"
                >
                  {copy.openDetail}
                </Link>
                <Link
                  href={localizedPath(lang, `/admin/billing?q=${encodeURIComponent(user.id)}`)}
                  className="text-xs font-semibold text-admin-primary hover:underline"
                >
                  {adminInlineText(lang, 'orders_ca187bf2')}
                </Link>
                <Link
                  href={localizedPath(lang, `/admin/entitlements?q=${encodeURIComponent(user.id)}`)}
                  className="text-xs font-semibold text-admin-primary hover:underline"
                >
                  {adminInlineText(lang, 'entitlements_2ca17dc5')}
                </Link>
                <Link
                  href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(user.id)}`)}
                  className="text-xs font-semibold text-admin-primary hover:underline"
                >
                  {adminInlineText(lang, 'audit_de9bcda7')}
                </Link>
              </div>,
            ];
          })}
          empty={copy.empty}
          minWidthClass="min-w-[1240px]"
        />
      </div>
      <div className="grid gap-2 px-2 py-2 lg:hidden">
        {pageUsers.length > 0 ? (
          pageUsers.map((user) => {
            const summary = userAuthSummary(user);
            return (
              <div
                key={user.id}
                className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/40 p-2"
              >
                <EntityListItem
                  lang={lang}
                  href={localizedPath(lang, `/admin/users/${user.id}`)}
                  title={user.email ?? user.id}
                  subtitle={`${adminInlineText(lang, user.role)} · ${adminInlineText(lang, user.workspaceRole)}`}
                  status={user.status}
                  detail={[
                    userVerificationState(lang, user),
                    summary.lastSessionAt ? formatRelativeTime(summary.lastSessionAt, lang) : null,
                    `${formatRelativeTime(user.createdAt, lang)} / ${formatRelativeTime(user.updatedAt, lang)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  meta={user.workspaceId}
                  avatar={
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-admin-primary-soft text-xs font-semibold text-admin-primary ring-1 ring-admin-primary/15">
                      {(user.email ?? user.id).slice(0, 2).toUpperCase()}
                    </span>
                  }
                />
                <div className="flex flex-wrap gap-2 px-3 pb-2">
                  <Link
                    href={localizedPath(lang, `/admin/billing?q=${encodeURIComponent(user.id)}`)}
                    className="text-xs font-semibold text-admin-primary hover:underline"
                  >
                    {adminInlineText(lang, 'orders_ca187bf2')}
                  </Link>
                  <Link
                    href={localizedPath(
                      lang,
                      `/admin/entitlements?q=${encodeURIComponent(user.id)}`
                    )}
                    className="text-xs font-semibold text-admin-primary hover:underline"
                  >
                    {adminInlineText(lang, 'entitlements_2ca17dc5')}
                  </Link>
                  <Link
                    href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(user.id)}`)}
                    className="text-xs font-semibold text-admin-primary hover:underline"
                  >
                    {adminInlineText(lang, 'audit_de9bcda7')}
                  </Link>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-admin-md border border-dashed border-admin-border px-4 py-8 text-center text-sm text-admin-text-muted">
            {copy.empty}
          </div>
        )}
      </div>
    </>
  );
}
