import { ConfirmSubmitButton, Input } from '@host/components/ui';
import { ActionPanel } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { AdminOutboxDetailView } from '@host/lib/admin-delivery';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function AdminWebhookDetailActions({
  lang,
  outbox,
  retryOutboxAction,
  discardOutboxAction,
  archiveOutboxAction,
}: {
  lang: SupportedLanguage;
  outbox: NonNullable<AdminOutboxDetailView['outbox']>;
  retryOutboxAction: AdminFormAction;
  discardOutboxAction: AdminFormAction;
  archiveOutboxAction: AdminFormAction;
}) {
  return (
    <ActionPanel
      title={outbox.name}
      description={`Delivery action for ${outbox.moduleId ?? 'host'} outbox record.`}
      tone={outbox.status === 'dead_letter' || outbox.status === 'failed' ? 'danger' : 'neutral'}
      actions={
        <>
          <form action={retryOutboxAction} className="inline-flex flex-wrap items-center gap-2">
            <input type="hidden" name="outboxId" value={outbox.id} />
            <Input
              name="reason"
              placeholder={adminInlineText(lang, 'Reason')}
              aria-label={adminInlineText(lang, 'Retry reason')}
              className="h-9 w-36"
            />
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white transition hover:bg-admin-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              disabled={outbox.status === 'queued' || outbox.status === 'archived'}
              confirmation={adminInlineText(lang, 'retry_outbox_value_d2601a72', {
                value1: outbox.name,
              })}
            >
              {adminInlineText(lang, 'Retry')}
            </ConfirmSubmitButton>
          </form>
          <form action={discardOutboxAction} className="inline-flex flex-wrap items-center gap-2">
            <input type="hidden" name="outboxId" value={outbox.id} />
            <Input
              name="reason"
              placeholder={adminInlineText(lang, 'Reason')}
              aria-label={adminInlineText(lang, 'Discard reason')}
              className="h-9 w-36"
            />
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 px-4 py-2 text-sm font-semibold text-admin-danger transition hover:bg-admin-danger/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              disabled={outbox.status === 'dead_letter' || outbox.status === 'archived'}
              confirmation={adminInlineText(lang, 'discard_outbox_value_2d809397', {
                value1: outbox.name,
              })}
            >
              {adminInlineText(lang, 'Discard')}
            </ConfirmSubmitButton>
          </form>
          <form action={archiveOutboxAction} className="inline-flex flex-wrap items-center gap-2">
            <input type="hidden" name="outboxId" value={outbox.id} />
            <Input
              name="reason"
              placeholder={adminInlineText(lang, 'Reason')}
              aria-label={adminInlineText(lang, 'Archive reason')}
              className="h-9 w-36"
            />
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-4 py-2 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              disabled={outbox.status === 'archived'}
              confirmation={adminInlineText(lang, 'archive_outbox_value_7c8a928b', {
                value1: outbox.name,
              })}
            >
              {adminInlineText(lang, 'Archive')}
            </ConfirmSubmitButton>
          </form>
        </>
      }
    />
  );
}
