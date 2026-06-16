import { adminNav, WorkspaceShell } from '@host/components/ProductShell';
import { type SupportedLanguage } from '@host/lib/i18n';
import { getAdminFilesCopy } from '@host/lib/admin-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { RuntimeStoreFileRecord } from '@/lib/module-runtime';
import type { HostFileQuotaStatus, HostFileStorageStatus } from '@host/lib/files';
import type { AdminFileStorageReconcileReport } from '@host/lib/admin-files';
import { FileDirectorySection } from './FileDirectorySection';
import { FileStorageGovernancePanels } from './FileStorageGovernancePanels';

export { AdminFileDetailOperationsPage } from './FileDetailPage';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

function cleanTableQuery(query?: AdminTableQuery): Required<AdminTableQuery> {
  return {
    q: query?.q?.trim() ?? '',
    status: query?.status?.trim() ?? '',
    role: query?.role?.trim() ?? '',
    type: query?.type?.trim() ?? '',
    moduleId: query?.moduleId?.trim() ?? '',
    service: query?.service?.trim() ?? '',
    workspace: query?.workspace?.trim() ?? '',
    environment: query?.environment?.trim() ?? '',
    range: query?.range?.trim() ?? '',
    from: query?.from?.trim() ?? '',
    to: query?.to?.trim() ?? '',
    owner: query?.owner?.trim() ?? '',
    mime: query?.mime?.trim() ?? '',
    provider: query?.provider?.trim() ?? '',
    path: query?.path?.trim() ?? '',
    minSize: query?.minSize ?? 0,
    maxSize: query?.maxSize ?? 0,
    page: query?.page ?? 1,
    pageSize: query?.pageSize ?? 20,
    operation: query?.operation?.trim() ?? '',
    outcome: query?.outcome?.trim() ?? '',
    matched: query?.matched ?? 0,
    processed: query?.processed ?? 0,
    failed: query?.failed ?? 0,
    skipped: query?.skipped ?? 0,
    deadLettered: query?.deadLettered ?? 0,
  };
}

function matchesTextSearch(query: string, values: readonly unknown[]): boolean {
  if (query.length === 0) {
    return true;
  }
  const needle = query.toLowerCase();
  return values.some((value) =>
    String(value ?? '')
      .toLowerCase()
      .includes(needle)
  );
}

function matchesExactFilter(filter: string, value: unknown): boolean {
  return filter.length === 0 || String(value ?? '') === filter;
}

export function AdminFilesOperationsPage({
  lang,
  quota,
  files,
  storage,
  reconcile,
  quarantineFileAction,
  restoreFileAction,
  archiveFileAction,
  deleteFileAction,
  cleanupDeletedFilesAction,
  bulkFileAction,
  query,
}: {
  lang: SupportedLanguage;
  quota?: HostFileQuotaStatus;
  files: readonly RuntimeStoreFileRecord[];
  storage: HostFileStorageStatus;
  reconcile: AdminFileStorageReconcileReport;
  quarantineFileAction: AdminFormAction;
  restoreFileAction: AdminFormAction;
  archiveFileAction: AdminFormAction;
  deleteFileAction: AdminFormAction;
  cleanupDeletedFilesAction: AdminFormAction;
  bulkFileAction?: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminFilesCopy(lang);
  const tableQuery = cleanTableQuery(query);
  const providerValue = storage.mode;
  const filteredFiles = files.filter(
    (file) =>
      matchesTextSearch(tableQuery.q, [
        file.id,
        file.name,
        file.moduleId,
        file.status,
        file.ownerId ?? 'system',
        file.purpose,
        file.visibility,
        file.contentType ?? '',
        file.storageKey,
      ]) &&
      matchesExactFilter(tableQuery.status, file.status) &&
      matchesExactFilter(tableQuery.moduleId, file.moduleId) &&
      matchesExactFilter(tableQuery.owner, file.ownerId ?? 'system') &&
      matchesExactFilter(tableQuery.provider, providerValue) &&
      (!tableQuery.mime || (file.contentType ?? '').includes(tableQuery.mime)) &&
      (!tableQuery.path ||
        file.storageKey.includes(tableQuery.path) ||
        file.name.includes(tableQuery.path)) &&
      (!tableQuery.from || file.createdAt.slice(0, 10) >= tableQuery.from) &&
      (!tableQuery.to || file.createdAt.slice(0, 10) <= tableQuery.to) &&
      (!tableQuery.minSize || file.sizeBytes >= tableQuery.minSize) &&
      (!tableQuery.maxSize || file.sizeBytes <= tableQuery.maxSize)
  );
  const totalPages = Math.max(1, Math.ceil(filteredFiles.length / tableQuery.pageSize));
  const currentPage = Math.min(Math.max(tableQuery.page, 1), totalPages);
  const pageStart = (currentPage - 1) * tableQuery.pageSize;
  const visibleFiles = filteredFiles.slice(pageStart, pageStart + tableQuery.pageSize);
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <div className="grid gap-5">
        <FileStorageGovernancePanels
          lang={lang}
          quota={quota}
          files={files}
          filteredFiles={filteredFiles}
          storage={storage}
          reconcile={reconcile}
          cleanupDeletedFilesAction={cleanupDeletedFilesAction}
        />
        <FileDirectorySection
          lang={lang}
          tableQuery={tableQuery}
          filteredFiles={filteredFiles}
          visibleFiles={visibleFiles}
          totalFiles={files.length}
          currentPage={currentPage}
          totalPages={totalPages}
          storageMode={storage.mode}
          quarantineFileAction={quarantineFileAction}
          restoreFileAction={restoreFileAction}
          archiveFileAction={archiveFileAction}
          deleteFileAction={deleteFileAction}
          bulkFileAction={bulkFileAction}
        />
      </div>
    </WorkspaceShell>
  );
}
