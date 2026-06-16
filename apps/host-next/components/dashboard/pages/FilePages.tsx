import { WorkspaceShell } from '@host/components/ProductShell';
import { Button, ButtonLink, ConfirmSubmitButton, TableToolbar } from '@host/components/ui';
import { AdminPanel, PageSynopsis } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatBytes } from '@host/lib/i18n-format';
import { dashboardInlineText, getDashboardCopy } from '@host/lib/dashboard-copy';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { RuntimeStoreFileRecord } from '@/lib/module-runtime';
import type { HostFileQuotaStatus, HostFileStorageStatus } from '@host/lib/files';
import {
  UserEmptyState,
  UserRecordCard,
  dashboardGhostButtonClass,
  dashboardPrimaryButtonClass,
  formatFilePurpose,
  formatFileType,
  formatStorageLabel,
  formatUserDate,
  friendlyStatusLabel,
} from './DashboardPageUtils';

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
  const copy = getDashboardCopy(lang).common;
  return <p className="text-sm text-admin-text-muted">{copy.filterResult(visible, total)}</p>;
}

function getFileStatusOptions(lang: SupportedLanguage) {
  return [
    { value: 'pending', label: friendlyStatusLabel(lang, 'pending') },
    { value: 'uploading', label: friendlyStatusLabel(lang, 'uploading') },
    { value: 'ready', label: friendlyStatusLabel(lang, 'ready') },
    { value: 'published', label: friendlyStatusLabel(lang, 'published') },
    { value: 'archived', label: friendlyStatusLabel(lang, 'archived') },
    { value: 'deleted', label: friendlyStatusLabel(lang, 'deleted') },
    { value: 'quarantined', label: friendlyStatusLabel(lang, 'quarantined') },
  ] as const;
}

export function DashboardFilesOperationsPage({
  lang,
  files,
  storage,
  quota,
  query,
}: {
  lang: SupportedLanguage;
  files: readonly RuntimeStoreFileRecord[];
  storage: HostFileStorageStatus;
  quota: HostFileQuotaStatus;
  query?: AdminTableQuery;
}) {
  const copy = getDashboardCopy(lang).files;
  const tableQuery = cleanTableQuery(query);
  const visibleFiles = files.filter(
    (file) =>
      matchesTextSearch(tableQuery.q, [
        file.id,
        file.name,
        file.moduleId,
        file.purpose,
        file.status,
        file.visibility,
        file.contentType ?? '',
      ]) && matchesExactFilter(tableQuery.status, file.status)
  );
  const quotaText = (used: number, limit: number) =>
    `${formatBytes(used, lang)} / ${formatBytes(limit, lang)}`;

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle}>
      <PageSynopsis
        lang={lang}
        title={dashboardInlineText(lang, 'storage_usage_fc72a743')}
        description={dashboardInlineText(lang, 'upload_find_and_manage_your_files_c64a78cb')}
        items={[
          {
            key: 'storage',
            label: dashboardInlineText(lang, 'storage_3762c05e'),
            value: formatStorageLabel(lang, storage),
            detail: storage.durable
              ? dashboardInlineText(lang, 'ready_for_long_term_storage_f5b75477')
              : dashboardInlineText(lang, 'best_for_local_demos_f3c176e5'),
            tone: storage.durable ? 'success' : 'warning',
          },
          {
            key: 'files',
            label: dashboardInlineText(lang, 'files_de86c79a'),
            value: String(files.length),
            tone: 'primary',
          },
          {
            key: 'userQuota',
            label: dashboardInlineText(lang, 'your_usage_d3ec43c8'),
            value: quotaText(quota.userBytes, quota.perUserBytes),
            tone: 'info',
          },
          {
            key: 'workspaceQuota',
            label: dashboardInlineText(lang, 'workspace_usage_c45bf7ca'),
            value: quotaText(quota.workspaceBytes, quota.perWorkspaceBytes),
          },
        ]}
      />
      <AdminPanel
        title={copy.uploadFile}
        description={dashboardInlineText(
          lang,
          'choose_a_file_to_upload_to_the_current_workspace_6e5e1c96'
        )}
      >
        <form
          action="/api/files"
          method="post"
          encType="multipart/form-data"
          className="grid gap-4"
        >
          <input type="hidden" name="next" value={localizedPath(lang, '/dashboard/files')} />
          <input type="hidden" name="moduleId" value="web-shell" />
          <input type="hidden" name="purpose" value="source" />
          <label className="grid gap-3 rounded-admin-md border border-dashed border-admin-border bg-admin-bg/40 p-5 text-sm font-medium text-admin-text">
            <span className="text-base font-semibold">{copy.uploadFile}</span>
            <span className="text-sm font-normal leading-6 text-admin-text-muted">
              {dashboardInlineText(
                lang,
                'images_documents_and_data_files_are_supported_wi_eec501b6'
              )}
            </span>
            <input name="file" type="file" className="text-sm text-admin-text" />
          </label>
          <Button
            type="submit"
            className={`${dashboardPrimaryButtonClass} w-fit justify-self-start`}
          >
            {copy.upload}
          </Button>
        </form>
      </AdminPanel>
      <TableToolbar
        lang={lang}
        searchValue={tableQuery.q}
        searchPlaceholder={copy.searchPlaceholder}
        filterValue={tableQuery.status}
        filterOptions={getFileStatusOptions(lang)}
        resetHref={localizedPath(lang, '/dashboard/files')}
      />
      <FilterResultHint lang={lang} visible={visibleFiles.length} total={files.length} />
      <AdminPanel
        title={dashboardInlineText(lang, 'file_library_685c5c34')}
        description={dashboardInlineText(lang, 'uploaded_files_appear_here_625aa90e')}
      >
        {visibleFiles.length > 0 ? (
          <div className="grid gap-3">
            {visibleFiles.map((file) => (
              <UserRecordCard
                key={file.id}
                lang={lang}
                title={file.name}
                description={`${formatFilePurpose(lang, file.purpose)} · ${formatFileType(lang, file.contentType)}`}
                meta={formatUserDate(lang, file.updatedAt)}
                status={file.status}
                details={[
                  {
                    label: dashboardInlineText(lang, 'size_5354fe2d'),
                    value: formatBytes(file.sizeBytes, lang),
                  },
                  {
                    label: dashboardInlineText(lang, 'use_d8f25bd7'),
                    value: formatFilePurpose(lang, file.purpose),
                  },
                ]}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    {file.status === 'ready' || file.status === 'published' ? (
                      <>
                        <ButtonLink href={`/api/media/${file.id}`} variant="secondary" size="small">
                          {copy.open}
                        </ButtonLink>
                        <ButtonLink
                          href={`/api/media/${file.id}?download=1`}
                          variant="secondary"
                          size="small"
                        >
                          {copy.download}
                        </ButtonLink>
                      </>
                    ) : (
                      <span className="text-sm text-admin-text-muted">{copy.pending}</span>
                    )}
                    <form action={`/api/files/${file.id}`} method="post" className="inline-flex">
                      <input
                        type="hidden"
                        name="next"
                        value={localizedPath(lang, '/dashboard/files')}
                      />
                      <input type="hidden" name="action" value="archive" />
                      <ConfirmSubmitButton
                        type="submit"
                        className={dashboardGhostButtonClass}
                        disabled={file.status === 'archived' || file.status === 'deleted'}
                        confirmation={copy.archiveConfirm(file.name)}
                      >
                        {copy.archive}
                      </ConfirmSubmitButton>
                    </form>
                    <form action={`/api/files/${file.id}`} method="post" className="inline-flex">
                      <input
                        type="hidden"
                        name="next"
                        value={localizedPath(lang, '/dashboard/files')}
                      />
                      <input type="hidden" name="action" value="delete" />
                      <ConfirmSubmitButton
                        type="submit"
                        className={dashboardGhostButtonClass}
                        disabled={file.status === 'deleted'}
                        confirmation={copy.deleteConfirm(file.name)}
                      >
                        {copy.delete}
                      </ConfirmSubmitButton>
                    </form>
                  </div>
                }
              />
            ))}
          </div>
        ) : (
          <UserEmptyState
            title={dashboardInlineText(lang, 'no_files_yet_e2696a7f')}
            body={dashboardInlineText(
              lang,
              'upload_your_first_file_to_open_download_or_delet_93337f23'
            )}
          />
        )}
      </AdminPanel>
    </WorkspaceShell>
  );
}
