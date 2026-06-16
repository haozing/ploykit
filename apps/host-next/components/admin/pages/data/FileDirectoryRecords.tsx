import Link from 'next/link';
import { FolderOpen } from 'lucide-react';
import { ConfirmSubmitButton, DataTable } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import { EntityListItem, MoreActionMenu } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { formatBytes } from '@host/lib/i18n-format';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { RuntimeStoreFileRecord } from '@/lib/module-runtime';
import type { AdminFormAction } from './FileDirectoryPageModel';

export function FileDirectoryRecords({
  lang,
  visibleFiles,
  storageMode,
  quarantineFileAction,
  restoreFileAction,
  archiveFileAction,
  deleteFileAction,
}: {
  lang: SupportedLanguage;
  visibleFiles: readonly RuntimeStoreFileRecord[];
  storageMode: string;
  quarantineFileAction: AdminFormAction;
  restoreFileAction: AdminFormAction;
  archiveFileAction: AdminFormAction;
  deleteFileAction: AdminFormAction;
}) {
  return (
    <>
      <div className="hidden xl:block">
        <DataTable
          className="rounded-none border-x-0 border-b-0 shadow-none"
          columns={adminInlineColumns(lang, [
            'Name',
            'Module',
            'Status',
            'Owner',
            'Size',
            'Type',
            'Action',
          ])}
          rows={visibleFiles.map((file) => [
            <div key={`${file.id}:name`} className="min-w-0">
              <Link
                href={localizedPath(lang, `/admin/files/${file.id}`)}
                className="block truncate font-semibold text-admin-primary hover:underline"
              >
                {file.name}
              </Link>
              <div className="mt-1 truncate text-xs text-admin-text-muted">{file.storageKey}</div>
            </div>,
            file.moduleId,
            <StatusBadge key={`${file.id}:status`} lang={lang} value={file.status} />,
            file.ownerId ?? 'system',
            formatBytes(file.sizeBytes, lang),
            file.contentType ?? 'unknown',
            <div key={`${file.id}:actions`} className="flex flex-wrap items-center gap-2">
              <Link
                href={`/api/media/${file.id}`}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              >
                {adminInlineText(lang, 'Open')}
              </Link>
              <Link
                href={`/api/media/${file.id}?download=1`}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              >
                {adminInlineText(lang, 'Download')}
              </Link>
              <Link
                href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(file.id)}`)}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              >
                {adminInlineText(lang, 'audit_de9bcda7')}
              </Link>
              <MoreActionMenu label={adminInlineText(lang, 'Manage')}>
                <form
                  action={quarantineFileAction}
                  className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                >
                  <input type="hidden" name="fileId" value={file.id} />
                  <input type="hidden" name="reason" value="Admin quarantine" />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-warning/25 bg-admin-warning/10 px-3 py-1.5 text-xs font-semibold text-admin-warning transition hover:bg-admin-warning/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    disabled={file.status === 'quarantined'}
                    confirmation={adminInlineText(lang, 'quarantine_file_value_14449c49', {
                      value1: file.name,
                    })}
                  >
                    {adminInlineText(lang, 'Quarantine')}
                  </ConfirmSubmitButton>
                </form>
                <form
                  action={archiveFileAction}
                  className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                >
                  <input type="hidden" name="fileId" value={file.id} />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    disabled={file.status === 'archived' || file.status === 'deleted'}
                    confirmation={adminInlineText(lang, 'archive_file_value_86b0e1fa', {
                      value1: file.name,
                    })}
                  >
                    {adminInlineText(lang, 'Archive')}
                  </ConfirmSubmitButton>
                </form>
                <form
                  action={deleteFileAction}
                  className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                >
                  <input type="hidden" name="fileId" value={file.id} />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 px-3 py-1.5 text-xs font-semibold text-admin-danger transition hover:bg-admin-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    disabled={file.status === 'deleted'}
                    confirmation={adminInlineText(lang, 'delete_file_value_79d4bf49', {
                      value1: file.name,
                    })}
                  >
                    {adminInlineText(lang, 'Delete')}
                  </ConfirmSubmitButton>
                </form>
                <form
                  action={restoreFileAction}
                  className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                >
                  <input type="hidden" name="fileId" value={file.id} />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    disabled={file.status === 'ready'}
                    confirmation={adminInlineText(lang, 'restore_file_value_80d981b3', {
                      value1: file.name,
                    })}
                  >
                    {adminInlineText(lang, 'Restore')}
                  </ConfirmSubmitButton>
                </form>
              </MoreActionMenu>
            </div>,
          ])}
          empty={adminInlineText(lang, 'No files match this filter.')}
          minWidthClass="min-w-[1180px]"
        />
      </div>
      <div className="grid gap-1 px-2 py-2 xl:hidden">
        {visibleFiles.length > 0 ? (
          visibleFiles.map((file) => (
            <EntityListItem
              key={file.id}
              href={localizedPath(lang, `/admin/files/${file.id}`)}
              title={file.name}
              subtitle={`${file.moduleId} · ${file.ownerId ?? 'system'}`}
              status={file.status}
              detail={`${formatBytes(file.sizeBytes, lang)} · ${file.contentType ?? 'unknown'}`}
              meta={adminInlineText(lang, 'value_audit_in_detail_bd7575cb', {
                value1: storageMode,
              })}
              icon={FolderOpen}
              tone={
                file.status === 'quarantined' || file.status === 'deleted' ? 'warning' : 'primary'
              }
            />
          ))
        ) : (
          <div className="rounded-admin-md border border-dashed border-admin-border px-4 py-8 text-center text-sm text-admin-text-muted">
            {adminInlineText(lang, 'No files match this filter.')}
          </div>
        )}
      </div>
    </>
  );
}
