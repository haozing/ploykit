import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/_core/env', () => ({
  env: {
    NODE_ENV: 'development',
  },
}));

vi.mock('@/lib/_core/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/cache', () => ({
  warmupCaches: vi.fn(),
}));

vi.mock('@/lib/jobs/core-jobs.server', () => ({
  registerCoreJobs: vi.fn(),
}));

vi.mock('@/lib/plugins/plugin-sync', () => ({
  syncPluginsToDatabase: vi.fn(),
}));

vi.mock('@/lib/reliability/init.server', () => ({
  initializeReliabilityRuntime: vi.fn(),
}));

vi.mock('@/lib/services/storage/init.server', () => ({
  initializeStorageRuntime: vi.fn(),
}));

vi.mock('@/lib/webhooks/handlers/subscription-handler', () => ({
  initSubscriptionHandlers: vi.fn(),
}));

vi.mock('@/lib/webhooks/init', () => ({
  initializeWebhooks: vi.fn(),
}));

import { warmupCaches } from '@/lib/cache';
import { env as envMock } from '@/lib/_core/env';
import { registerCoreJobs } from '@/lib/jobs/core-jobs.server';
import { syncPluginsToDatabase } from '@/lib/plugins/plugin-sync';
import { initializeReliabilityRuntime } from '@/lib/reliability/init.server';
import { initializeStorageRuntime } from '@/lib/services/storage/init.server';
import { initSubscriptionHandlers } from '@/lib/webhooks/handlers/subscription-handler';
import { initializeWebhooks } from '@/lib/webhooks/init';
import {
  __resetInitializationForTests,
  getInitializationStatus,
  initializeApplication,
} from '../init';

describe('lib/_core/init', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    envMock.NODE_ENV = 'development';
    __resetInitializationForTests();

    vi.mocked(initializeReliabilityRuntime).mockReturnValue({
      initialized: true,
      databaseConfigured: false,
      outboxStore: 'memory',
      outboxProcessorStarted: true,
      audit: {
        storage: 'memory',
        durable: false,
        redactsSensitiveDetails: true,
      },
      usage: {
        storage: 'memory',
        durable: false,
        idempotent: true,
        redactsSensitiveMetadata: true,
      },
    });
    vi.mocked(initializeStorageRuntime).mockReturnValue({
      enabled: false,
      initialized: false,
      adapterAvailable: false,
    });
    vi.mocked(initializeWebhooks).mockReturnValue(undefined);
    vi.mocked(initSubscriptionHandlers).mockReturnValue(undefined);
    vi.mocked(registerCoreJobs).mockReturnValue(undefined);
    vi.mocked(syncPluginsToDatabase).mockResolvedValue({
      total: 0,
      registered: 0,
      newlyAdded: 0,
    });
    vi.mocked(warmupCaches).mockResolvedValue(undefined);
  });

  it('records successful critical and warmup initialization', async () => {
    await initializeApplication();

    const status = getInitializationStatus();

    expect(status.overall).toBe('ok');
    expect(status.critical.reliability.status).toBe('ok');
    expect(status.critical.storage.status).toBe('ok');
    expect(status.critical.webhook.status).toBe('ok');
    expect(status.critical.subscription.status).toBe('ok');
    expect(status.critical.jobs.status).toBe('ok');
    expect(status.warmups.pluginSync.status).toBe('ok');
    expect(status.warmups.cache.status).toBe('ok');
  });

  it('marks warmup failures as degraded without blocking startup', async () => {
    vi.mocked(syncPluginsToDatabase).mockRejectedValueOnce(new Error('plugin sync failed'));

    await initializeApplication();

    const status = getInitializationStatus();

    expect(status.overall).toBe('degraded');
    expect(status.lastError?.step).toBe('pluginSync');
    expect(status.warmups.pluginSync.status).toBe('failed');
    expect(status.warmups.cache.status).toBe('ok');
  });

  it('does not repeat successful initialization steps after a development critical failure', async () => {
    vi.mocked(initializeWebhooks)
      .mockImplementationOnce(() => {
        throw new Error('webhook failed');
      })
      .mockReturnValue(undefined);

    await initializeApplication();

    expect(getInitializationStatus().overall).toBe('failed');
    expect(getInitializationStatus().critical.reliability.status).toBe('ok');
    expect(getInitializationStatus().critical.storage.status).toBe('ok');
    expect(getInitializationStatus().critical.webhook.status).toBe('failed');

    await initializeApplication();

    expect(initializeReliabilityRuntime).toHaveBeenCalledTimes(1);
    expect(initializeStorageRuntime).toHaveBeenCalledTimes(1);
    expect(initializeWebhooks).toHaveBeenCalledTimes(2);
    expect(initSubscriptionHandlers).toHaveBeenCalledTimes(1);
    expect(registerCoreJobs).toHaveBeenCalledTimes(1);
    expect(getInitializationStatus().overall).toBe('ok');
  });

  it('throws critical initialization errors in production', async () => {
    envMock.NODE_ENV = 'production';
    vi.mocked(initializeStorageRuntime).mockImplementationOnce(() => {
      throw new Error('storage failed');
    });

    await expect(initializeApplication()).rejects.toThrow('Storage runtime initialization failed');

    const status = getInitializationStatus();

    expect(status.overall).toBe('failed');
    expect(status.lastError?.step).toBe('storage');
  });

  it('returns a cloned status object', async () => {
    await initializeApplication();

    const status = getInitializationStatus();
    status.critical.reliability.status = 'failed';

    expect(getInitializationStatus().critical.reliability.status).toBe('ok');
  });
});
