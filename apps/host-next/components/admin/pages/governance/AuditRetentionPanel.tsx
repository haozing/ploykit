import { ActionPanel } from '@host/components/admin/shared/AdminPrimitives';
import { ConfirmSubmitButton, Input, Select } from '@host/components/ui';
import type { SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function AuditRetentionPanel({
  lang,
  applyAuditRetentionAction,
}: {
  lang: SupportedLanguage;
  applyAuditRetentionAction: AdminFormAction;
}) {
  return (
    <ActionPanel
      title={adminInlineText(lang, 'Audit retention')}
      description={adminInlineText(
        lang,
        'Apply audit retention policy. The policy action itself is written back to audit.'
      )}
      tone="warning"
      actions={
        <form action={applyAuditRetentionAction} className="flex flex-wrap items-center gap-2">
          <Input
            name="retentionDays"
            placeholder="90"
            aria-label={adminInlineText(lang, 'Retention days')}
            className="h-9 w-24"
          />
          <Select
            name="mode"
            defaultValue="archive"
            aria-label={adminInlineText(lang, 'Retention mode')}
            className="h-9 w-44"
          >
            <option value="archive">{adminInlineText(lang, 'Archive marker')}</option>
            <option value="hide-before-cutoff">
              {adminInlineText(lang, 'Hide before cutoff')}
            </option>
            <option value="delete">{adminInlineText(lang, 'Delete policy marker')}</option>
          </Select>
          <Input
            name="reason"
            placeholder={adminInlineText(lang, 'reason')}
            aria-label={adminInlineText(lang, 'Retention reason')}
            className="h-9 w-40"
          />
          <ConfirmSubmitButton
            type="submit"
            className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
            confirmation={adminInlineText(lang, '确认应用 Audit retention policy？')}
          >
            {adminInlineText(lang, 'Apply')}
          </ConfirmSubmitButton>
        </form>
      }
    />
  );
}
