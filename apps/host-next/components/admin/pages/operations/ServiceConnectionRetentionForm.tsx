import { ConfirmSubmitButton, Input } from '@host/components/ui';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { AdminServiceConnectionsView } from '@host/lib/admin-service-connections';
import type { AdminFormAction } from './ServiceConnectionMaintenanceModel';

export function ServiceConnectionRetentionForm({
  lang,
  connections,
  action,
}: {
  lang: SupportedLanguage;
  connections: AdminServiceConnectionsView;
  action: AdminFormAction;
}) {
  return (
    <form
      action={action}
      className="rounded-admin-md border border-admin-border bg-admin-surface p-5 shadow-admin-card grid gap-4"
    >
      <div>
        <h2>{adminInlineText(lang, 'Call Log Retention')}</h2>
        <p>
          {adminInlineText(lang, '按保留天数隐藏旧 connection call logs，并写入 retention audit。')}
        </p>
      </div>
      <Input
        name="retentionDays"
        placeholder="30"
        aria-label={adminInlineText(lang, 'Retention days')}
      />
      <Input
        name="reason"
        placeholder={adminInlineText(lang, 'reason')}
        aria-label={adminInlineText(lang, 'Retention reason')}
      />
      <div className="text-sm text-admin-text-muted">
        {adminInlineText(lang, 'hidden')} {connections.retention.hiddenCount} ·{' '}
        {adminInlineText(lang, 'visible')} {connections.retention.visibleCount}
        {connections.retention.cutoff ? ` · cutoff ${connections.retention.cutoff}` : ''}
      </div>
      <ConfirmSubmitButton
        type="submit"
        className="inline-flex min-h-8 items-center justify-center rounded-admin-md px-3 py-1.5 text-xs font-semibold text-foreground transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
        confirmation={adminInlineText(
          lang,
          '确认应用 connection call log retention？旧日志会从当前运营视图隐藏。'
        )}
      >
        {adminInlineText(lang, 'Apply Retention')}
      </ConfirmSubmitButton>
    </form>
  );
}
