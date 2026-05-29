import { AdminWebhooksOperationsPage } from '@host/components/admin/AdminPages';
import { createAdminAction } from '@host/lib/admin-action';
import { getAdminOperationsView } from '@host/lib/admin-operations';
import {
  archiveAdminOutbox,
  bulkArchiveAdminOutbox,
  bulkDiscardAdminOutbox,
  bulkReplayAdminDeadLetters,
  discardAdminOutbox,
  bulkRetryAdminWebhookReceipts,
  previewAdminOutboxBulkAction,
  retryAdminWebhookReceipt,
  retryAdminOutbox,
} from '@host/lib/admin-delivery';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { readLanguageAndRequireAdmin, type LanguageRouteParams } from '@host/lib/route-params';
import { readAdminTableQuery, type RouteSearchParams } from '@host/lib/table-query';
import { drainHostWorker, getHostWorkerStatus } from '@host/lib/worker';

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`ADMIN_FORM_FIELD_REQUIRED: ${name}`);
  }
  return value;
}

function readOptionalFormString(formData: FormData, name: string, fallback: string): string {
  const value = formData.get(name);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function operationResultHref(
  lang: SupportedLanguage,
  operation: string,
  input: {
    matched?: number;
    processed?: number;
    failed?: number;
    skipped?: number;
    deadLettered?: number;
  }
) {
  const processed = input.processed ?? 0;
  const failed = input.failed ?? 0;
  const deadLettered = input.deadLettered ?? 0;
  const matched = input.matched ?? processed + failed + deadLettered;
  const skipped = input.skipped ?? Math.max(0, matched - processed - failed - deadLettered);
  const params = new URLSearchParams({
    operation,
    outcome: failed > 0 || deadLettered > 0 ? 'warning' : 'success',
    matched: String(matched),
    processed: String(processed),
    failed: String(failed),
    skipped: String(skipped),
    deadLettered: String(deadLettered),
  });
  return `${localizedPath(lang, '/admin/webhooks')}?${params.toString()}`;
}

type BulkOutboxResult = Awaited<ReturnType<typeof bulkReplayAdminDeadLetters>>;
type BulkWebhookReceiptResult = Awaited<ReturnType<typeof bulkRetryAdminWebhookReceipts>>;
type WorkerDrainResult = Awaited<ReturnType<typeof drainHostWorker>>;

const retryOutboxAction = createAdminAction({
  id: 'webhooks.retryOutbox',
  parse: (formData) => ({
    outboxId: readRequiredFormString(formData, 'outboxId'),
    reason: readOptionalFormString(formData, 'reason', 'Retried from Admin Webhooks'),
  }),
  run: ({ session, input }) => retryAdminOutbox(session, input.outboxId, input.reason),
  revalidate: () => ['/admin/webhooks', '/admin'],
  redirect: ({ lang }) => operationResultHref(lang, 'outbox retry', { processed: 1 }),
  audit: { metadata: ({ input }) => input },
});

const discardOutboxAction = createAdminAction({
  id: 'webhooks.discardOutbox',
  parse: (formData) => ({
    outboxId: readRequiredFormString(formData, 'outboxId'),
    reason: readOptionalFormString(formData, 'reason', 'Discarded from Admin Webhooks'),
  }),
  run: ({ session, input }) => discardAdminOutbox(session, input.outboxId, input.reason),
  revalidate: () => ['/admin/webhooks', '/admin'],
  redirect: ({ lang }) => operationResultHref(lang, 'outbox discard', { processed: 1 }),
  audit: { metadata: ({ input }) => input },
});

const archiveOutboxAction = createAdminAction({
  id: 'webhooks.archiveOutbox',
  parse: (formData) => ({
    outboxId: readRequiredFormString(formData, 'outboxId'),
    reason: readOptionalFormString(formData, 'reason', 'Archived from Admin Webhooks'),
  }),
  run: ({ session, input }) => archiveAdminOutbox(session, input.outboxId, input.reason),
  revalidate: () => ['/admin/webhooks', '/admin'],
  redirect: ({ lang }) => operationResultHref(lang, 'outbox archive', { processed: 1 }),
  audit: { metadata: ({ input }) => input },
});

const bulkReplayDeadLettersAction = createAdminAction<
  { limit: number; reason: string },
  BulkOutboxResult
>({
  id: 'webhooks.bulkReplayDeadLetters',
  parse: (formData) => {
    const limitValue = Number(formData.get('limit') ?? 50);
    return {
      limit: Number.isFinite(limitValue) ? limitValue : 50,
      reason: readOptionalFormString(formData, 'reason', 'Bulk replayed dead-letter outbox'),
    };
  },
  run: ({ session, input }) => bulkReplayAdminDeadLetters(session, input),
  revalidate: () => ['/admin/webhooks', '/admin/runs', '/admin'],
  redirect: ({ lang, result }) =>
    operationResultHref(lang, 'dead-letter bulk replay', {
      matched: result?.matched,
      processed: result?.processed,
    }),
  audit: { metadata: ({ input, result }) => ({ ...input, result }) },
});

const bulkDiscardFailedOutboxAction = createAdminAction<
  { status: 'failed'; limit: number; reason: string },
  BulkOutboxResult
>({
  id: 'webhooks.bulkDiscardOutbox',
  parse: (formData) => {
    const limitValue = Number(formData.get('limit') ?? 50);
    return {
      status: 'failed' as const,
      limit: Number.isFinite(limitValue) ? limitValue : 50,
      reason: readOptionalFormString(formData, 'reason', 'Bulk discarded failed outbox'),
    };
  },
  run: ({ session, input }) => bulkDiscardAdminOutbox(session, input),
  revalidate: () => ['/admin/webhooks', '/admin'],
  redirect: ({ lang, result }) =>
    operationResultHref(lang, 'failed outbox bulk discard', {
      matched: result?.matched,
      processed: result?.processed,
    }),
  audit: { metadata: ({ input, result }) => ({ ...input, result }) },
});

const bulkArchiveProcessedOutboxAction = createAdminAction<
  { status: 'processed'; limit: number; reason: string },
  BulkOutboxResult
>({
  id: 'webhooks.bulkArchiveOutbox',
  parse: (formData) => {
    const limitValue = Number(formData.get('limit') ?? 50);
    return {
      status: 'processed' as const,
      limit: Number.isFinite(limitValue) ? limitValue : 50,
      reason: readOptionalFormString(formData, 'reason', 'Bulk archived processed outbox'),
    };
  },
  run: ({ session, input }) => bulkArchiveAdminOutbox(session, input),
  revalidate: () => ['/admin/webhooks', '/admin'],
  redirect: ({ lang, result }) =>
    operationResultHref(lang, 'processed outbox bulk archive', {
      matched: result?.matched,
      processed: result?.processed,
    }),
  audit: { metadata: ({ input, result }) => ({ ...input, result }) },
});

const retryWebhookReceiptAction = createAdminAction({
  id: 'webhooks.retryReceipt',
  parse: (formData) => ({
    receiptId: readRequiredFormString(formData, 'receiptId'),
    reason: readOptionalFormString(formData, 'reason', 'Retried from Admin Webhooks'),
  }),
  run: ({ session, input }) => retryAdminWebhookReceipt(session, input.receiptId, input.reason),
  revalidate: () => ['/admin/webhooks', '/admin'],
  redirect: ({ lang }) => operationResultHref(lang, 'webhook receipt retry', { processed: 1 }),
  audit: { metadata: ({ input }) => input },
});

const bulkRetryFailedReceiptsAction = createAdminAction<
  { status: 'failed'; limit: number; reason: string },
  BulkWebhookReceiptResult
>({
  id: 'webhooks.bulkRetryReceipts',
  parse: (formData) => {
    const limitValue = Number(formData.get('limit') ?? 50);
    return {
      status: 'failed' as const,
      limit: Number.isFinite(limitValue) ? limitValue : 50,
      reason: readOptionalFormString(formData, 'reason', 'Bulk retried failed webhook receipts'),
    };
  },
  run: ({ session, input }) => bulkRetryAdminWebhookReceipts(session, input),
  revalidate: () => ['/admin/webhooks', '/admin'],
  redirect: ({ lang, result }) =>
    operationResultHref(lang, 'failed receipts bulk retry', {
      matched: result?.matched,
      processed: result?.processed,
    }),
  audit: { metadata: ({ input, result }) => ({ ...input, result }) },
});

const drainWorkerAction = createAdminAction<{ limit: number }, WorkerDrainResult>({
  id: 'webhooks.drainWorker',
  parse: (formData) => {
    const limitValue = Number(formData.get('limit') ?? 25);
    return {
      limit: Number.isFinite(limitValue) ? limitValue : 25,
    };
  },
  run: ({ session, input }) => drainHostWorker({ session, limit: input.limit }),
  revalidate: () => ['/admin/webhooks', '/admin/runs', '/admin'],
  redirect: ({ lang, result }) =>
    operationResultHref(lang, 'worker drain', {
      matched: result?.records.length,
      processed: result?.processed,
      failed: result?.failed,
      deadLettered: result?.deadLettered,
    }),
  audit: { metadata: ({ input, result }) => ({ ...input, result }) },
});

export default async function AdminWebhooksPage({
  params,
  searchParams,
}: {
  params: Promise<LanguageRouteParams>;
  searchParams?: Promise<RouteSearchParams>;
}) {
  const [lang, session] = await readLanguageAndRequireAdmin(params, '/admin/webhooks');
  const query = await readAdminTableQuery(searchParams);
  const [view, workerStatus, replayPreview, discardPreview, archivePreview] = await Promise.all([
    getAdminOperationsView(),
    getHostWorkerStatus(),
    previewAdminOutboxBulkAction(session, {
      action: 'replay',
      status: 'dead_letter',
      limit: 50,
    }),
    previewAdminOutboxBulkAction(session, {
      action: 'discard',
      status: 'failed',
      limit: 50,
    }),
    previewAdminOutboxBulkAction(session, {
      action: 'archive',
      status: 'processed',
      limit: 50,
    }),
  ]);
  return (
    <AdminWebhooksOperationsPage
      lang={lang}
      snapshot={view.snapshot}
      workerStatus={workerStatus}
      bulkOutboxPreviews={{
        replayDeadLetters: replayPreview,
        discardFailed: discardPreview,
        archiveProcessed: archivePreview,
      }}
      retryOutboxAction={retryOutboxAction}
      discardOutboxAction={discardOutboxAction}
      archiveOutboxAction={archiveOutboxAction}
      bulkReplayDeadLettersAction={bulkReplayDeadLettersAction}
      bulkDiscardFailedOutboxAction={bulkDiscardFailedOutboxAction}
      bulkArchiveProcessedOutboxAction={bulkArchiveProcessedOutboxAction}
      retryWebhookReceiptAction={retryWebhookReceiptAction}
      bulkRetryFailedReceiptsAction={bulkRetryFailedReceiptsAction}
      drainWorkerAction={drainWorkerAction}
      query={query}
    />
  );
}
