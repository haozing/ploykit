/**
 * Unified Bus - Central communication system for plugins
 *
 * Combines hooks, events, and services into a single unified API.
 *
 * @example
 * ```typescript
 * import { bus } from '@/lib/bus';
 *
 * const results = await bus.hook.execute('onRenderHead', context, data);
 *
 * const result = await bus.service.call('service:order@v1', payload, metadata);
 *
 * await bus.event.emit('order.created', pluginId, { orderId: '123' });
 * ```
 */

import { unifiedHookSystem, UnifiedHookSystem } from './hooks/unified-system';
import { eventBus, EventBus } from './event-bus';
import { serviceBus, ServiceBus } from './service-bus';
import { BusValidator } from './validation';
import type { AllHookName, HookHandler } from './hooks/types';
import type { EventHandler, ServiceHandler } from './transports/types';

/**
 * Unified Bus - Combines hooks, events, and services
 */
export class UnifiedBus {
  /** Hook system for framework hooks */
  public readonly hook: UnifiedHookSystem;

  /** Event bus for pub/sub */
  public readonly event: EventBus;

  /** Service bus for request/response */
  public readonly service: ServiceBus;

  constructor(options?: { hook?: UnifiedHookSystem; event?: EventBus; service?: ServiceBus }) {
    this.hook = options?.hook || unifiedHookSystem;
    this.event = options?.event || eventBus;
    this.service = options?.service || serviceBus;
  }

  /**
   * Called when a plugin is enabled - registers all capabilities
   *
   * @param pluginId - Plugin ID
   * @param capabilities - Plugin capabilities to register
   */
  onPluginEnabled(
    pluginId: string,
    capabilities: {
      hooks?: Array<{ name: AllHookName; handler: HookHandler; priority?: number }>;
      events?: Array<{ event: string; handler: EventHandler }>;
      services?: Array<{ service: string; handler: ServiceHandler }>;
    }
  ): void {
    BusValidator.validatePluginId(pluginId, 'UnifiedBus.onPluginEnabled');

    // Register Hooks
    if (capabilities.hooks) {
      for (const { name, handler, priority } of capabilities.hooks) {
        this.hook.register(pluginId, name, handler, priority || 100);
      }
    }

    // Register Event Listeners
    if (capabilities.events) {
      for (const { event, handler } of capabilities.events) {
        this.event.on(event, pluginId, handler);
      }
    }

    // Register Service Providers
    if (capabilities.services) {
      for (const { service, handler } of capabilities.services) {
        this.service.register(service, pluginId, handler);
      }
    }
  }

  /**
   * Called when a plugin is disabled - unregisters all capabilities
   *
   * @param pluginId - Plugin ID
   */
  onPluginDisabled(pluginId: string): void {
    BusValidator.validatePluginId(pluginId, 'UnifiedBus.onPluginDisabled');

    // Unregister Hooks
    this.hook.unregister(pluginId);

    // Unregister Event Listeners
    this.event.removeAllListeners(pluginId);

    // Unregister Service Providers
    this.service.removeAllServices(pluginId);
  }

  /**
   * Get all registrations for a plugin
   *
   * @param pluginId - Plugin ID
   */
  getPluginRegistrations(pluginId: string) {
    return {
      events: this.event.getPluginSubscriptions(pluginId),
      services: this.service.getPluginServices(pluginId),
    };
  }

  /**
   * Clear all registrations (for testing/admin)
   */
  clearAll(): void {
    this.hook.clear();
    this.event.clear();
    this.service.clear();
  }
}

/**
 * Singleton UnifiedBus instance
 */
export const bus = new UnifiedBus();

/**
 * Re-export individual bus instances
 */
export { unifiedHookSystem, eventBus, serviceBus };

/**
 * Export types
 */
export type {
  HookExecutionContext,
  HookHandler,
  HookExecutionResult,
  HookExecutionOptions,
  TypedHookHandler,
  HookPayloadMap,
  AllHookName,
} from './hooks/types';

export type { EventTransport, EventMetadata, EventHandler } from './transports/types';

export type { ServiceTransport, ServiceMetadata, ServiceHandler } from './transports/types';

/**
 * Default export
 */
export default bus;
