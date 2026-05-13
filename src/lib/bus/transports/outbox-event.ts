/**
 * Outbox Event Transport
 *
 * Durable event transport for critical events.
 * Persists events before acknowledging, then processes asynchronously.
 *
 * Phase 1: In-memory implementation with retry
 * Phase 2: Database-backed with event_outbox table
 *
 * Design:
 * - Events are queued with metadata
 * - A background processor dispatches to actual handlers
 * - Failed events are retried with exponential backoff
 * - Maximum retries prevent infinite loops
 */

import { logger } from '@/lib/_core/logger';
import { calculateDelay, defaultRetryPolicy } from '@/lib/jobs/retry-policy';
import type { RetryPolicy } from '@/lib/jobs/retry-policy';
import type { EventTransport, EventHandler, EventMetadata } from './types';
import { LocalEventTransport } from './local-event';
import {
  MemoryOutboxStore,
  type OutboxEntry,
  type OutboxStats,
  type OutboxStore,
} from './outbox-store';

export interface OutboxOptions {
  /** Max retry attempts before marking as failed */
  maxRetries?: number;
  /** Retry policy for failed events */
  retryPolicy?: RetryPolicy;
  /** Interval between outbox processing polls (ms) */
  pollIntervalMs?: number;
  /** Whether to start the background processor automatically */
  autoStart?: boolean;
  /** Whether send() should trigger an immediate processing attempt */
  processImmediately?: boolean;
  /** Durable store implementation. Defaults to in-memory store. */
  store?: OutboxStore;
}

/**
 * Generate a simple ID for outbox entries
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Outbox Event Transport
 *
 * Wraps a local transport with durability guarantees.
 * Critical events are persisted before being processed.
 */
export class OutboxEventTransport implements EventTransport {
  private store: OutboxStore;
  private innerTransport: LocalEventTransport;
  private options: Required<Omit<OutboxOptions, 'store'>>;
  private processorInterval: ReturnType<typeof setInterval> | null = null;
  private isProcessing = false;

  constructor(options: OutboxOptions = {}) {
    this.options = {
      maxRetries: options.maxRetries ?? defaultRetryPolicy.maxRetries,
      retryPolicy: options.retryPolicy ?? defaultRetryPolicy,
      pollIntervalMs: options.pollIntervalMs ?? 5000,
      autoStart: options.autoStart ?? true,
      processImmediately: options.processImmediately ?? options.autoStart ?? true,
    };

    this.store = options.store ?? new MemoryOutboxStore();
    this.innerTransport = new LocalEventTransport({
      awaitHandlers: true,
      failOnHandlerError: true,
    });

    if (this.options.autoStart) {
      this.startProcessor();
    }
  }

  /**
   * Queue an event to the outbox
   */
  async send(event: string, payload: unknown, metadata: EventMetadata): Promise<void> {
    const entry: OutboxEntry = {
      id: generateId(),
      event,
      payload,
      metadata,
      status: 'pending',
      attempts: 0,
      maxAttempts: this.options.maxRetries,
      nextAttemptAt: new Date(),
      createdAt: new Date(),
    };

    await this.store.enqueue(entry);

    logger.info(
      {
        event,
        entryId: entry.id,
        emitterId: metadata.emitterId,
        eventId: metadata.eventId,
        correlationId: metadata.correlationId,
        idempotencyKey: metadata.idempotencyKey,
      },
      'Critical event queued to outbox'
    );

    if (this.options.processImmediately) {
      void this.processOutbox();
    }
  }

  /**
   * Subscribe a handler to an event
   * Delegates to the inner transport
   */
  subscribe(event: string, pluginId: string, handler: EventHandler): void {
    this.innerTransport.subscribe(event, pluginId, handler);
  }

  /**
   * Unsubscribe a handler
   */
  unsubscribe(event: string, pluginId: string, handler: EventHandler): void {
    this.innerTransport.unsubscribe(event, pluginId, handler);
  }

  getSubscribers(event: string): string[] {
    return this.innerTransport.getSubscribers(event);
  }

  removePluginEventSubscriptions(pluginId: string, event: string): void {
    this.innerTransport.removePluginEventSubscriptions(pluginId, event);
  }

  getPluginEventSubscriptions(pluginId: string): string[] {
    return this.innerTransport.getPluginEventSubscriptions(pluginId);
  }

  removeAllSubscriptions(pluginId: string): void {
    this.innerTransport.removeAllSubscriptions(pluginId);
  }

  clear(): void {
    void this.store.clear();
    this.innerTransport.clear();
    this.stopProcessor();
  }

  /**
   * Start the background outbox processor
   */
  startProcessor(): void {
    if (this.processorInterval) return;

    this.processorInterval = setInterval(() => {
      void this.processOutbox();
    }, this.options.pollIntervalMs);

    const nodeInterval = this.processorInterval as { unref?: () => void };
    nodeInterval.unref?.();

    logger.debug({ intervalMs: this.options.pollIntervalMs }, 'Outbox processor started');
  }

  /**
   * Stop the background processor
   */
  stopProcessor(): void {
    if (this.processorInterval) {
      clearInterval(this.processorInterval);
      this.processorInterval = null;
      logger.debug('Outbox processor stopped');
    }
  }

  /**
   * Process all pending outbox entries
   */
  async processOutbox(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const pending = await this.store.listPending();

      if (pending.length === 0) return;

      logger.debug({ count: pending.length }, 'Processing outbox entries');

      await Promise.all(pending.map((entry) => this.processEntry(entry)));
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single outbox entry
   */
  private async processEntry(entry: OutboxEntry): Promise<void> {
    const attempts = entry.attempts + 1;
    const lease = await this.store.markProcessing(entry.id, attempts, new Date());
    if (!lease.acquired) {
      logger.debug({ event: entry.event, entryId: entry.id }, 'Outbox entry already claimed');
      return;
    }

    try {
      // Dispatch to inner transport handlers
      await this.innerTransport.send(entry.event, entry.payload, entry.metadata);

      await this.store.markCompleted(entry.id, new Date());

      logger.info(
        {
          event: entry.event,
          entryId: entry.id,
          eventId: entry.metadata.eventId,
          correlationId: entry.metadata.correlationId,
          attempts: lease.attempts,
        },
        'Outbox event processed successfully'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (lease.attempts >= entry.maxAttempts) {
        await this.store.markFailed(entry.id, { attempts: lease.attempts, error: message });
        logger.error(
          {
            event: entry.event,
            entryId: entry.id,
            eventId: entry.metadata.eventId,
            correlationId: entry.metadata.correlationId,
            attempts: lease.attempts,
            error: message,
          },
          'Outbox event failed permanently after max retries'
        );
      } else {
        const delay = calculateDelay(lease.attempts, this.options.retryPolicy);
        await this.store.markRetry(entry.id, {
          attempts: lease.attempts,
          error: message,
          nextAttemptAt: new Date(Date.now() + delay),
        });
        logger.warn(
          {
            event: entry.event,
            entryId: entry.id,
            eventId: entry.metadata.eventId,
            correlationId: entry.metadata.correlationId,
            attempt: lease.attempts,
            delayMs: delay,
          },
          'Outbox event failed, will retry'
        );
      }
    }
  }

  /**
   * Get outbox statistics
   */
  async getStats(): Promise<OutboxStats> {
    return this.store.getStats();
  }

  /**
   * Get failed entries for manual inspection/replay
   */
  async getFailedEntries(): Promise<OutboxEntry[]> {
    return this.store.getFailedEntries();
  }

  /**
   * Replay a failed entry
   */
  async replayEntry(entryId: string): Promise<boolean> {
    const reset = await this.store.resetFailed(entryId);
    if (reset) {
      void this.processOutbox();
    }
    return reset;
  }

  async ignoreEntry(entryId: string, reason?: string): Promise<boolean> {
    return this.store.markIgnored(entryId, reason);
  }

  async archiveEntry(entryId: string, reason?: string): Promise<boolean> {
    return this.store.markArchived(entryId, reason);
  }
}
