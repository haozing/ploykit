import { ConfirmSubmitButton, Input, Select } from '@host/components/ui';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { RuntimeStoreFileRecord } from '@/lib/module-runtime';
import type { AdminFormAction } from './FileDirectoryPageModel';

export function FileDirectoryBulkActionPanel({
  lang,
  filteredFiles,
  bulkFileAction,
}: {
  lang: SupportedLanguage;
  filteredFiles: readonly RuntimeStoreFileRecord[];
  bulkFileAction?: AdminFormAction;
}) {
  if (!bulkFileAction) {
    return null;
  }

  return (
    <form
      action={bulkFileAction}
      className="order-7 rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <h2>{adminInlineText(lang, 'Bulk File Action')}</h2>
        <p>
          {adminInlineText(
            lang,
            '对当前筛选结果执行批量 archive/delete，最多一次处理 100 个文件。'
          )}
        </p>
      </div>
      <input type="hidden" name="fileIds" value={filteredFiles.map((file) => file.id).join(',')} />
      <Select name="action" defaultValue="archive" aria-label={adminInlineText(lang, 'Bulk file action')}>
        <option value="archive">{adminInlineText(lang, 'Archive current filter')}</option>
        <option value="delete">{adminInlineText(lang, 'Delete current filter')}</option>
      </Select>
      <Input
        name="reason"
        placeholder={adminInlineText(lang, 'reason')}
        aria-label={adminInlineText(lang, 'Bulk reason')}
      />
      <ConfirmSubmitButton
        type="submit"
        className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
        disabled={filteredFiles.length === 0}
        confirmation={adminInlineText(
          lang,
          'apply_a_bulk_action_to_value_files_in_the_current_fi_ef78a325',
          { value1: filteredFiles.length }
        )}
      >
        {adminInlineText(lang, 'Apply Bulk Action')}
      </ConfirmSubmitButton>
    </form>
  );
}
