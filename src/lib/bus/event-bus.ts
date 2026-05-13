/**
 * Event Bus - Publish/Subscribe System
 *
 * Provides async, fire-and-forget event handling for decoupled communication.
 *
 * @example
 * ```typescript
 * // Subscribe to event
 * eventBus.on('user.registered', 'welcome-plugin', async (data, metadata) => {
 *   console.log('New user:', data);
 * });
 *
 * // Publish event
 * await eventBus.emit('user.registered', 'auth-plugin', { userId: '123' });
 * ```
 */

import { logger } from '@/lib/_core/logger';
import { randomUUID } from 'node:crypto';
import { LocalEventTransport } from './transports/local-event';
import { OutboxEventTransport } from './transports/outbox-event';
import { BusValidator } from './validation';
import type { EventTransport, EventMetadata, EventHandler } from './transports/types';
import type { OutboxEntry, OutboxStats, OutboxStore } from './transports/outbox-store';
import {
  getEventClass,
  type EventClass,
  describeEventClassification,
} from './event-classification';

/**
 * Event Bus Configuration Options
 */
export interface EventBusOptions {
  /** Transport type (default: 'auto', critical events use outbox and others use local) */
  transport?: 'auto' | 'local' | 'outbox' | 'queue';

  /** Store used by the outbox transport */
  outboxStore?: OutboxStore;

  /** Whether the outbox background processor starts immediately */
  outboxAutoStart?: boolean;

  /** Custom transport instance */
  customTransport?: EventTransport;
}

interface EventSubscription {
  event: string;
  pluginId: string;
  handler: EventHandler;
}

export type EventEmitMetadata = Partial<
  Pick<EventMetadata, 'eventId' | 'correlationId' | 'causationId' | 'idempotencyKey'>
>;

/**
 * Event Bus - Async publish/subscribe system
 */
export class EventBus {
  private readonly mode: 'auto' | 'local' | 'outbox';
  private readonly customTransport?: EventTransport;
  private readonly localTransport: LocalEventTransport;
  private outboxTransport: OutboxEventTransport;
  private subscriptions: EventSubscription[] = [];

  constructor(options: EventBusOptions = {}) {
    if (options.customTransport) {
      this.mode = 'local';
      this.customTransport = options.customTransport;
      this.localTransport = new LocalEventTransport();
      this.outboxTransport = new OutboxEventTransport({
        autoStart: false,
        processImmediately: false,
      });
    } else if (options.transport === 'outbox') {
      this.mode = 'outbox';
      this.localTransport = new LocalEventTransport();
      this.outboxTransport = new OutboxEventTransport({
        store: options.outboxStore,
        autoStart: options.outboxAutoStart ?? true,
      });
    } else if (options.transport === 'queue') {
      logger.warn('Queue transport is not implemented yet, falling back to local transport');
      this.mode = 'local';
      this.localTransport = new LocalEventTransport();
      this.outboxTransport = new OutboxEventTransport({
        store: options.outboxStore,
        autoStart: false,
      });
    } else {
      this.mode = options.transport ?? 'auto';
      this.localTransport = new LocalEventTransport();
      this.outboxTransport = new OutboxEventTransport({
        store: options.outboxStore,
        autoStart: options.outboxAutoStart ?? false,
        processImmediately: true,
      });
    }

    logger.debug(
      {
        transport: options.customTransport ? 'custom' : this.mode,
        eventClassification: describeEventClassification(),
      },
      'EventBus initialized'
    );
  }

  private getSubscriptionTransports(): EventTransport[] {
    if (this.customTransport) {
      return [this.customTransport];
    }

    return [this.localTransport, this.outboxTransport];
  }

  private getTransportForEvent(event: string): {
    transport: EventTransport;
    transportName: 'custom' | 'local' | 'outbox';
    eventClass: EventClass;
  } {
    const eventClass = getEventClass(event);

    if (this.customTransport) {
      return { transport: this.customTransport, transportName: 'custom', eventClass };
    }

    if (this.mode === 'outbox') {
      return { transport: this.outboxTransport, transportName: 'outbox', eventClass };
    }

    if (this.mode === 'local') {
      return { transport: this.localTransport, transportName: 'local', eventClass };
    }

    if (eventClass === 'critical') {
      return { transport: this.outboxTransport, transportName: 'outbox', eventClass };
    }

    return { transport: this.localTransport, transportName: 'local', eventClass };
  }

  private replaySubscriptions(transport: EventTransport): void {
    for (const subscription of this.subscriptions) {
      transport.subscribe(subscription.event, subscription.pluginId, subscription.handler);
    }
  }

  // API - Publish/Subscribe

  /**
   * Subscribe to an event
   *
   * @param event - Event name
   * @param pluginId - Plugin ID
   * @param handler - Event handler function
   *
   * @example
   * ```typescript
   * eventBus.on('order.created', 'notification-plugin', async (data, metadata) => {
   *   await sendNotification(data.orderId);
   * });
   * ```
   */
  on(event: string, pluginId: string, handler: EventHandler): void {
    BusValidator.validateEventName(event, 'EventBus.on');
    BusValidator.validatePluginId(pluginId, 'EventBus.on');
    if (typeof handler !== 'function') {
      throw new TypeError('EventBus.on: handler must be a function');
    }

    this.subscriptions.push({ event, pluginId, handler });

    for (const transport of this.getSubscriptionTransports()) {
      transport.subscribe(event, pluginId, handler);
    }

    logger.debug({ event, pluginId }, 'Event listener registered');
  }

  /**
   * Emit an event (fire-and-forget)
   *
   * @param event - Event name
   * @param emitterId - Emitter plugin ID
   * @param payload - Event data
   *
   * @example
   * ```typescript
   * await eventBus.emit('user.registered', 'auth-plugin', {
   *   userId: '123',
   *   email: 'user@example.com',
   * });
   * console.log('Event emitted, continuing...'); // Returns immediately
   * ```
   */
  async emit(
    event: string,
    emitterId: string,
    payload: unknown,
    metadataOverrides: EventEmitMetadata = {}
  ): Promise<void> {
    BusValidator.validateEventName(event, 'EventBus.emit');
    BusValidator.validatePluginId(emitterId, 'EventBus.emit');
    BusValidator.validateEventMetadata(metadataOverrides, 'EventBus.emit');

    const eventId = metadataOverrides.eventId ?? randomUUID();
    const metadata: EventMetadata = {
      emitterId,
      timestamp: new Date(),
      eventId,
      correlationId: metadataOverrides.correlationId ?? eventId,
      causationId: metadataOverrides.causationId,
      idempotencyKey: metadataOverrides.idempotencyKey,
    };

    const { transport, transportName, eventClass } = this.getTransportForEvent(event);

    logger.info(
      {
        event,
        emitterId,
        eventId: metadata.eventId,
        correlationId: metadata.correlationId,
        idempotencyKey: metadata.idempotencyKey,
        eventClass,
        transport: transportName,
      },
      'Publishing event'
    );

    await transport.send(event, payload, metadata);

    logger.debug(
      {
        event,
        eventId: metadata.eventId,
        correlationId: metadata.correlationId,
        eventClass,
        transport: transportName,
      },
      'Event published'
    );
  }

  /**
   * Unsubscribe from an event
   *
   * @param event - Event name
   * @param pluginId - Plugin ID
   */
  off(event: string, pluginId: string): void {
    BusValidator.validateEventName(event, 'EventBus.off');
    BusValidator.validatePluginId(pluginId, 'EventBus.off');

    this.subscriptions = this.subscriptions.filter(
      (subscription) => subscription.event !== event || subscription.pluginId !== pluginId
    );

    for (const transport of this.getSubscriptionTransports()) {
      transport.removePluginEventSubscriptions(pluginId, event);
    }

    logger.debug({ event, pluginId }, 'Event listeners removed for plugin on specific event');
  }

  // Lifecycle Management

  /**
   * Remove all listeners for a plugin
   *
   * @param pluginId - Plugin ID
   */
  removeAllListeners(pluginId: string): void {
    BusValidator.validatePluginId(pluginId, 'EventBus.removeAllListeners');

    this.subscriptions = this.subscriptions.filter(
      (subscription) => subscription.pluginId !== pluginId
    );

    for (const transport of this.getSubscriptionTransports()) {
      transport.removeAllSubscriptions(pluginId);
    }

    logger.info({ pluginId }, 'Removed all event listeners for plugin');
  }

  /**
   * Get all listener plugin IDs for an event
   *
   * @param event - Event name
   */
  getListeners(event: string): string[] {
    BusValidator.validateEventName(event, 'EventBus.getListeners');

    return Array.from(
      new Set(
        this.subscriptions
          .filter((subscription) => subscription.event === event)
          .map((subscription) => subscription.pluginId)
      )
    ).sort();
  }

  /**
   * Get all events a plugin is subscribed to
   *
   * @param pluginId - Plugin ID
   */
  getPluginSubscriptions(pluginId: string): string[] {
    BusValidator.validatePluginId(pluginId, 'EventBus.getPluginSubscriptions');

    return Array.from(
      new Set(
        this.subscriptions
          .filter((subscription) => subscription.pluginId === pluginId)
          .map((subscription) => subscription.event)
      )
    ).sort();
  }

  configureOutboxStore(store: OutboxStore): void {
    if (this.customTransport) {
      logger.warn('Cannot configure outbox store on an EventBus with a custom transport');
      return;
    }

    this.outboxTransport.stopProcessor();
    this.outboxTransport = new OutboxEventTransport({
      store,
      autoStart: false,
      processImmediately: true,
    });
    this.replaySubscriptions(this.outboxTransport);

    logger.info('EventBus outbox store configured');
  }

  startOutboxProcessor(): void {
    if (this.customTransport) return;
    this.outboxTransport.startProcessor();
  }

  stopOutboxProcessor(): void {
    if (this.customTransport) return;
    this.outboxTransport.stopProcessor();
  }

  async processOutbox(): Promise<void> {
    if (this.customTransport) return;
    await this.outboxTransport.processOutbox();
  }

  async getOutboxStats(): Promise<OutboxStats> {
    return this.outboxTransport.getStats();
  }

  async getFailedOutboxEntries(): Promise<OutboxEntry[]> {
    return this.outboxTransport.getFailedEntries();
  }

  async replayOutboxEntry(entryId: string): Promise<boolean> {
    return this.outboxTransport.replayEntry(entryId);
  }

  async ignoreOutboxEntry(entryId: string, reason?: string): Promise<boolean> {
    return this.outboxTransport.ignoreEntry(entryId, reason);
  }

  async archiveOutboxEntry(entryId: string, reason?: string): Promise<boolean> {
    return this.outboxTransport.archiveEntry(entryId, reason);
  }

  /**
   * Clear all subscriptions (for testing/admin)
   */
  clear(): void {
    this.subscriptions = [];

    for (const transport of this.getSubscriptionTransports()) {
      if ('clear' in transport && typeof transport.clear === 'function') {
        transport.clear();
      }
    }

    logger.warn('EventBus cleared');
  }
}

/**
 * Global type declaration for HMR persistence
 */
declare global {
  var __eventBus: EventBus | undefined;
}

/**
 * Singleton EventBus instance
 *
 * Uses globalThis to persist across HMR in development mode.
 */
if (!globalThis.__eventBus) {
  globalThis.__eventBus = new EventBus();
}

export const eventBus = globalThis.__eventBus;
