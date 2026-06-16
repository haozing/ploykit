import { ConfirmSubmitButton, DataTable, Input } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import { AdminPanel, TimelineList } from '@host/components/admin/shared/AdminPrimitives';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { AdminOutboxDetailView } from '@host/lib/admin-delivery';
import { compactJson } from './OperationsPageUtils';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function AdminWebhookDetailTables({
  lang,
  detail,
  retryWebhookReceiptAction,
}: {
  lang: SupportedLanguage;
  detail: AdminOutboxDetailView & { outbox: NonNullable<AdminOutboxDetailView['outbox']> };
  retryWebhookReceiptAction: AdminFormAction;
}) {
  const outbox = detail.outbox;

  return (
    <>
      <AdminPanel
        title={adminInlineText(lang, 'Webhook receipts')}
        description={adminInlineText(
          lang,
          'Retry is available only for receipts that are not already processing or processed.'
        )}
        contentClassName="p-0"
      >
        <DataTable
          className="rounded-none border-x-0 shadow-none"
          columns={adminInlineColumns(lang, [
            'Webhook',
            'Status',
            'Attempts',
            'Signature',
            'Path',
            'Error',
            'Retry',
          ])}
          rows={
            detail.receipts.length > 0
              ? detail.receipts.map((receipt) => [
                  receipt.webhookName,
                  <StatusBadge key={`${receipt.id}:status`} lang={lang} value={receipt.status} />,
                  String(receipt.attempts),
                  receipt.signature ? 'present' : 'none',
                  `${receipt.method} ${receipt.path}`,
                  receipt.error?.message ?? '-',
                  <form
                    key={`${receipt.id}:retry`}
                    action={retryWebhookReceiptAction}
                    className="inline-flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="receiptId" value={receipt.id} />
                    <input type="hidden" name="outboxId" value={outbox.id} />
                    <Input
                      name="reason"
                      placeholder={adminInlineText(lang, 'Reason')}
                      aria-label={adminInlineText(lang, 'Receipt retry reason')}
                      className="h-8 w-32"
                    />
                    <ConfirmSubmitButton
                      type="submit"
                      className="inline-flex min-h-8 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-admin-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                      disabled={
                        receipt.status === 'received' ||
                        receipt.status === 'processing' ||
                        receipt.status === 'processed'
                      }
                      confirmation={adminInlineText(
                        lang,
                        'retry_webhook_receipt_value_dee92adb',
                        { value1: receipt.webhookName }
                      )}
                    >
                      {adminInlineText(lang, 'Retry')}
                    </ConfirmSubmitButton>
                  </form>,
                ])
              : [['-', '-', '-', '-', 'No related receipts', '-', '-']]
          }
          minWidthClass="min-w-[980px]"
        />
      </AdminPanel>

      <AdminPanel
        title={adminInlineText(lang, 'Delivery ledger')}
        description={adminInlineText(lang, 'Worker delivery history for this outbox and linked receipt.')}
        contentClassName="p-0"
      >
        <DataTable
          className="rounded-none border-x-0 shadow-none"
          columns={adminInlineColumns(lang, [
            'Kind / Source',
            'Status',
            'Attempts',
            'Worker',
            'Error / Retry',
          ])}
          rows={
            detail.deliveries.length > 0
              ? detail.deliveries.map((record) => [
                  `${record.kind} · ${record.source}`,
                  <StatusBadge key={record.id} lang={lang} value={record.status} />,
                  String(record.attempts),
                  record.workerId ?? 'no worker',
                  record.error?.message ?? record.nextRetryAt ?? 'ok',
                ])
              : [['-', '-', '0', 'no worker', 'No delivery ledger records for this outbox']]
          }
          minWidthClass="min-w-[920px]"
        />
      </AdminPanel>

      <AdminPanel
        title={adminInlineText(lang, 'Audit timeline')}
        description={adminInlineText(
          lang,
          'Delivery operations and replay changes for this outbox record.'
        )}
      >
        <TimelineList
          lang={lang}
          items={detail.audit.map((record) => ({
            key: record.id,
            title: record.type,
            description: compactJson(record.metadata, 180),
            meta: `${record.actorId ?? 'system'} · ${record.createdAt}`,
            tone: record.type.includes('discard')
              ? 'danger'
              : record.type.includes('retry')
                ? 'warning'
                : 'primary',
          }))}
          empty={adminInlineText(lang, 'No related audit events.')}
        />
      </AdminPanel>
    </>
  );
}
