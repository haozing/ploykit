import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { AdminWorkerRuntimeStatus } from '@host/lib/admin-worker-operations';
import type { AdminTableQuery } from '@host/lib/table-query';
import type {
  AdminOperationsSnapshot,
  AdminOutboxBulkPreview,
} from '@host/lib/admin/operations-center';
import type {
  RuntimeStoreOutboxRecord,
  RuntimeStoreWebhookReceipt,
} from '@/lib/module-runtime';
import {
  cleanTableQuery,
  matchesExactFilter,
  matchesTextSearch,
  outboxKind,
} from './OperationsPageUtils';

export type AdminWebhookOutboxKind = 'job' | 'event' | 'webhook' | 'email' | 'other';
export type AdminWebhookWorkerTone = 'red' | 'amber' | 'blue';
export type AdminWebhookReviewTone = 'danger' | 'warning';

export interface AdminWebhookBulkPreviewRow {
  label: string;
  impact: string;
  modules: string;
  oldest: string;
}

export interface AdminWebhookReviewItem {
  key: string;
  title: string;
  description: string;
  actionLabel: string;
  href: string;
  status: string;
  tone: AdminWebhookReviewTone;
}

export interface AdminWebhooksPageModel {
  tableQuery: Required<AdminTableQuery>;
  deadLetters: RuntimeStoreOutboxRecord[];
  failedOutbox: RuntimeStoreOutboxRecord[];
  processedOutbox: RuntimeStoreOutboxRecord[];
  retryableReceipts: RuntimeStoreWebhookReceipt[];
  outboxByKind: Record<AdminWebhookOutboxKind, number>;
  previewRows: AdminWebhookBulkPreviewRow[];
  replayDeadLettersDisabled: boolean;
  discardFailedOutboxDisabled: boolean;
  archiveProcessedOutboxDisabled: boolean;
  workerAlertTone: AdminWebhookWorkerTone;
  outbox: RuntimeStoreOutboxRecord[];
  receipts: RuntimeStoreWebhookReceipt[];
  deliveryReviewItems: AdminWebhookReviewItem[];
}

function buildPreviewRows(
  lang: SupportedLanguage,
  bulkOutboxPreviews?: {
    replayDeadLetters: AdminOutboxBulkPreview;
    discardFailed: AdminOutboxBulkPreview;
    archiveProcessed: AdminOutboxBulkPreview;
  }
): AdminWebhookBulkPreviewRow[] {
  return bulkOutboxPreviews
    ? (
        [
          [adminInlineText(lang, 'Replay Dead Letters'), bulkOutboxPreviews.replayDeadLetters],
          [adminInlineText(lang, 'Discard Failed'), bulkOutboxPreviews.discardFailed],
          [adminInlineText(lang, 'Archive Processed'), bulkOutboxPreviews.archiveProcessed],
        ] as [string, AdminOutboxBulkPreview][]
      ).map(([label, value]) => ({
        label,
        impact: `${value.selected}/${value.matched}`,
        modules:
          Object.entries(value.impact.byModule)
            .map(([moduleId, count]) => `${moduleId}:${count}`)
            .join(', ') || 'none',
        oldest: value.impact.oldestCreatedAt ?? 'none',
      }))
    : [];
}

function countOutboxByKind(records: readonly RuntimeStoreOutboxRecord[]) {
  return records.reduce<Record<AdminWebhookOutboxKind, number>>(
    (acc, record) => {
      acc[outboxKind(record)] += 1;
      return acc;
    },
    { job: 0, event: 0, webhook: 0, email: 0, other: 0 }
  );
}

function buildDeliveryReviewItems(input: {
  lang: SupportedLanguage;
  deadLetters: readonly RuntimeStoreOutboxRecord[];
  failedOutbox: readonly RuntimeStoreOutboxRecord[];
  retryableReceipts: readonly RuntimeStoreWebhookReceipt[];
}): AdminWebhookReviewItem[] {
  return [
    ...input.deadLetters.slice(0, 2).map((record) => ({
      key: `dead:${record.id}`,
      title: record.name,
      description: `${record.moduleId ?? 'host'} delivery is in dead letter state after ${record.attempts} attempts.`,
      actionLabel: 'Open outbox',
      href: localizedPath(input.lang, `/admin/webhooks/${record.id}`),
      status: record.status,
      tone: 'danger' as const,
    })),
    ...input.failedOutbox.slice(0, 2).map((record) => ({
      key: `failed:${record.id}`,
      title: record.name,
      description: `${record.moduleId ?? 'host'} delivery failed and can be retried or discarded after inspection.`,
      actionLabel: 'Inspect failure',
      href: localizedPath(input.lang, `/admin/webhooks/${record.id}`),
      status: record.status,
      tone: 'danger' as const,
    })),
    ...input.retryableReceipts.slice(0, 2).map((receipt) => ({
      key: `receipt:${receipt.id}`,
      title: receipt.webhookName,
      description: `${receipt.method} ${receipt.path} failed for ${receipt.moduleId}. Retry only after checking signature and payload evidence.`,
      actionLabel: 'Review receipt',
      href: localizedPath(input.lang, '/admin/webhooks'),
      status: receipt.status,
      tone: 'warning' as const,
    })),
  ].slice(0, 4);
}

export function buildAdminWebhooksPageModel(input: {
  lang: SupportedLanguage;
  snapshot: AdminOperationsSnapshot;
  workerStatus: AdminWorkerRuntimeStatus;
  bulkOutboxPreviews?: {
    replayDeadLetters: AdminOutboxBulkPreview;
    discardFailed: AdminOutboxBulkPreview;
    archiveProcessed: AdminOutboxBulkPreview;
  };
  query?: AdminTableQuery;
}): AdminWebhooksPageModel {
  const tableQuery = cleanTableQuery(input.query);
  const deadLetters = input.snapshot.recent.outbox.filter(
    (record) => record.status === 'dead_letter'
  );
  const failedOutbox = input.snapshot.recent.outbox.filter(
    (record) => record.status === 'failed'
  );
  const processedOutbox = input.snapshot.recent.outbox.filter(
    (record) => record.status === 'processed'
  );
  const retryableReceipts = input.snapshot.recent.webhookReceipts.filter(
    (record) => record.status === 'failed'
  );
  const outbox = input.snapshot.recent.outbox.filter(
    (record) =>
      matchesTextSearch(tableQuery.q, [
        record.id,
        record.name,
        record.moduleId ?? 'host',
        record.status,
        record.attempts,
      ]) && matchesExactFilter(tableQuery.status, record.status)
  );
  const receipts = input.snapshot.recent.webhookReceipts.filter(
    (receipt) =>
      matchesTextSearch(tableQuery.q, [
        receipt.id,
        receipt.webhookName,
        receipt.moduleId,
        receipt.status,
        receipt.method,
        receipt.path,
      ]) && matchesExactFilter(tableQuery.status, receipt.status)
  );

  return {
    tableQuery,
    deadLetters,
    failedOutbox,
    processedOutbox,
    retryableReceipts,
    outboxByKind: countOutboxByKind(input.snapshot.recent.outbox),
    previewRows: buildPreviewRows(input.lang, input.bulkOutboxPreviews),
    replayDeadLettersDisabled: input.bulkOutboxPreviews
      ? input.bulkOutboxPreviews.replayDeadLetters.selected === 0
      : input.workerStatus.queue.deadLettered === 0 && deadLetters.length === 0,
    discardFailedOutboxDisabled: input.bulkOutboxPreviews
      ? input.bulkOutboxPreviews.discardFailed.selected === 0
      : failedOutbox.length === 0,
    archiveProcessedOutboxDisabled: input.bulkOutboxPreviews
      ? input.bulkOutboxPreviews.archiveProcessed.selected === 0
      : processedOutbox.length === 0,
    workerAlertTone: input.workerStatus.alerts.some((alert) => alert.severity === 'error')
      ? 'red'
      : input.workerStatus.alerts.length > 0
        ? 'amber'
        : 'blue',
    outbox,
    receipts,
    deliveryReviewItems: buildDeliveryReviewItems({
      lang: input.lang,
      deadLetters,
      failedOutbox,
      retryableReceipts,
    }),
  };
}
