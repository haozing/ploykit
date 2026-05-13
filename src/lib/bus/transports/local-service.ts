/**
 *
 *
 */

import { logger } from '@/lib/_core/logger';
import type { ServiceTransport, ServiceHandler, ServiceMetadata } from './types';

/**
 */
interface ServiceProvider {
  /** PluginID */
  pluginId: string;
  /** ServiceProcessFunction */
  handler: ServiceHandler;
  /** RegisterTime */
  registeredAt: Date;
}

export class LocalServiceTransport implements ServiceTransport {
  /**
   * Map<service, ServiceProvider>
   *
   */
  private providers = new Map<string, ServiceProvider>();

  /**
   *
   */
  async invoke<T>(service: string, payload: unknown, metadata: ServiceMetadata): Promise<T> {
    const { callerId, timeout = 5000 } = metadata;

    const provider = this.providers.get(service);
    if (!provider) {
      const error = new Error(`Service not found: ${service}`);
      logger.error({ service, callerId }, error.message);
      throw error;
    }

    logger.debug(
      { service, callerId, timeout, providerId: provider.pluginId },
      'Invoking service (sync, wait for result)'
    );

    const startTime = Date.now();

    try {
      const resultPromise = Promise.resolve(provider.handler(payload, metadata));

      const result = await this.withTimeout(resultPromise, timeout, service);

      const duration = Date.now() - startTime;
      logger.info({ service, duration }, 'Service invocation succeeded');

      return result as T;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(
        {
          service,
          callerId,
          duration,
          error: error instanceof Error ? error.message : String(error),
        },
        'Service invocation failed'
      );
      throw error;
    }
  }

  /**
   * Execute promise with timeout protection
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    service: string
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Service call timeout after ${timeoutMs}ms: ${service}`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId!);
    }
  }

  /**
   *
   * @param pluginId - PluginID
   * @param handler - ServiceHandler
   */
  register(service: string, pluginId: string, handler: ServiceHandler): void {
    const existingProvider = this.providers.get(service);
    if (existingProvider) {
      logger.warn(
        { service, oldProvider: existingProvider.pluginId, newProvider: pluginId },
        'Service already registered, overwriting'
      );
    }

    const provider: ServiceProvider = {
      pluginId,
      handler,
      registeredAt: new Date(),
    };

    this.providers.set(service, provider);
    logger.debug({ service, pluginId }, 'Service provider registered');
  }

  /**
   *
   * @param service - ServiceName
   */
  unregister(service: string): void {
    const removed = this.providers.delete(service);
    if (removed) {
      logger.debug({ service }, 'Service provider unregistered');
    }
  }

  /**
   *
   *
   * @param pluginId - PluginID
   */
  removeAllServices(pluginId: string): void {
    let removedCount = 0;

    // Service
    const toRemove: string[] = [];
    for (const [service, provider] of this.providers.entries()) {
      if (provider.pluginId === pluginId) {
        toRemove.push(service);
      }
    }

    for (const service of toRemove) {
      this.providers.delete(service);
      removedCount++;
    }

    logger.info({ pluginId, removedCount }, 'Removed all services for plugin');
  }

  /**
   *
   * @param service - ServiceName
   */
  hasService(service: string): boolean {
    return this.providers.has(service);
  }

  /**
   *
   * @returns ServiceNameList
   */
  listServices(): string[] {
    return Array.from(this.providers.keys()).sort();
  }

  /**
   *
   * @param service - ServiceName
   */
  getProvider(service: string): string | undefined {
    return this.providers.get(service)?.pluginId;
  }

  /**
   */
  clear(): void {
    this.providers.clear();
    logger.warn('Local service transport cleared');
  }
}
