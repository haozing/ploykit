import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CORE_JOB_NAMES, registerCoreJobs, resetCoreJobsForTests } from '../core-jobs.server';
import { clearJobRegistry, getJob, getJobRegistryStats, runJob } from '../job-registry';

const { cleanupExpiredPluginFiles, retryPendingWebhookReceipts } = vi.hoisted(() => ({
  cleanupExpiredPluginFiles: vi.fn(),
  retryPendingWebhookReceipts: vi.fn(),
}));

vi.mock('@/lib/webhooks', () => ({
  retryPendingWebhookReceipts,
}));

vi.mock('@/lib/plugin-runtime/files/plugin-file-cleanup.server', () => ({
  cleanupExpiredPluginFiles,
}));

describe('core jobs', () => {
  beforeEach(() => {
    clearJobRegistry();
    resetCoreJobsForTests();
    cleanupExpiredPluginFiles.mockReset();
    retryPendingWebhookReceipts.mockReset();
  });

  it('registers critical platform jobs idempotently', () => {
    registerCoreJobs();
    registerCoreJobs();

    const webhookRetry = getJob(CORE_JOB_NAMES.webhookReceiptsRetry);
    const fileDeleteCleanup = getJob(CORE_JOB_NAMES.fileDeletesCleanup);
    const pluginFilesExpire = getJob(CORE_JOB_NAMES.pluginFilesExpire);
    const creditReconciliation = getJob(CORE_JOB_NAMES.creditReconciliation);

    expect(webhookRetry).toMatchObject({
      name: CORE_JOB_NAMES.webhookReceiptsRetry,
      priority: 'critical',
    });
    expect(fileDeleteCleanup).toMatchObject({
      name: CORE_JOB_NAMES.fileDeletesCleanup,
      priority: 'critical',
    });
    expect(pluginFilesExpire).toMatchObject({
      name: CORE_JOB_NAMES.pluginFilesExpire,
      priority: 'critical',
    });
    expect(creditReconciliation).toMatchObject({
      name: CORE_JOB_NAMES.creditReconciliation,
      priority: 'critical',
    });
    expect(getJobRegistryStats()).toMatchObject({
      jobs: 4,
      criticalJobs: 4,
    });
  });

  it('passes webhook retry payload to the worker', async () => {
    retryPendingWebhookReceipts.mockResolvedValueOnce([]);
    registerCoreJobs();

    await runJob(CORE_JOB_NAMES.webhookReceiptsRetry, { limit: 10, maxAttempts: 3 });

    expect(retryPendingWebhookReceipts).toHaveBeenCalledWith({ limit: 10, maxAttempts: 3 });
  });

  it('passes plugin file expiry cleanup payload to the worker', async () => {
    cleanupExpiredPluginFiles.mockResolvedValueOnce({
      scanned: 1,
      deleted: 1,
      failed: 0,
      reclaimedBytes: 5,
    });
    registerCoreJobs();

    await runJob(CORE_JOB_NAMES.pluginFilesExpire, { limit: 20, pluginId: 'demo-plugin' });

    expect(cleanupExpiredPluginFiles).toHaveBeenCalledWith({
      limit: 20,
      pluginId: 'demo-plugin',
    });
  });
});
