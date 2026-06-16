import { Pagination } from '@host/components/ui';
import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import { type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { AdminModuleListItem } from './ModulePageModel';
import { ModuleCatalogRecords } from './ModuleCatalogRecords';
import { ModuleCatalogToolbar } from './ModuleCatalogToolbar';
import { adminListHref, type AdminFormAction } from './ModuleCatalogPageModel';

export function ModuleCatalogSection({
  lang,
  tableQuery,
  modules,
  totalModules,
  needsReviewModules,
  requiredModules,
  activeModules,
  updateModuleStatusAction,
}: {
  lang: SupportedLanguage;
  tableQuery: Required<AdminTableQuery>;
  modules: readonly AdminModuleListItem[];
  totalModules: number;
  needsReviewModules: number;
  requiredModules: number;
  activeModules: number;
  updateModuleStatusAction: AdminFormAction;
}) {
  const pageSize = tableQuery.pageSize === 20 ? 8 : tableQuery.pageSize;
  const totalPages = Math.max(1, Math.ceil(modules.length / pageSize));
  const page = Math.min(Math.max(tableQuery.page, 1), totalPages);
  const pageStart = (page - 1) * pageSize;
  const visibleModules = modules.slice(pageStart, pageStart + pageSize);
  const modulePageQuery = { ...tableQuery, pageSize };

  return (
    <>
      <AdminPanel
        title={adminInlineText(lang, 'Module catalog')}
        description={adminInlineText(
          lang,
          'Installed modules are product capabilities. Detail pages contain contracts, routes, permissions, resources, and diagnostics.'
        )}
        contentClassName="p-0"
      >
        <ModuleCatalogToolbar
          lang={lang}
          tableQuery={tableQuery}
          modulesCount={modules.length}
          totalModules={totalModules}
          needsReviewModules={needsReviewModules}
          requiredModules={requiredModules}
          activeModules={activeModules}
          pageStart={pageStart}
          pageSize={pageSize}
        />
        <ModuleCatalogRecords
          lang={lang}
          visibleModules={visibleModules}
          updateModuleStatusAction={updateModuleStatusAction}
        />
      </AdminPanel>
      <Pagination
        page={page}
        totalPages={totalPages}
        previousHref={
          page > 1 ? adminListHref(lang, '/admin/modules', modulePageQuery, page - 1) : undefined
        }
        nextHref={
          page < totalPages
            ? adminListHref(lang, '/admin/modules', modulePageQuery, page + 1)
            : undefined
        }
      />
    </>
  );
}
