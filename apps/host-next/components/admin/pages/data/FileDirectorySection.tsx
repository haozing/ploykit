import { Pagination } from '@host/components/ui';
import { AdminPanel } from '@host/components/admin/shared/AdminPrimitives';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { RuntimeStoreFileRecord } from '@/lib/module-runtime';
import { FileDirectoryBulkActionPanel } from './FileDirectoryBulkActionPanel';
import { FileDirectoryFilters } from './FileDirectoryFilters';
import { adminListHref, type AdminFormAction } from './FileDirectoryPageModel';
import { FileDirectoryRecords } from './FileDirectoryRecords';

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

export function FileDirectorySection({
  lang,
  tableQuery,
  filteredFiles,
  visibleFiles,
  totalFiles,
  currentPage,
  totalPages,
  storageMode,
  quarantineFileAction,
  restoreFileAction,
  archiveFileAction,
  deleteFileAction,
  bulkFileAction,
}: {
  lang: SupportedLanguage;
  tableQuery: Required<AdminTableQuery>;
  filteredFiles: readonly RuntimeStoreFileRecord[];
  visibleFiles: readonly RuntimeStoreFileRecord[];
  totalFiles: number;
  currentPage: number;
  totalPages: number;
  storageMode: string;
  quarantineFileAction: AdminFormAction;
  restoreFileAction: AdminFormAction;
  archiveFileAction: AdminFormAction;
  deleteFileAction: AdminFormAction;
  bulkFileAction?: AdminFormAction;
}) {
  return (
    <>
      <FileDirectoryBulkActionPanel
        lang={lang}
        filteredFiles={filteredFiles}
        bulkFileAction={bulkFileAction}
      />
      <AdminPanel
        className="order-8"
        title={adminInlineText(lang, 'File directory')}
        description={adminInlineText(
          lang,
          'Directory filters show runtime file metadata; an empty directory does not prove there are no orphan physical objects, so reconcile evidence stays above.'
        )}
        contentClassName="p-0"
      >
        <FileDirectoryFilters lang={lang} tableQuery={tableQuery} />
        <div className="px-4 py-3 sm:px-5">
          <FilterResultHint lang={lang} visible={filteredFiles.length} total={totalFiles} />
        </div>
        <FileDirectoryRecords
          lang={lang}
          visibleFiles={visibleFiles}
          storageMode={storageMode}
          quarantineFileAction={quarantineFileAction}
          restoreFileAction={restoreFileAction}
          archiveFileAction={archiveFileAction}
          deleteFileAction={deleteFileAction}
        />
      </AdminPanel>
      <div className="order-2">
        <Pagination
          page={currentPage}
          totalPages={totalPages}
          previousHref={
            currentPage > 1
              ? adminListHref(lang, '/admin/files', tableQuery, currentPage - 1)
              : undefined
          }
          nextHref={
            currentPage < totalPages
              ? adminListHref(lang, '/admin/files', tableQuery, currentPage + 1)
              : undefined
          }
        />
      </div>
    </>
  );
}
