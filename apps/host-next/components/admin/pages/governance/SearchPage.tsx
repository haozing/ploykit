import Link from 'next/link';
import { Activity, Search } from 'lucide-react';
import { adminNav, EmptyState, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { Pagination } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import { SearchCommandPalette } from '@host/components/admin/search/SearchCommandPalette';
import { AdminPanel, FilterBar, StatGrid } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatRelativeTime } from '@host/lib/i18n-format';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminSearchCopy } from '@host/lib/admin-copy';
import {
  getAdminSearchQuickCommands,
  getAdminSearchResultDetail,
  getAdminSearchResultHref,
  getAdminSearchTypeLabel,
  getAdminSearchTypeOptions,
  getAdminSearchUiCopy,
  type AdminSearchResult,
} from '@host/lib/admin-search-model';
import type { AdminTableQuery } from '@host/lib/table-query';
import { adminListHref, cleanGovernanceTableQuery, type AdminPagedResult } from './GovernancePageModel';

export function AdminSearchOperationsPage({
  lang,
  results,
  query,
}: {
  lang: SupportedLanguage;
  results: AdminPagedResult<AdminSearchResult>;
  query?: AdminTableQuery;
}) {
  const copy = getAdminSearchCopy(lang);
  const searchCopy = getAdminSearchUiCopy(lang);
  const tableQuery = cleanGovernanceTableQuery(query);
  const categories = Array.from(
    results.items.reduce(
      (acc, item) => acc.set(item.type, (acc.get(item.type) ?? 0) + 1),
      new Map<string, number>()
    )
  );
  const groupedResults = categories.map(([type]) => ({
    type,
    label: getAdminSearchTypeLabel(lang, type),
    items: results.items.filter((item) => item.type === type),
  }));
  const quickSearches = [
    tableQuery.q,
    ...categories.map(([type]) => type),
    'users',
    'runs',
    'files',
    'orders',
    'modules',
    'outbox',
  ]
    .filter(
      (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index
    )
    .slice(0, 8);
  const searchTotalPages = Math.max(1, Math.ceil(results.page.total / results.page.limit));
  const searchPage = Math.min(
    Math.max(Math.floor(results.page.offset / results.page.limit) + 1, 1),
    searchTotalPages
  );
  return (
    <WorkspaceShell
      lang={lang}
      title={copy.title}
      subtitle={copy.subtitle}
      nav={adminNav}
      actions={
        <Link
          href="#global-search-panel"
          className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
        >
          {adminInlineText(lang, 'jump_to_search_panel_8493feeb')}
        </Link>
      }
    >
      <StatGrid className="xl:grid-cols-3">
        <StatCard
          label={adminInlineText(lang, 'Results')}
          value={String(results.items.length)}
          helper={adminInlineText(lang, 'value_total_matches_84f4f25f', {
            value1: results.page.total,
          })}
          tone="blue"
          icon={Search}
        />
        <StatCard
          label={adminInlineText(lang, 'Categories')}
          value={String(categories.length)}
          helper={
            categories.map(([type]) => getAdminSearchTypeLabel(lang, type)).join(', ') ||
            adminInlineText(lang, 'none')
          }
          icon={Activity}
        />
        <StatCard
          label={adminInlineText(lang, 'Query')}
          value={tableQuery.q || adminInlineText(lang, 'empty_5c14a56d')}
          helper={adminInlineText(lang, 'Global lookup')}
          tone={tableQuery.q ? 'amber' : 'neutral'}
          icon={Search}
        />
      </StatGrid>
      <SearchCommandPalette
        lang={lang}
        basePath={localizedPath(lang, '/admin/search')}
        currentQuery={tableQuery.q}
        quickSearches={quickSearches}
        commands={getAdminSearchQuickCommands(lang)}
        placeholder={searchCopy.placeholder}
        submitLabel={searchCopy.submit}
        ariaLabel={searchCopy.queryLabel}
      />
      <AdminPanel
        id="global-search-panel"
        title={adminInlineText(lang, 'Global search')}
        description={adminInlineText(
          lang,
          'Results are grouped by object type so search does not feel like a raw dump.'
        )}
        contentClassName="p-0"
      >
        <FilterBar
          lang={lang}
          searchValue={tableQuery.q}
          searchPlaceholder={searchCopy.placeholder}
          filterName="type"
          filterValue={tableQuery.type}
          filterLabel={searchCopy.typeLabel}
          filterOptions={getAdminSearchTypeOptions(lang)}
          resetHref={localizedPath(lang, '/admin/search')}
        />
        {categories.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b border-admin-border px-4 py-3 sm:px-5">
            {categories.map(([type, count]) => (
              <span
                key={type}
                className="rounded-full border border-admin-border bg-admin-bg px-2.5 py-1 text-xs font-semibold text-admin-text-muted"
              >
                {getAdminSearchTypeLabel(lang, type)} · {count}
              </span>
            ))}
          </div>
        ) : null}
        <div className="grid gap-3 p-4 sm:p-5">
          {groupedResults.length > 0 ? (
            groupedResults.map((group) => (
              <section
                key={group.type}
                className="overflow-hidden rounded-admin-md border border-admin-border bg-admin-bg/45"
              >
                <div className="flex items-center justify-between gap-3 border-b border-admin-border bg-admin-surface-muted px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
                    {group.label}
                  </span>
                  <span className="text-xs font-semibold text-admin-text-muted">
                    {group.items.length}
                  </span>
                </div>
                <div className="divide-y divide-admin-border">
                  {group.items.map((item) => (
                    <Link
                      key={`${item.type}:${item.id}`}
                      href={getAdminSearchResultHref(lang, item)}
                      className="flex min-w-0 items-center justify-between gap-3 px-3 py-3 transition hover:bg-admin-surface-muted"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-admin-text">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-admin-text-muted">
                          {getAdminSearchResultDetail(lang, item)}
                        </span>
                        <span className="mt-1 block text-[11px] text-admin-text-muted">
                          {[
                            item.updatedAt
                              ? `${adminInlineText(lang, 'Updated')} ${formatRelativeTime(item.updatedAt, lang)}`
                              : null,
                            item.risk
                              ? `${adminInlineText(lang, 'Risk')} ${adminInlineText(lang, item.risk)}`
                              : null,
                            item.matchedFields?.length
                              ? `${adminInlineText(lang, 'Matched')} ${item.matchedFields.join(', ')}`
                              : null,
                          ]
                            .filter(Boolean)
                            .join(' · ') || adminInlineText(lang, 'No extra evidence')}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">
                          {item.type}:{item.id}
                        </span>
                      </span>
                      <StatusBadge
                        lang={lang}
                        value={item.status ?? item.type}
                        label={
                          item.status
                            ? adminInlineText(lang, item.status)
                            : getAdminSearchTypeLabel(lang, item.type)
                        }
                        tone="neutral"
                      />
                    </Link>
                  ))}
                </div>
              </section>
            ))
          ) : (
            <EmptyState
              title={
                tableQuery.q
                  ? adminInlineText(lang, 'no_search_results_3b8d6a21')
                  : adminInlineText(lang, 'search_across_admin_objects_8aa9cb52')
              }
            >
              {tableQuery.q
                ? adminInlineText(lang, 'no_admin_search_matches_body_793e79e5')
                : adminInlineText(lang, 'admin_search_empty_body_e63fc734')}
            </EmptyState>
          )}
        </div>
        {searchTotalPages > 1 ? (
          <Pagination
            page={searchPage}
            totalPages={searchTotalPages}
            previousHref={
              searchPage > 1
                ? adminListHref(lang, '/admin/search', tableQuery, searchPage - 1)
                : undefined
            }
            nextHref={
              searchPage < searchTotalPages
                ? adminListHref(lang, '/admin/search', tableQuery, searchPage + 1)
                : undefined
            }
          />
        ) : null}
      </AdminPanel>
    </WorkspaceShell>
  );
}
