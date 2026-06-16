import { ConfirmSubmitButton, DataTable, Input } from '@host/components/ui';
import { AdminPanel, HealthRowList } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { AdminWorkerRuntimeStatus } from '@host/lib/admin-worker-operations';
import { adminRelatedHref } from './OperationsPageUtils';
import type {
  AdminWebhookBulkPreviewRow,
  AdminWebhookOutboxKind,
} from './WebhookPageModel';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function AdminWebhookWorkerPanels({
  lang,
  workerStatus,
  previewRows,
  outboxByKind,
  replayDeadLettersDisabled,
  discardFailedOutboxDisabled,
  archiveProcessedOutboxDisabled,
  retryFailedReceiptsDisabled,
  drainWorkerAction,
  bulkReplayDeadLettersAction,
  bulkDiscardFailedOutboxAction,
  bulkArchiveProcessedOutboxAction,
  bulkRetryFailedReceiptsAction,
}: {
  lang: SupportedLanguage;
  workerStatus: AdminWorkerRuntimeStatus;
  previewRows: readonly AdminWebhookBulkPreviewRow[];
  outboxByKind: Record<AdminWebhookOutboxKind, number>;
  replayDeadLettersDisabled: boolean;
  discardFailedOutboxDisabled: boolean;
  archiveProcessedOutboxDisabled: boolean;
  retryFailedReceiptsDisabled: boolean;
  drainWorkerAction: AdminFormAction;
  bulkReplayDeadLettersAction: AdminFormAction;
  bulkDiscardFailedOutboxAction: AdminFormAction;
  bulkArchiveProcessedOutboxAction: AdminFormAction;
  bulkRetryFailedReceiptsAction: AdminFormAction;
}) {
  return (
    <>
      <AdminPanel
        title={adminInlineText(lang, 'Worker status')}
        description={`${workerStatus.workerId} · heartbeat ${workerStatus.heartbeatAt ?? 'missing'} · lag ${workerStatus.queue.lagMs}ms`}
      >
        {previewRows.length > 0 ? (
          <div className="mb-4 overflow-hidden rounded-admin-md border border-admin-border">
            <DataTable
              className="rounded-none border-0 shadow-none"
              columns={adminInlineColumns(lang, [
                'Bulk action',
                'Dry-run impact',
                'Modules',
                'Oldest',
              ])}
              rows={previewRows.map((row) => [
                row.label,
                row.impact,
                row.modules,
                row.oldest,
              ])}
              density="compact"
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <form action={drainWorkerAction} className="inline-flex">
            <input type="hidden" name="limit" value="25" />
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              confirmation={adminInlineText(
                lang,
                'trigger_worker_drain_now_this_run_processes_up_to_25_b9e93a1b'
              )}
            >
              {adminInlineText(lang, 'drain_25_worker_records_39239903')}
            </ConfirmSubmitButton>
          </form>
          <form action={bulkReplayDeadLettersAction} className="inline-flex">
            <input type="hidden" name="limit" value="50" />
            <Input
              className="h-8 w-32"
              name="reason"
              placeholder={adminInlineText(lang, 'Reason')}
              aria-label={adminInlineText(lang, 'Replay reason')}
            />
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              disabled={replayDeadLettersDisabled}
              confirmation={adminInlineText(lang, '确认批量重放当前 dead-letter outbox？')}
            >
              {adminInlineText(lang, 'Replay Dead Letters')}
            </ConfirmSubmitButton>
          </form>
          <form action={bulkDiscardFailedOutboxAction} className="inline-flex">
            <input type="hidden" name="limit" value="50" />
            <Input
              className="h-8 w-32"
              name="reason"
              placeholder={adminInlineText(lang, 'Reason')}
              aria-label={adminInlineText(lang, 'Discard reason')}
            />
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              disabled={discardFailedOutboxDisabled}
              confirmation={adminInlineText(lang, '确认批量丢弃当前 failed outbox？')}
            >
              {adminInlineText(lang, 'Discard Failed')}
            </ConfirmSubmitButton>
          </form>
          <form action={bulkArchiveProcessedOutboxAction} className="inline-flex">
            <input type="hidden" name="limit" value="50" />
            <Input
              className="h-8 w-32"
              name="reason"
              placeholder={adminInlineText(lang, 'Reason')}
              aria-label={adminInlineText(lang, 'Archive reason')}
            />
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              disabled={archiveProcessedOutboxDisabled}
              confirmation={adminInlineText(lang, '确认批量归档当前 processed outbox？')}
            >
              {adminInlineText(lang, 'Archive Processed')}
            </ConfirmSubmitButton>
          </form>
          <form action={bulkRetryFailedReceiptsAction} className="inline-flex">
            <input type="hidden" name="limit" value="50" />
            <Input
              className="h-8 w-32"
              name="reason"
              placeholder={adminInlineText(lang, 'Reason')}
              aria-label={adminInlineText(lang, 'Receipt retry reason')}
            />
            <ConfirmSubmitButton
              type="submit"
              className="inline-flex min-h-9 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
              disabled={retryFailedReceiptsDisabled}
              confirmation={adminInlineText(lang, '确认批量重试当前 failed webhook receipts？')}
            >
              {adminInlineText(lang, 'Retry Failed Receipts')}
            </ConfirmSubmitButton>
          </form>
        </div>
      </AdminPanel>
      <AdminPanel
        title={adminInlineText(lang, 'Worker drain scope')}
        description={adminInlineText(
          lang,
          'this_drain_action_is_the_host_worker_drain_not_webho_d7cb8a14'
        )}
      >
        <HealthRowList
          lang={lang}
          items={[
            {
              key: 'worker-scope-jobs',
              title: 'Jobs',
              detail: 'job:* outbox records and job run records.',
              meta: `${outboxByKind.job} recent`,
              status: outboxByKind.job > 0 ? 'queued' : 'clear',
              statusTone: outboxByKind.job > 0 ? 'warning' : 'success',
              tone: outboxByKind.job > 0 ? 'warning' : 'success',
              href: adminRelatedHref(lang, '/admin/runs', { type: 'job' }),
            },
            {
              key: 'worker-scope-events',
              title: 'Events',
              detail: 'event:* outbox records and subscriber delivery ledger.',
              meta: `${outboxByKind.event} recent`,
              status: outboxByKind.event > 0 ? 'queued' : 'clear',
              statusTone: outboxByKind.event > 0 ? 'warning' : 'success',
              tone: outboxByKind.event > 0 ? 'warning' : 'success',
              href: adminRelatedHref(lang, '/admin/webhooks', { q: 'event:' }),
            },
            {
              key: 'worker-scope-webhooks',
              title: 'Webhooks',
              detail: 'webhook:* outbox records, receipts, and dead letters.',
              meta: `${outboxByKind.webhook} recent`,
              status: outboxByKind.webhook > 0 ? 'queued' : 'clear',
              statusTone: outboxByKind.webhook > 0 ? 'warning' : 'success',
              tone: outboxByKind.webhook > 0 ? 'warning' : 'success',
              href: adminRelatedHref(lang, '/admin/webhooks', { q: 'webhook:' }),
            },
            {
              key: 'worker-scope-email',
              title: 'Email',
              detail: 'email:* outbox records handled by the same worker drain.',
              meta: `${outboxByKind.email} recent`,
              status: outboxByKind.email > 0 ? 'queued' : 'clear',
              statusTone: outboxByKind.email > 0 ? 'warning' : 'success',
              tone: outboxByKind.email > 0 ? 'warning' : 'success',
              href: adminRelatedHref(lang, '/admin/webhooks', { q: 'email:' }),
            },
          ]}
        />
      </AdminPanel>
      <AdminPanel
        title={adminInlineText(lang, 'Queue pulse')}
        description={adminInlineText(
          lang,
          'Worker pressure is shown as lanes first; delivery tables stay focused on records.'
        )}
      >
        <HealthRowList
          lang={lang}
          items={[
            {
              key: 'queued',
              title: 'Queued outbox',
              detail: 'Pending deliveries waiting for worker drain.',
              meta: `${workerStatus.queue.queued} queued`,
              status: workerStatus.queue.queued > 0 ? 'waiting' : 'clear',
              statusTone: workerStatus.queue.queued > 0 ? 'warning' : 'success',
              tone: workerStatus.queue.queued > 0 ? 'warning' : 'success',
            },
            {
              key: 'processing',
              title: 'Processing',
              detail: `Heartbeat ${workerStatus.heartbeatAt ?? 'missing'}; last drain ${workerStatus.lastDrainAt ?? 'never'}.`,
              meta: `${workerStatus.queue.processing} active`,
              status: workerStatus.queue.processing > 0 ? 'active' : 'idle',
              statusTone: workerStatus.queue.processing > 0 ? 'info' : 'neutral',
              tone: workerStatus.queue.processing > 0 ? 'info' : 'neutral',
            },
            {
              key: 'failed',
              title: 'Failed deliveries',
              detail: 'Retry or discard only after checking provider and payload evidence.',
              meta: `${workerStatus.queue.failed} failed`,
              status: workerStatus.queue.failed > 0 ? 'review' : 'clear',
              statusTone: workerStatus.queue.failed > 0 ? 'danger' : 'success',
              tone: workerStatus.queue.failed > 0 ? 'danger' : 'success',
            },
            {
              key: 'dead-letter',
              title: 'Dead letters',
              detail: workerStatus.queue.oldestPendingAt
                ? `Oldest pending item: ${workerStatus.queue.oldestPendingAt}.`
                : 'No stuck pending delivery is currently recorded.',
              meta: `${workerStatus.queue.deadLettered} dead`,
              status: workerStatus.queue.deadLettered > 0 ? 'blocked' : 'clear',
              statusTone: workerStatus.queue.deadLettered > 0 ? 'danger' : 'success',
              tone: workerStatus.queue.deadLettered > 0 ? 'danger' : 'success',
            },
            {
              key: 'alerts',
              title: 'Worker alerts',
              detail:
                workerStatus.alerts.length > 0
                  ? workerStatus.alerts
                      .map((alert) => `${alert.code}: ${alert.message}`)
                      .join(' · ')
                  : 'No worker pressure alerts.',
              meta: `${workerStatus.queue.lagMs}ms lag`,
              status: workerStatus.alerts.length > 0 ? 'warning' : 'clear',
              statusTone: workerStatus.alerts.length > 0 ? 'warning' : 'success',
              tone: workerStatus.alerts.length > 0 ? 'warning' : 'success',
            },
          ]}
        />
      </AdminPanel>
    </>
  );
}
