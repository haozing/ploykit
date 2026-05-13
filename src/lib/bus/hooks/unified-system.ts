/**
 * Unified Hook System
 *
 * Global hook registry and execution engine.
 * Manages hook registration and execution.
 */

import { logger } from '@/lib/_core/logger';
import { HookContextBuilder } from './context';
import { BusValidator } from '@/lib/bus/validation';
import { DEFAULT_HOOK_TIMEOUT } from './constants';
import type {
  AllHookName,
  HookHandler,
  HookRegistration,
  HookExecutionResult,
  HookExecutionOptions,
  HookPayloadMap,
} from './types';

// Unified Hook System Class

/**
 *
 */
export class UnifiedHookSystem {
  /**
   * HookRegisterTable
   *
   *
   * GlobalHookRegisterTable
   */
  private registry = new Map<AllHookName, HookRegistration[]>();

  /**
   *
   *
   * @param pluginId - PluginID
   * @param hookName - HookName
   *
   * @example
   * ```typescript
   * // hooks)
   * hookSystem.register('plugin-id', 'onRenderHead', handlerFn, 50);
   *
   * ```
   */
  register(
    pluginId: string,
    hookName: AllHookName,
    handler: HookHandler,
    priority: number = 100
  ): void {
    // ?InputVerification
    BusValidator.validatePluginId(pluginId, 'UnifiedHookSystem.register');
    BusValidator.validateHookName(hookName, 'UnifiedHookSystem.register');
    if (priority !== undefined) {
      BusValidator.validatePriority(priority, 'UnifiedHookSystem.register');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('UnifiedHookSystem.register: handler must be a function');
    }

    const registration: HookRegistration = {
      pluginId,
      hookName,
      priority,
      handler,
      registeredAt: new Date(),
    };

    this.addRegistration(registration);

    logger.debug(
      {
        pluginId,
        hookName,
        priority,
      },
      'Hook registered'
    );
  }

  /**
   *
   *
   * @param pluginId - PluginID
   * @param hookNames - HookNameList
   *
   * @example
   * ```typescript
   * hookSystem.registerFromContract('plugin-id', [
   *   'onInstall',
   *   'onEnable',
   *   'onDisable',
   * ]);
   * ```
   */
  registerFromContract(pluginId: string, hookNames: AllHookName[], priority?: number): void {
    BusValidator.validatePluginId(pluginId, 'UnifiedHookSystem.registerFromContract');
    if (priority !== undefined) {
      BusValidator.validatePriority(priority, 'UnifiedHookSystem.registerFromContract');
    }

    for (const hookName of hookNames) {
      BusValidator.validateHookName(hookName, 'UnifiedHookSystem.registerFromContract');
    }

    logger.warn(
      { pluginId, hookCount: hookNames.length },
      'registerFromContract skipped; hook declarations require concrete handlers'
    );
  }

  /**
   */
  private addRegistration(registration: HookRegistration): void {
    const { hookName } = registration;

    let registrations = this.registry.get(hookName);
    if (!registrations) {
      registrations = [];
      this.registry.set(hookName, registrations);
    }

    // 2. addRegister
    registrations.push(registration);

    registrations.sort((a, b) => a.priority - b.priority);
  }

  /**
   *
   * @param pluginId - PluginID
   */
  unregister(pluginId: string): void {
    let removedCount = 0;

    for (const [hookName, registrations] of this.registry.entries()) {
      const originalCount = registrations.length;
      const filtered = registrations.filter((r) => r.pluginId !== pluginId);
      removedCount += originalCount - filtered.length;

      if (filtered.length === 0) {
        this.registry.delete(hookName);
      } else {
        this.registry.set(hookName, filtered);
      }
    }

    logger.info({ pluginId, removedCount }, 'All hooks unregistered for plugin');
  }

  /**
   *
   * @param pluginId - PluginID
   * @param hookName - HookName
   */
  unregisterHook(pluginId: string, hookName: AllHookName): void {
    const registrations = this.registry.get(hookName);
    if (!registrations) return;

    const filtered = registrations.filter((r) => r.pluginId !== pluginId);

    if (filtered.length === 0) {
      this.registry.delete(hookName);
    } else {
      this.registry.set(hookName, filtered);
    }

    logger.debug({ pluginId, hookName }, 'Hook unregistered');
  }

  /**
   * ExecuteHook
   *
   *
   * @template H - HookName
   * @param hookName - HookName
   * @param environment - ExecuteEnvironmentInformation
   *
   * @example
   * ```typescript
   * const results = await hookSystem.execute(
   *   'onRenderHead',
   *   { userId: 'user-1', requestId: 'req-123' },
   *   { url: '/products', pathname: '/products' }
   * );
   * ```
   */
  async execute<H extends AllHookName>(
    hookName: H,
    environment: {
      userId?: string;
      requestId?: string;
    },
    payload?: HookPayloadMap[H],
    options: HookExecutionOptions = {}
  ): Promise<HookExecutionResult[]> {
    // 1. GetRegisterList
    const registrations = this.getRegistrations(hookName, options.pluginIds);

    if (registrations.length === 0) {
      logger.debug({ hookName }, 'No hooks registered');
      return [];
    }

    logger.info(
      {
        hookName,
        pluginCount: registrations.length,
        plugins: registrations.map((r) => r.pluginId),
      },
      'Executing hooks'
    );

    const startTime = Date.now();
    const timeout = options.timeoutMs ?? DEFAULT_HOOK_TIMEOUT;

    const results = await Promise.allSettled(
      registrations.map((registration) =>
        this.executeOne(registration, hookName, environment, payload, timeout)
      )
    );

    const executionResults = this.processResults(results, registrations);

    // 4. Statistics
    const duration = Date.now() - startTime;
    const succeeded = executionResults.filter((r) => r.success).length;
    const failed = executionResults.filter((r) => !r.success).length;

    logger.info(
      {
        hookName,
        succeeded,
        failed,
        total: executionResults.length,
        duration,
      },
      'Hook execution completed'
    );

    return executionResults;
  }

  /**
   * Execute a single hook with timeout protection
   */
  private async executeOne<H extends AllHookName>(
    registration: HookRegistration,
    hookName: H,
    environment: {
      userId?: string;
      requestId?: string;
    },
    payload?: HookPayloadMap[H],
    timeout: number = DEFAULT_HOOK_TIMEOUT
  ): Promise<HookExecutionResult> {
    const { pluginId } = registration;
    const startTime = Date.now();

    try {
      const context = await HookContextBuilder.build(pluginId, hookName, environment, payload);

      // Execute with timeout protection
      const result = await this.executeWithTimeout(
        registration.handler(context),
        timeout,
        pluginId,
        hookName
      );

      return {
        success: true,
        pluginId,
        data: result,
        duration: Date.now() - startTime,
        executedAt: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        pluginId,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        executedAt: new Date(),
      };
    }
  }

  /**
   * Execute a promise with timeout protection
   */
  private async executeWithTimeout<T>(
    promise: Promise<T> | T,
    timeout: number,
    pluginId: string,
    hookName: string
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Hook execution timeout after ${timeout}ms: ${pluginId}/${hookName}`));
      }, timeout);
    });

    try {
      return await Promise.race([Promise.resolve(promise), timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   */
  private processResults(
    results: PromiseSettledResult<HookExecutionResult>[],
    registrations: HookRegistration[]
  ): HookExecutionResult[] {
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        // Failed
        const registration = registrations[index];
        return {
          success: false,
          pluginId: registration.pluginId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          duration: 0,
          executedAt: new Date(),
        };
      }
    });
  }

  /**
   *
   *
   * @param hookName - HookName
   * @param environment - ExecuteEnvironment
   */
  async executeAndMerge<H extends AllHookName, TItem = unknown>(
    hookName: H,
    environment: {
      userId?: string;
      requestId?: string;
    },
    payload?: HookPayloadMap[H],
    options: HookExecutionOptions = {}
  ): Promise<TItem[]> {
    const results = await this.execute(hookName, environment, payload, options);

    return results
      .filter((r) => r.success && r.data != null)
      .flatMap((r) => (Array.isArray(r.data) ? r.data : [r.data]) as TItem[]);
  }

  /**
   * Execute hooks sequentially in priority order.
   *
   * Use this for hooks whose result can affect control flow, such as
   * onBeforeHandle cancel/redirect/rewrite decisions.
   */
  async executeSequential<H extends AllHookName>(
    hookName: H,
    environment: {
      userId?: string;
      requestId?: string;
    },
    payload?: HookPayloadMap[H],
    options: HookExecutionOptions = {}
  ): Promise<HookExecutionResult[]> {
    const registrations = this.getRegistrations(hookName, options.pluginIds);

    if (registrations.length === 0) {
      logger.debug({ hookName }, 'No hooks registered');
      return [];
    }

    logger.info(
      {
        hookName,
        pluginCount: registrations.length,
        plugins: registrations.map((r) => r.pluginId),
      },
      'Executing hooks sequentially'
    );

    const startTime = Date.now();
    const timeout = options.timeoutMs ?? DEFAULT_HOOK_TIMEOUT;
    const executionResults: HookExecutionResult[] = [];

    for (const registration of registrations) {
      executionResults.push(
        await this.executeOne(registration, hookName, environment, payload, timeout)
      );
    }

    const succeeded = executionResults.filter((r) => r.success).length;
    const failed = executionResults.filter((r) => !r.success).length;

    logger.info(
      {
        hookName,
        succeeded,
        failed,
        total: executionResults.length,
        duration: Date.now() - startTime,
      },
      'Sequential hook execution completed'
    );

    return executionResults;
  }

  // Query API - QueryInterface

  /**
   * GetRegisterList
   */
  private getRegistrations(
    hookName: AllHookName,
    pluginIds?: readonly string[]
  ): HookRegistration[] {
    const registrations = this.registry.get(hookName) || [];
    if (!pluginIds) {
      return registrations;
    }

    const allowed = new Set(pluginIds);
    return registrations.filter((registration) => allowed.has(registration.pluginId));
  }

  /**
   *
   * @param hookName - HookName
   */
  getPlugins(hookName: AllHookName): string[] {
    const registrations = this.getRegistrations(hookName);
    return registrations.map((r) => r.pluginId);
  }

  /**
   *
   * @param pluginId - PluginID
   * @param hookName - HookName
   */
  hasHook(pluginId: string, hookName: AllHookName): boolean {
    const registrations = this.getRegistrations(hookName);
    return registrations.some((r) => r.pluginId === pluginId);
  }

  /**
   *
   * @param pluginId - PluginID
   * @returns HookNameList
   */
  getPluginHooks(pluginId: string): AllHookName[] {
    const hooks: AllHookName[] = [];

    for (const [hookName, registrations] of this.registry.entries()) {
      if (registrations.some((r) => r.pluginId === pluginId)) {
        hooks.push(hookName);
      }
    }

    return hooks.sort();
  }

  /**
   *
   * @returns HookNameList
   */
  getAllHooks(): AllHookName[] {
    return Array.from(this.registry.keys()).sort();
  }

  /**
   * GethookStatisticsInformation
   *
   * @returns StatisticsInformation
   */
  getStats(): {
    totalHooks: number;
    totalPlugins: number;
    preLoaded: number;
    lazyLoad: number;
  } {
    let preLoaded = 0;
    const plugins = new Set<string>();

    for (const registrations of this.registry.values()) {
      for (const reg of registrations) {
        plugins.add(reg.pluginId);
        preLoaded++;
      }
    }

    return {
      totalHooks: this.registry.size,
      totalPlugins: plugins.size,
      preLoaded,
      lazyLoad: 0,
    };
  }

  /**
   */
  clear(): void {
    this.registry.clear();
    logger.warn('Unified hook system cleared');
  }
}

// Global Instance

/**
 */
export const unifiedHookSystem = new UnifiedHookSystem();
