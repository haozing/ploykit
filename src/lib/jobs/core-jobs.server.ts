import { getJob, registerJob } from './job-registry';

let registered = false;

export interface WebhookReceiptsRetryPayload {
  limit?: number;
  maxAttempts?: number;
}

export const CORE_JOB_NAMES = {
  webhookReceiptsRetry: 'webhooks.receipts.retry',
  fileDeletesCleanup: 'files.deletes.cleanup',
  pluginFilesExpire: 'plugins.files.expire',
  creditReconciliation: 'billing.credit.reconcile',
} as const;

/**
 * Register platform-owned background jobs.
 *
 * Handlers use dynamic imports so registration itself stays lightweight during
 * runtime reconcile and app startup.
 */
export function registerCoreJobs(): void {
  if (
    registered &&
    getJob(CORE_JOB_NAMES.webhookReceiptsRetry) &&
    getJob(CORE_JOB_NAMES.fileDeletesCleanup) &&
    getJob(CORE_JOB_NAMES.pluginFilesExpire) &&
    getJob(CORE_JOB_NAMES.creditReconciliation)
  ) {
    return;
  }

  if (!getJob(CORE_JOB_NAMES.webhookReceiptsRetry)) {
    registerJob<WebhookReceiptsRetryPayload>({
      name: CORE_JOB_NAMES.webhookReceiptsRetry,
      description: 'Retry pending durable webhook receipts',
      priority: 'critical',
      maxRetries: 2,
      retryDelayMs: 1000,
      timeoutMs: 30_000,
      handler: async (payload = {}) => {
        const { retryPendingWebhookReceipts } = await import('@/lib/webhooks');
        await retryPendingWebhookReceipts(payload);
      },
    });
  }

  if (!getJob(CORE_JOB_NAMES.fileDeletesCleanup)) {
    registerJob<{ limit?: number; userId?: string }>({
      name: CORE_JOB_NAMES.fileDeletesCleanup,
      description: 'Retry pending file blob and metadata deletes',
      priority: 'critical',
      maxRetries: 2,
      retryDelayMs: 1000,
      timeoutMs: 60_000,
      handler: async (payload = {}) => {
        const { cleanupPendingFileDeletes } = await import(
          '@/lib/services/storage/file-storage-service'
        );
        await cleanupPendingFileDeletes(payload);
      },
    });
  }

  if (!getJob(CORE_JOB_NAMES.pluginFilesExpire)) {
    registerJob<{ limit?: number; pluginId?: string }>({
      name: CORE_JOB_NAMES.pluginFilesExpire,
      description: 'Expire and clean up temporary plugin files',
      priority: 'critical',
      maxRetries: 2,
      retryDelayMs: 1000,
      timeoutMs: 60_000,
      handler: async (payload = {}) => {
        const { cleanupExpiredPluginFiles } = await import(
          '@/lib/plugin-runtime/files/plugin-file-cleanup.server'
        );
        await cleanupExpiredPluginFiles(payload);
      },
    });
  }

  if (!getJob(CORE_JOB_NAMES.creditReconciliation)) {
    registerJob<Record<string, never>>({
      name: CORE_JOB_NAMES.creditReconciliation,
      description: 'Reconcile immutable credit ledger balances against entitlement balances',
      priority: 'critical',
      maxRetries: 0,
      retryDelayMs: 0,
      timeoutMs: 60_000,
      handler: async () => {
        const { runCreditReconciliation } = await import(
          '@/lib/services/billing/credit-log-service'
        );
        await runCreditReconciliation();
      },
    });
  }

  registered = true;
}

export function resetCoreJobsForTests(): void {
  registered = false;
}
