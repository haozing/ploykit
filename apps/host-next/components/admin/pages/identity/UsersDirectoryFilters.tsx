import Link from 'next/link';
import { Input, Select } from '@host/components/ui';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import { getAdminUsersCopy } from '@host/lib/admin-copy';
import { userRoleOptions, userStatusOptions } from './UsersDirectoryModel';

export function UsersDirectoryFilters({
  lang,
  tableQuery,
}: {
  lang: SupportedLanguage;
  tableQuery: Required<AdminTableQuery>;
}) {
  const copy = getAdminUsersCopy(lang);

  return (
    <form
      method="get"
      className="flex flex-col gap-3 border-b border-admin-border bg-admin-bg/35 px-4 py-3 sm:px-5 lg:flex-row lg:items-end"
    >
      <label className="grid flex-1 gap-2 text-sm font-medium text-admin-text">
        <span className="text-xs font-semibold uppercase text-admin-text-subtle">
          {adminInlineText(lang, 'Search')}
        </span>
        <Input
          type="search"
          name="q"
          defaultValue={tableQuery.q}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchPlaceholder}
        />
      </label>
      <label className="grid gap-2 text-sm font-medium text-admin-text sm:w-52">
        <span className="text-xs font-semibold uppercase text-admin-text-subtle">
          {adminInlineText(lang, 'account_status_17cc03e7')}
        </span>
        <Select
          name="status"
          defaultValue={tableQuery.status}
          aria-label={adminInlineText(lang, 'account_status_17cc03e7')}
        >
          <option value="">{adminInlineText(lang, 'All')}</option>
          {userStatusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {adminInlineText(lang, option.label)}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid gap-2 text-sm font-medium text-admin-text sm:w-52">
        <span className="text-xs font-semibold uppercase text-admin-text-subtle">
          {adminInlineText(lang, 'host_role_4848d385')}
        </span>
        <Select
          name="role"
          defaultValue={tableQuery.role}
          aria-label={adminInlineText(lang, 'host_role_4848d385')}
        >
          <option value="">{adminInlineText(lang, 'All')}</option>
          {userRoleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {adminInlineText(lang, option.label)}
            </option>
          ))}
        </Select>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
        >
          {adminInlineText(lang, 'Filter')}
        </button>
        {tableQuery.q || tableQuery.status || tableQuery.role ? (
          <Link
            href={localizedPath(lang, '/admin/users')}
            className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
          >
            {adminInlineText(lang, 'Clear')}
          </Link>
        ) : null}
      </div>
    </form>
  );
}
