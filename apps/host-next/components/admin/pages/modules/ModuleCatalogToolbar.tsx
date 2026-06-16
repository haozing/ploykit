import { FilterBar } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import { moduleStatusOptions } from './ModuleCatalogPageModel';

function FilterResultHint({
  lang,
  visible,
  total,
}: {
  lang: SupportedLanguage;
  visible: number;
  total: number;
}) {
  if (visible === total) {
    return null;
  }
  return (
    <p className="muted">
      {adminInlineText(lang, 'current_filter_shows_value_value_records_ffd8ee7a', {
        value1: visible,
        value2: total,
      })}
    </p>
  );
}

export function ModuleCatalogToolbar({
  lang,
  tableQuery,
  modulesCount,
  totalModules,
  needsReviewModules,
  requiredModules,
  activeModules,
  pageStart,
  pageSize,
}: {
  lang: SupportedLanguage;
  tableQuery: Required<AdminTableQuery>;
  modulesCount: number;
  totalModules: number;
  needsReviewModules: number;
  requiredModules: number;
  activeModules: number;
  pageStart: number;
  pageSize: number;
}) {
  return (
    <>
      <FilterBar
        lang={lang}
        embedded
        searchValue={tableQuery.q}
        searchPlaceholder="搜索模块名称、ID、版本、状态或权限"
        filterValue={tableQuery.status}
        filterOptions={moduleStatusOptions}
        resetHref={localizedPath(lang, '/admin/modules')}
      />
      <div className="px-4 py-3 sm:px-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <FilterResultHint lang={lang} visible={modulesCount} total={totalModules} />
          <span className="text-xs text-admin-text-muted">
            {adminInlineText(lang, 'showing_value_value_of_value_3d583a43', {
              value1: modulesCount === 0 ? 0 : pageStart + 1,
              value2: Math.min(pageStart + pageSize, modulesCount),
              value3: modulesCount,
            })}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-4">
          {[
            ['Needs review', needsReviewModules],
            ['Required', requiredModules],
            ['With activity', activeModules],
            ['Visible', modulesCount],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-2"
            >
              <span className="text-[11px] font-semibold uppercase text-admin-text-subtle">
                {adminInlineText(lang, String(label))}
              </span>
              <strong className="mt-1 block text-sm text-admin-text">{value}</strong>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
