/**
 * Service Bus - Request/Response System
 *
 * Provides synchronous service invocation with timeout management.
 *
 * @example
 * ```typescript
 * serviceBus.register('service:order@v1', 'order-plugin', async (payload, metadata) => {
 *   const order = await createOrder(payload);
 *   return { orderId: order.id, success: true };
 * });
 *
 * const result = await serviceBus.call<OrderResult>(
 *   'service:order@v1',
 *   { items: [...], userId: '123' },
 *   { callerId: 'cart-plugin', timeout: 5000 }
 * );
 * console.log('Order created:', result.orderId);
 * ```
 */

import { logger } from '@/lib/_core/logger';
import { LocalServiceTransport } from './transports/local-service';
import { BusValidator } from './validation';
import type { ServiceTransport, ServiceMetadata, ServiceHandler } from './transports/types';

/**
 * Service Bus Configuration Options
 */
export interface ServiceBusOptions {
  /** Transport type (default: 'local') */
  transport?: 'local' | 'http' | 'grpc';

  /** Custom transport instance */
  customTransport?: ServiceTransport;

  /** Default timeout in milliseconds (default: 5000) */
  defaultTimeout?: number;
}

/**
 * Service Bus - Synchronous request/response system
 */
export class ServiceBus {
  /** Transport instance */
  private transport: ServiceTransport;

  /** Default timeout in milliseconds */
  private defaultTimeout: number;

  constructor(options: ServiceBusOptions = {}) {
    if (options.customTransport) {
      this.transport = options.customTransport;
    } else {
      this.transport = new LocalServiceTransport();
    }

    this.defaultTimeout = options.defaultTimeout || 5000;

    logger.debug(
      {
        transport: options.transport || 'local',
        defaultTimeout: this.defaultTimeout,
      },
      'ServiceBus initialized'
    );
  }

  /**
   * Call a service and wait for result
   *
   * @param service - Service name
   * @param payload - Request data
   * @param metadata - Call metadata including callerId and optional timeout
   *
   * @example
   * ```typescript
   * const result = await serviceBus.call<{ orderId: string }>(
   *   'service:order@v1',
   *   { items: [{ productId: '1', quantity: 2 }], userId: '123' },
   *   { callerId: 'cart-plugin', timeout: 5000 }
   * );
   * console.log('Order ID:', result.orderId);
   * ```
   */
  async call<TResult = unknown>(
    service: string,
    payload: unknown,
    metadata: Omit<ServiceMetadata, 'timeout'> & { timeout?: number }
  ): Promise<TResult> {
    BusValidator.validateServiceName(service, 'ServiceBus.call');
    BusValidator.validatePluginId(metadata.callerId, 'ServiceBus.call');

    const fullMetadata: ServiceMetadata = {
      ...metadata,
      timeout: metadata.timeout || this.defaultTimeout,
    };

    logger.info(
      {
        service,
        callerId: metadata.callerId,
        timeout: fullMetadata.timeout,
      },
      'Calling service (sync, wait for result)'
    );

    const startTime = Date.now();

    try {
      const result = await this.transport.invoke<TResult>(service, payload, fullMetadata);

      const duration = Date.now() - startTime;
      logger.info({ service, duration }, 'Service call succeeded');

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(
        {
          service,
          callerId: metadata.callerId,
          duration,
          error: error instanceof Error ? error.message : String(error),
        },
        'Service call failed'
      );

      throw error;
    }
  }

  /**
   * Register a service provider
   *
   * @param service - Service name
   * @param pluginId - Provider plugin ID
   * @param handler - Service handler function
   *
   * @example
   * ```typescript
   * serviceBus.register(
   *   'service:order@v1',
   *   'order-plugin',
   *   async (payload, metadata) => {
   *     const { items, userId } = payload as OrderPayload;
   *     const order = await createOrder(items, userId);
   *     return { orderId: order.id, success: true };
   *   }
   * );
   * ```
   */
  register(service: string, pluginId: string, handler: ServiceHandler): void {
    BusValidator.validateServiceName(service, 'ServiceBus.register');
    BusValidator.validatePluginId(pluginId, 'ServiceBus.register');
    if (typeof handler !== 'function') {
      throw new TypeError('ServiceBus.register: handler must be a function');
    }

    const existingProvider = this.transport.getProvider(service);
    if (existingProvider) {
      logger.warn(
        { service, oldProvider: existingProvider, newProvider: pluginId },
        'Service already registered, overwriting'
      );
    }

    this.transport.register(service, pluginId, handler);

    logger.debug({ service, pluginId }, 'Service provider registered');
  }

  /**
   * Unregister a service provider
   *
   * @param service - Service name
   * @param pluginId - Provider plugin ID
   */
  unregister(service: string, pluginId: string): void {
    BusValidator.validateServiceName(service, 'ServiceBus.unregister');
    BusValidator.validatePluginId(pluginId, 'ServiceBus.unregister');

    const currentProvider = this.transport.getProvider(service);
    if (currentProvider !== pluginId) {
      logger.warn(
        { service, pluginId, currentProvider },
        'Attempted to unregister service owned by another plugin'
      );
      return;
    }

    this.transport.unregister(service);

    logger.debug({ service, pluginId }, 'Service provider unregistered');
  }

  // Lifecycle Management

  /**
   * Remove all services for a plugin
   *
   * @param pluginId - Plugin ID
   */
  removeAllServices(pluginId: string): void {
    BusValidator.validatePluginId(pluginId, 'ServiceBus.removeAllServices');

    this.transport.removeAllServices(pluginId);

    logger.info({ pluginId }, 'Removed all services for plugin');
  }

  // Query/Debug API

  /**
   * Check if a service is registered
   *
   * @param service - Service name
   */
  hasService(service: string): boolean {
    BusValidator.validateServiceName(service, 'ServiceBus.hasService');

    return this.transport.hasService(service);
  }

  /**
   * Get the provider plugin ID for a service
   *
   * @param service - Service name
   */
  getProvider(service: string): string | undefined {
    BusValidator.validateServiceName(service, 'ServiceBus.getProvider');

    return this.transport.getProvider(service);
  }

  /**
   * List all registered services
   *
   * @returns Array of service names
   */
  listServices(): string[] {
    return this.transport.listServices();
  }

  /**
   * Get all services provided by a plugin
   *
   * @param pluginId - Plugin ID
   * @returns Array of service names
   */
  getPluginServices(pluginId: string): string[] {
    BusValidator.validatePluginId(pluginId, 'ServiceBus.getPluginServices');

    return this.transport
      .listServices()
      .filter((service) => this.transport.getProvider(service) === pluginId)
      .sort();
  }

  /**
   * Clear all registrations (for testing/admin)
   */
  clear(): void {
    if ('clear' in this.transport && typeof this.transport.clear === 'function') {
      this.transport.clear();
    }

    logger.warn('ServiceBus cleared');
  }
}

/**
 * Global type declaration for HMR persistence
 */
declare global {
  var __serviceBus: ServiceBus | undefined;
}

/**
 * Singleton ServiceBus instance
 *
 * Uses globalThis to persist across HMR in development mode.
 */
if (!globalThis.__serviceBus) {
  globalThis.__serviceBus = new ServiceBus();
}

export const serviceBus = globalThis.__serviceBus;
