import Link from 'next/link';
import { Activity, Clock3, RotateCcw, TriangleAlert } from 'lucide-react';
import { adminNav, EmptyState, StatCard, WorkspaceShell } from '@host/components/ProductShell';
import { ActionQueue, StatGrid } from '@host/components/admin/shared/AdminPrimitives';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import { getAdminWebhookDetailCopy, getAdminWebhooksCopy } from '@host/lib/admin-copy';
import type { AdminWorkerRuntimeStatus } from '@host/lib/admin-worker-operations';
import type { AdminTableQuery } from '@host/lib/table-query';
import type { AdminOutboxDetailView } from '@host/lib/admin-delivery';
import type { AdminOperationsSnapshot, AdminOutboxBulkPreview } from '@/lib/module-runtime';
import { cleanTableQuery, operationResultToast } from './OperationsPageUtils';
import { AdminWebhookDetailActions } from './WebhookDetailActions';
import { AdminWebhookDetailDrawer } from './WebhookDetailDrawer';
import { AdminWebhookDetailEvidence } from './WebhookDetailEvidence';
import { AdminWebhookDetailTables } from './WebhookDetailTables';
import { AdminWebhookDeliveryTables } from './WebhookDeliveryTables';
import { buildAdminWebhooksPageModel } from './WebhookPageModel';
import { AdminWebhookWorkerPanels } from './WebhookWorkerPanels';

type AdminFormAction = (formData: FormData) => void | Promise<void>;

export function AdminWebhooksOperationsPage({
  lang,
  snapshot,
  workerStatus,
  retryOutboxAction,
  discardOutboxAction,
  archiveOutboxAction,
  bulkReplayDeadLettersAction,
  bulkDiscardFailedOutboxAction,
  bulkArchiveProcessedOutboxAction,
  retryWebhookReceiptAction,
  bulkRetryFailedReceiptsAction,
  drainWorkerAction,
  bulkOutboxPreviews,
  query,
}: {
  lang: SupportedLanguage;
  snapshot: AdminOperationsSnapshot;
  workerStatus: AdminWorkerRuntimeStatus;
  bulkOutboxPreviews?: {
    replayDeadLetters: AdminOutboxBulkPreview;
    discardFailed: AdminOutboxBulkPreview;
    archiveProcessed: AdminOutboxBulkPreview;
  };
  retryOutboxAction: AdminFormAction;
  discardOutboxAction: AdminFormAction;
  archiveOutboxAction: AdminFormAction;
  bulkReplayDeadLettersAction: AdminFormAction;
  bulkDiscardFailedOutboxAction: AdminFormAction;
  bulkArchiveProcessedOutboxAction: AdminFormAction;
  retryWebhookReceiptAction: AdminFormAction;
  bulkRetryFailedReceiptsAction: AdminFormAction;
  drainWorkerAction: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminWebhooksCopy(lang);
  const {
    tableQuery,
    deadLetters,
    retryableReceipts,
    outboxByKind,
    previewRows,
    replayDeadLettersDisabled,
    discardFailedOutboxDisabled,
    archiveProcessedOutboxDisabled,
    workerAlertTone,
    outbox,
    receipts,
    deliveryReviewItems,
  } = buildAdminWebhooksPageModel({
    lang,
    snapshot,
    workerStatus,
    bulkOutboxPreviews,
    query,
  });
  const operationToast = operationResultToast(lang, tableQuery);

  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      <div className="grid gap-4">
        {operationToast}
        <StatGrid>
          <StatCard
            label={adminInlineText(lang, 'Outbox')}
            value={String(snapshot.counts.outbox)}
            helper={adminInlineText(lang, 'Delivery records')}
            tone="blue"
            icon={Activity}
          />
          <StatCard
            label={adminInlineText(lang, 'Dead Letters')}
            value={String(workerStatus.queue.deadLettered)}
            helper={adminInlineText(lang, 'Requires replay or discard')}
            tone={workerStatus.queue.deadLettered > 0 ? 'red' : 'neutral'}
            icon={TriangleAlert}
          />
          <StatCard
            label={adminInlineText(lang, 'Receipts')}
            value={String(snapshot.counts.webhookReceipts)}
            helper={adminInlineText(lang, 'Inbound webhook attempts')}
            icon={RotateCcw}
          />
          <StatCard
            label={adminInlineText(lang, 'Worker Alerts')}
            value={String(workerStatus.alerts.length)}
            helper={`${workerStatus.queue.lagMs}ms lag`}
            tone={workerAlertTone}
            icon={Clock3}
          />
        </StatGrid>

        {deliveryReviewItems.length > 0 ? (
          <ActionQueue
            lang={lang}
            title={adminInlineText(lang, 'Delivery review')}
            description={adminInlineText(
              lang,
              'Dead letters, failed deliveries, and retryable webhook receipts are promoted before full queue history.'
            )}
            status="warning"
            items={deliveryReviewItems}
          />
        ) : null}

        <AdminWebhookWorkerPanels
          lang={lang}
          workerStatus={workerStatus}
          previewRows={previewRows}
          outboxByKind={outboxByKind}
          replayDeadLettersDisabled={replayDeadLettersDisabled}
          discardFailedOutboxDisabled={discardFailedOutboxDisabled}
          archiveProcessedOutboxDisabled={archiveProcessedOutboxDisabled}
          retryFailedReceiptsDisabled={retryableReceipts.length === 0}
          drainWorkerAction={drainWorkerAction}
          bulkReplayDeadLettersAction={bulkReplayDeadLettersAction}
          bulkDiscardFailedOutboxAction={bulkDiscardFailedOutboxAction}
          bulkArchiveProcessedOutboxAction={bulkArchiveProcessedOutboxAction}
          bulkRetryFailedReceiptsAction={bulkRetryFailedReceiptsAction}
        />
        <AdminWebhookDeliveryTables
          lang={lang}
          tableQuery={tableQuery}
          outbox={outbox}
          receipts={receipts}
          deadLetters={deadLetters}
          snapshot={snapshot}
          retryOutboxAction={retryOutboxAction}
          discardOutboxAction={discardOutboxAction}
          archiveOutboxAction={archiveOutboxAction}
          retryWebhookReceiptAction={retryWebhookReceiptAction}
        />
      </div>
    </WorkspaceShell>
  );
}

export function AdminWebhookDetailOperationsPage({
  lang,
  detail,
  retryOutboxAction,
  discardOutboxAction,
  archiveOutboxAction,
  retryWebhookReceiptAction,
  query,
}: {
  lang: SupportedLanguage;
  detail: AdminOutboxDetailView;
  retryOutboxAction: AdminFormAction;
  discardOutboxAction: AdminFormAction;
  archiveOutboxAction: AdminFormAction;
  retryWebhookReceiptAction: AdminFormAction;
  query?: AdminTableQuery;
}) {
  const copy = getAdminWebhookDetailCopy(lang);
  const outbox = detail.outbox;
  const tableQuery = cleanTableQuery(query);
  const operationToast = operationResultToast(lang, tableQuery);
  return (
    <WorkspaceShell lang={lang} title={copy.title} subtitle={copy.subtitle} nav={adminNav}>
      {outbox ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            {operationToast}
            <StatGrid className="xl:grid-cols-3">
              <StatCard
                label={adminInlineText(lang, 'Status')}
                value={outbox.status}
                tone={
                  outbox.status === 'dead_letter' || outbox.status === 'failed' ? 'red' : 'blue'
                }
              />
              <StatCard
                label={adminInlineText(lang, 'Attempts')}
                value={String(outbox.attempts)}
                tone={outbox.attempts > 0 ? 'amber' : 'blue'}
              />
              <StatCard
                label={adminInlineText(lang, 'Module')}
                value={outbox.moduleId ?? 'host'}
                tone="amber"
              />
            </StatGrid>

            <AdminWebhookDetailActions
              lang={lang}
              outbox={outbox}
              retryOutboxAction={retryOutboxAction}
              discardOutboxAction={discardOutboxAction}
              archiveOutboxAction={archiveOutboxAction}
            />

            <AdminWebhookDetailEvidence lang={lang} outbox={outbox} />

            <AdminWebhookDetailTables
              lang={lang}
              detail={{ ...detail, outbox }}
              retryWebhookReceiptAction={retryWebhookReceiptAction}
            />
          </div>

          <AdminWebhookDetailDrawer lang={lang} outbox={outbox} />
        </div>
      ) : (
        <EmptyState title={copy.missingTitle}>{copy.missingBody}</EmptyState>
      )}
    </WorkspaceShell>
  );
}
