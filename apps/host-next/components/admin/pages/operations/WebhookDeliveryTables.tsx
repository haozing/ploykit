import Link from 'next/link';
import { ConfirmSubmitButton, DataTable, Input } from '@host/components/ui';
import { StatusBadge } from '@host/components/admin/shared/StatusBadge';
import {
  AdminPanel,
  FilterBar,
  MoreActionMenu,
  SegmentedWorkspace,
} from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineColumns, adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { AdminOperationsSnapshot } from '@/lib/module-runtime';
import {
  FilterResultHint,
  adminRelatedHref,
  outboxStatusOptions,
} from './OperationsPageUtils';
import type { AdminWebhooksPageModel } from './WebhookPageModel';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function AdminWebhookDeliveryTables({
  lang,
  tableQuery,
  outbox,
  receipts,
  deadLetters,
  snapshot,
  retryOutboxAction,
  discardOutboxAction,
  archiveOutboxAction,
  retryWebhookReceiptAction,
}: {
  lang: SupportedLanguage;
  tableQuery: Required<AdminTableQuery>;
  outbox: AdminWebhooksPageModel['outbox'];
  receipts: AdminWebhooksPageModel['receipts'];
  deadLetters: AdminWebhooksPageModel['deadLetters'];
  snapshot: AdminOperationsSnapshot;
  retryOutboxAction: AdminFormAction;
  discardOutboxAction: AdminFormAction;
  archiveOutboxAction: AdminFormAction;
  retryWebhookReceiptAction: AdminFormAction;
}) {
  return (
    <>
      <SegmentedWorkspace
        lang={lang}
        title={adminInlineText(lang, 'Delivery lanes')}
        description={adminInlineText(
          lang,
          'Outbox, receipts, and dead letters are split into separate lanes so the review queue does not blur delivery states together.'
        )}
        sections={[
          {
            key: 'webhook-outbox-lane',
            label: 'Outbox',
            count: outbox.length,
            content: (
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, ['Outbox', 'Status', 'Module', 'Updated'])}
                rows={outbox
                  .slice(0, 6)
                  .map((record) => [
                    record.name,
                    <StatusBadge key={`${record.id}:status`} lang={lang} value={record.status} />,
                    record.moduleId ?? 'host',
                    record.updatedAt,
                  ])}
                minWidthClass="min-w-[720px]"
                density="compact"
              />
            ),
          },
          {
            key: 'webhook-receipts-lane',
            label: 'Receipts',
            count: receipts.length,
            content: (
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, ['Receipt', 'Status', 'Module', 'Path'])}
                rows={receipts
                  .slice(0, 6)
                  .map((receipt) => [
                    receipt.webhookName,
                    <StatusBadge key={`${receipt.id}:status`} lang={lang} value={receipt.status} />,
                    receipt.moduleId,
                    `${receipt.method} ${receipt.path}`,
                  ])}
                minWidthClass="min-w-[720px]"
                density="compact"
              />
            ),
          },
          {
            key: 'webhook-dead-letters-lane',
            label: 'Dead letters',
            count: deadLetters.length,
            content: (
              <DataTable
                className="shadow-none"
                columns={adminInlineColumns(lang, ['Outbox', 'Module', 'Attempts', 'Error'])}
                rows={deadLetters
                  .slice(0, 6)
                  .map((record) => [
                    record.name,
                    record.moduleId ?? 'host',
                    String(record.attempts),
                    record.error?.message ?? 'dead letter',
                  ])}
                minWidthClass="min-w-[720px]"
                density="compact"
              />
            ),
          },
        ]}
      />
      <AdminPanel
        title={adminInlineText(lang, 'Delivery records')}
        description={adminInlineText(
          lang,
          'Search outbox and receipt records together. Row actions stay compact; payload evidence lives in detail.'
        )}
        contentClassName="p-0"
      >
        <FilterBar
          lang={lang}
          embedded
          searchValue={tableQuery.q}
          searchPlaceholder="搜索 outbox、receipt、模块、路径或状态"
          filterValue={tableQuery.status}
          filterOptions={outboxStatusOptions}
          resetHref={localizedPath(lang, '/admin/webhooks')}
        />
        <div className="px-4 py-3 sm:px-5">
          <FilterResultHint
            lang={lang}
            visible={outbox.length + receipts.length}
            total={snapshot.recent.outbox.length + snapshot.recent.webhookReceipts.length}
          />
        </div>
        <DataTable
          title={adminInlineText(lang, 'Outbox')}
          description={adminInlineText(
            lang,
            'Queued, processed, failed, and dead-letter delivery records.'
          )}
          className="rounded-none border-x-0 shadow-none"
          columns={adminInlineColumns(lang, ['Outbox', 'Module', 'Status', 'Attempts', 'Action'])}
          rows={outbox.map((record) => [
            <div key={`${record.id}:outbox`} className="min-w-0">
              <Link
                href={localizedPath(lang, `/admin/webhooks/${record.id}`)}
                className="block truncate font-semibold text-admin-primary hover:underline"
              >
                {record.name}
              </Link>
              <div className="mt-1 truncate text-xs text-admin-text-muted">{record.id}</div>
            </div>,
            record.moduleId ?? 'host',
            <StatusBadge key={`${record.id}:status`} lang={lang} value={record.status} />,
            String(record.attempts),
            <div key={`${record.id}:actions`} className="flex justify-end">
              <MoreActionMenu label={adminInlineText(lang, 'Actions')}>
                <Link
                  href={localizedPath(lang, `/admin/runs?q=${encodeURIComponent(record.id)}`)}
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                >
                  {adminInlineText(lang, 'Runs')}
                </Link>
                <Link
                  href={adminRelatedHref(lang, '/admin/runs', {
                    q: record.moduleId ?? record.name,
                    type: 'job',
                  })}
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                >
                  {adminInlineText(lang, 'Jobs')}
                </Link>
                <Link
                  href={adminRelatedHref(lang, '/admin/webhooks', { q: 'event:' })}
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-admin-primary"
                >
                  {adminInlineText(lang, 'Events')}
                </Link>
                <Link
                  href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(record.id)}`)}
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-admin-primary"
                >
                  {adminInlineText(lang, 'Audit')}
                </Link>
                <form
                  action={retryOutboxAction}
                  className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                >
                  <input type="hidden" name="outboxId" value={record.id} />
                  <Input
                    className="h-8 w-full"
                    name="reason"
                    placeholder={adminInlineText(lang, 'Retry reason')}
                    aria-label={adminInlineText(lang, 'Retry reason')}
                  />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    disabled={record.status === 'queued' || record.status === 'archived'}
                    confirmation={adminInlineText(lang, 'retry_outbox_value_d2601a72', {
                      value1: record.name,
                    })}
                  >
                    {adminInlineText(lang, 'Retry')}
                  </ConfirmSubmitButton>
                </form>
                <form
                  action={discardOutboxAction}
                  className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                >
                  <input type="hidden" name="outboxId" value={record.id} />
                  <Input
                    className="h-8 w-full"
                    name="reason"
                    placeholder={adminInlineText(lang, 'Discard reason')}
                    aria-label={adminInlineText(lang, 'Discard reason')}
                  />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    disabled={record.status === 'dead_letter' || record.status === 'archived'}
                    confirmation={adminInlineText(lang, 'discard_outbox_value_2d809397', {
                      value1: record.name,
                    })}
                  >
                    {adminInlineText(lang, 'Discard')}
                  </ConfirmSubmitButton>
                </form>
                <form
                  action={archiveOutboxAction}
                  className="grid gap-2 rounded-admin-md border border-admin-border bg-admin-bg/45 p-2"
                >
                  <input type="hidden" name="outboxId" value={record.id} />
                  <Input
                    className="h-8 w-full"
                    name="reason"
                    placeholder={adminInlineText(lang, 'Archive reason')}
                    aria-label={adminInlineText(lang, 'Archive reason')}
                  />
                  <ConfirmSubmitButton
                    type="submit"
                    className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                    disabled={record.status === 'archived'}
                    confirmation={adminInlineText(lang, 'archive_outbox_value_7c8a928b', {
                      value1: record.name,
                    })}
                  >
                    {adminInlineText(lang, 'Archive')}
                  </ConfirmSubmitButton>
                </form>
              </MoreActionMenu>
            </div>,
          ])}
          empty={adminInlineText(lang, 'No outbox records match this filter.')}
          minWidthClass="min-w-[900px]"
        />
        <DataTable
          title={adminInlineText(lang, 'Webhook receipts')}
          description={adminInlineText(lang, 'Inbound receipt status by module, method, and path.')}
          className="rounded-none border-x-0 border-b-0 shadow-none"
          columns={adminInlineColumns(lang, [
            'Receipt',
            'Module',
            'Status',
            'Method',
            'Path',
            'Action',
          ])}
          rows={receipts.map((receipt) => [
            receipt.webhookName,
            receipt.moduleId,
            <StatusBadge key={`${receipt.id}:status`} lang={lang} value={receipt.status} />,
            receipt.method,
            <span key={`${receipt.id}:path`} className="max-w-64 truncate text-admin-text-muted">
              {receipt.path}
            </span>,
            <div key={`${receipt.id}:action`} className="flex flex-wrap justify-end gap-2">
              <Link
                href={localizedPath(lang, `/admin/runs?q=${encodeURIComponent(receipt.id)}`)}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
              >
                {adminInlineText(lang, 'Runs')}
              </Link>
              <Link
                href={adminRelatedHref(lang, '/admin/runs', { q: receipt.moduleId, type: 'job' })}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-admin-primary"
              >
                {adminInlineText(lang, 'Jobs')}
              </Link>
              <Link
                href={adminRelatedHref(lang, '/admin/webhooks', { q: 'event:' })}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-admin-primary"
              >
                {adminInlineText(lang, 'Events')}
              </Link>
              <Link
                href={localizedPath(lang, `/admin/audit?q=${encodeURIComponent(receipt.id)}`)}
                className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-border bg-admin-surface px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-admin-primary"
              >
                {adminInlineText(lang, 'Audit')}
              </Link>
              <form action={retryWebhookReceiptAction} className="inline-flex">
                <input type="hidden" name="receiptId" value={receipt.id} />
                <Input
                  className="h-8 w-32"
                  name="reason"
                  placeholder={adminInlineText(lang, 'Reason')}
                  aria-label={adminInlineText(lang, 'Receipt retry reason')}
                />
                <ConfirmSubmitButton
                  type="submit"
                  className="inline-flex min-h-8 items-center justify-center rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 py-1.5 text-xs font-semibold text-admin-primary transition hover:bg-admin-primary/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50"
                  disabled={
                    receipt.status === 'received' ||
                    receipt.status === 'processing' ||
                    receipt.status === 'processed'
                  }
                  confirmation={adminInlineText(lang, 'retry_webhook_receipt_value_dee92adb', {
                    value1: receipt.webhookName,
                  })}
                >
                  {adminInlineText(lang, 'Retry')}
                </ConfirmSubmitButton>
              </form>
            </div>,
          ])}
          empty={adminInlineText(lang, 'No webhook receipts match this filter.')}
          minWidthClass="min-w-[900px]"
        />
      </AdminPanel>
    </>
  );
}
