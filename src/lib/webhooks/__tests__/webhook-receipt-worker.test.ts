import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS,
  isWebhookReceiptProcessingStale,
  processWebhookReceipt,
} from '../webhook-receipt-worker';
import type {
  WebhookReceiptRecord,
  WebhookReceiptWorkerDependencies,
} from '../webhook-receipt-worker';

function createReceipt(overrides?: Partial<WebhookReceiptRecord>): WebhookReceiptRecord {
  return {
    id: 'webhook-log-1',
    provider: 'stripe',
    eventId: 'evt_1',
    eventType: 'invoice.payment_succeeded',
    payload: {
      id: 'evt_1',
      type: 'invoice.payment_succeeded',
    },
    signature: 'sig_1',
    headers: {
      signature: 'sig_1',
    },
    status: 'received',
    retryCount: 0,
    createdAt: new Date('2026-05-09T00:00:00Z'),
    updatedAt: new Date('2026-05-09T00:00:00Z'),
    ...overrides,
  };
}

function createDeps(receipt: WebhookReceiptRecord): WebhookReceiptWorkerDependencies {
  return {
    getLog: vi.fn().mockResolvedValue(receipt),
    updateLog: vi.fn().mockResolvedValue(undefined),
    logRetry: vi.fn().mockResolvedValue(undefined),
    process: vi.fn().mockResolvedValue({
      success: true,
      events: ['billing.payment.succeeded'],
      processingTime: 3,
    }),
    processPlugin: vi.fn().mockResolvedValue({
      success: true,
      events: ['runtime-webhook.webhook.ingest'],
      processingTime: 3,
    }),
  };
}

describe('webhook receipt worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes a durable receipt and marks it processed', async () => {
    const deps = createDeps(createReceipt());

    const result = await processWebhookReceipt('webhook-log-1', { deps });

    expect(result.success).toBe(true);
    expect(deps.updateLog).toHaveBeenNthCalledWith(1, 'webhook-log-1', 'processing', {
      retryCount: 1,
    });
    expect(deps.process).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'stripe',
        event: expect.objectContaining({ id: 'evt_1' }),
        headers: { signature: 'sig_1' },
      }),
      { log: false }
    );
    expect(deps.updateLog).toHaveBeenNthCalledWith(
      2,
      'webhook-log-1',
      'processed',
      expect.objectContaining({
        internalEvents: ['billing.payment.succeeded'],
        retryCount: 1,
      })
    );
    expect(deps.logRetry).toHaveBeenCalledWith('webhook-log-1', 1, 'success');
  });

  it('marks a receipt failed and records retry metadata when processing fails', async () => {
    const deps = createDeps(createReceipt({ retryCount: 1 }));
    vi.mocked(deps.process).mockResolvedValueOnce({
      success: false,
      events: [],
      processingTime: 4,
      error: 'handler failed',
    });

    const result = await processWebhookReceipt('webhook-log-1', { deps });

    expect(result.success).toBe(false);
    expect(result.error).toBe('handler failed');
    expect(deps.updateLog).toHaveBeenNthCalledWith(1, 'webhook-log-1', 'processing', {
      retryCount: 2,
    });
    expect(deps.updateLog).toHaveBeenNthCalledWith(
      2,
      'webhook-log-1',
      'failed',
      expect.objectContaining({
        error: 'handler failed',
        retryCount: 2,
      })
    );
    expect(deps.logRetry).toHaveBeenCalledWith('webhook-log-1', 2, 'failed', 'handler failed');
  });

  it('skips receipts that are already processed', async () => {
    const deps = createDeps(createReceipt({ status: 'processed', retryCount: 2 }));

    const result = await processWebhookReceipt('webhook-log-1', { deps });

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        skipped: true,
        attempt: 2,
      })
    );
    expect(deps.process).not.toHaveBeenCalled();
    expect(deps.updateLog).not.toHaveBeenCalled();
  });

  it('skips processing receipts until their lock is stale', async () => {
    const deps = createDeps(
      createReceipt({
        status: 'processing',
        retryCount: 1,
        updatedAt: new Date(),
      })
    );

    const result = await processWebhookReceipt('webhook-log-1', { deps });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        skipped: true,
        attempt: 1,
        error: 'Webhook receipt is already processing',
      })
    );
    expect(deps.process).not.toHaveBeenCalled();
    expect(deps.updateLog).not.toHaveBeenCalled();
  });

  it('retries stale processing receipts instead of leaving them stuck', async () => {
    const deps = createDeps(
      createReceipt({
        status: 'processing',
        retryCount: 1,
        updatedAt: new Date(Date.now() - DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS - 1_000),
      })
    );

    const result = await processWebhookReceipt('webhook-log-1', { deps });

    expect(result.success).toBe(true);
    expect(deps.updateLog).toHaveBeenNthCalledWith(1, 'webhook-log-1', 'processing', {
      retryCount: 2,
    });
    expect(deps.process).toHaveBeenCalled();
    expect(deps.logRetry).toHaveBeenCalledWith('webhook-log-1', 2, 'success');
  });

  it('routes plugin webhook receipts back through the plugin runtime replay path', async () => {
    const deps = createDeps(
      createReceipt({
        provider: 'custom',
        eventType: 'runtime-webhook.webhook',
        payload: {
          raw: '{"id":"evt_plugin_1"}',
          pluginRuntime: {
            pluginId: 'runtime-webhook',
            webhook: 'ingest',
            localPath: '/ingest',
            method: 'POST',
            handler: './webhooks/ingest',
            verified: true,
          },
        },
        headers: {
          'content-type': 'application/json',
        },
      })
    );

    const result = await processWebhookReceipt('webhook-log-1', { deps });

    expect(result.success).toBe(true);
    expect(deps.process).not.toHaveBeenCalled();
    expect(deps.processPlugin).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'webhook-log-1',
        eventType: 'runtime-webhook.webhook',
      })
    );
    expect(deps.updateLog).toHaveBeenNthCalledWith(
      2,
      'webhook-log-1',
      'processed',
      expect.objectContaining({
        internalEvents: ['runtime-webhook.webhook.ingest'],
        retryCount: 1,
      })
    );
  });

  it('skips receipts that exceeded max attempts', async () => {
    const deps = createDeps(createReceipt({ status: 'failed', retryCount: 5 }));

    const result = await processWebhookReceipt('webhook-log-1', { deps, maxAttempts: 5 });

    expect(result).toEqual(
      expect.objectContaining({
        success: false,
        skipped: true,
        attempt: 5,
        error: 'Webhook receipt exceeded max attempts (5)',
      })
    );
    expect(deps.process).not.toHaveBeenCalled();
    expect(deps.updateLog).toHaveBeenCalledWith('webhook-log-1', 'dead_letter', {
      error: 'Webhook receipt exceeded max attempts (5)',
      retryCount: 5,
    });
  });

  it('moves a receipt to dead letter on the final failed attempt', async () => {
    const deps = createDeps(createReceipt({ retryCount: 4 }));
    vi.mocked(deps.process).mockResolvedValueOnce({
      success: false,
      events: [],
      processingTime: 4,
      error: 'still failing',
    });

    const result = await processWebhookReceipt('webhook-log-1', { deps, maxAttempts: 5 });

    expect(result.success).toBe(false);
    expect(deps.updateLog).toHaveBeenNthCalledWith(
      2,
      'webhook-log-1',
      'dead_letter',
      expect.objectContaining({
        error: 'still failing',
        retryCount: 5,
      })
    );
    expect(deps.logRetry).toHaveBeenCalledWith('webhook-log-1', 5, 'dead_letter', 'still failing');
  });

  it('detects stale processing locks from updatedAt or createdAt', () => {
    const nowMs = new Date('2026-05-09T00:20:00Z').getTime();

    expect(
      isWebhookReceiptProcessingStale(
        {
          status: 'processing',
          createdAt: new Date('2026-05-09T00:00:00Z'),
          updatedAt: null,
        },
        DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS,
        nowMs
      )
    ).toBe(true);
    expect(
      isWebhookReceiptProcessingStale(
        {
          status: 'processing',
          createdAt: new Date('2026-05-09T00:00:00Z'),
          updatedAt: new Date('2026-05-09T00:15:00Z'),
        },
        DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS,
        nowMs
      )
    ).toBe(false);
    expect(
      isWebhookReceiptProcessingStale(
        {
          status: 'failed',
          createdAt: new Date('2026-05-09T00:00:00Z'),
          updatedAt: new Date('2026-05-09T00:00:00Z'),
        },
        DEFAULT_WEBHOOK_PROCESSING_TIMEOUT_MS,
        nowMs
      )
    ).toBe(false);
  });
});
