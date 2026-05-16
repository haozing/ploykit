/**
 * ==========================================================================
 * ==========================================================================
 *
 *
 */

import React from 'react';
import { parsePluginRouteSlotName, type PluginRouteSlotPosition } from '@ploykit/plugin-sdk';
import { isValidSlotName, type SlotName, type SlotRegistration, type SlotMode } from './types';
import { logger } from '@/lib/_core/logger';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime/registry';
import { matchRuntimePath, normalizeRuntimePath } from '@/lib/plugin-runtime/contract';
import {
  getPluginRuntimeMapEntry,
  hasPluginRuntimeContract,
  resolvePluginComponentModule,
} from '@/lib/plugin-runtime/loader';
import { getPluginTrustLevelForSlots, validateSlotRegistration } from './slot-policy.server';
import type { ComponentType } from 'react';
import type {
  PluginSlotDeclaration,
  PluginSlotsDefinition,
  PluginTrustLevel,
} from '@ploykit/plugin-sdk';

export type PluginId = string;
export interface SlotRegisterOptions {
  pluginTrustLevel?: PluginTrustLevel;
  auditOnly?: boolean;
}

interface NormalizedSlotDeclaration {
  slotName: SlotName;
  componentPath: string;
  priority: number;
}

function toDeclarations(
  slots: PluginSlotsDefinition,
  defaultPriority = 100
): NormalizedSlotDeclaration[] {
  const declarations: NormalizedSlotDeclaration[] = [];

  for (const [slotName, slotDeclaration] of Object.entries(slots)) {
    if (!isValidSlotName(slotName)) {
      logger.warn({ slotName }, 'Invalid slot declaration name, skipping');
      continue;
    }

    const declarationList = Array.isArray(slotDeclaration) ? slotDeclaration : [slotDeclaration];

    for (const declaration of declarationList) {
      if (!declaration) {
        continue;
      }

      const normalized = normalizeSlotDeclaration(slotName, declaration, defaultPriority);
      if (normalized) {
        declarations.push(normalized);
      }
    }
  }

  return declarations;
}

function normalizeSlotDeclaration(
  slotName: SlotName,
  declaration: PluginSlotDeclaration,
  defaultPriority: number
): NormalizedSlotDeclaration | null {
  if (typeof declaration === 'string') {
    return {
      slotName,
      componentPath: declaration,
      priority: defaultPriority,
    };
  }

  if (typeof declaration.component !== 'string') {
    return null;
  }

  return {
    slotName,
    componentPath: declaration.component,
    priority: declaration.priority ?? defaultPriority,
  };
}

/**
 * ==========================================================================
 * ==========================================================================
 */
export class SlotManager {
  /**
   *
   * @example
   * Map {
   *   "header:logo" => [
   *     { pluginId: "custom-brand", ... },
   *     { pluginId: "another-plugin", ... }
   *   ],
   *   "header:extra" => [...]
   * }
   */
  private slots = new Map<SlotName, SlotRegistration[]>();

  /**
   * ComponentCache
   *
   *
   * @example
   * Map {
   *   "custom-brand:header:logo" => LogoComponent,
   *   "language-switcher:header:extra" => LanguageSwitcherComponent
   * }
   */
  private componentCache = new Map<string, ComponentType>();

  /**
   */
  private initialized = false;
  private initializing = false;
  private initPromise: Promise<void> | null = null;

  /**
   * ==========================================================================
   * ==========================================================================
   *
   * @param registration - RegisterInformation
   */
  register(registration: SlotRegistration, options: SlotRegisterOptions = {}): void {
    const { slotName, pluginId } = registration;

    if (!isValidSlotName(slotName)) {
      logger.warn({ pluginId, slotName }, 'Invalid slot name, skipping registration');
      return;
    }

    if (typeof registration.componentPath !== 'string' || registration.componentPath.length === 0) {
      logger.warn({ pluginId, slotName }, 'Invalid slot component path, skipping registration');
      return;
    }

    if (!Number.isFinite(registration.priority) || registration.priority < 0) {
      logger.warn(
        { pluginId, slotName, priority: registration.priority },
        'Invalid slot priority, skipping registration'
      );
      return;
    }

    const policyResult = validateSlotRegistration(registration, {
      pluginTrustLevel: options.pluginTrustLevel,
      auditOnly: options.auditOnly,
    });

    if (!policyResult.allowed) {
      logger.warn(
        {
          pluginId,
          slotName,
          componentPath: registration.componentPath,
          reason: policyResult.reason,
        },
        'Slot registration rejected'
      );
      return;
    }

    const existing = this.slots.get(slotName) || [];

    const isDuplicate = existing.some(
      (r) =>
        r.pluginId === pluginId &&
        r.slotName === slotName &&
        r.componentPath === registration.componentPath
    );

    if (isDuplicate) {
      logger.warn(
        { pluginId, slotName, componentPath: registration.componentPath },
        'Slot already registered, skipping'
      );
      return;
    }

    // Inside
    existing.push(registration);

    existing.sort((a, b) => a.priority - b.priority);

    // UpdateRegisterTable
    this.slots.set(slotName, existing);

    logger.debug({ pluginId, slotName, priority: registration.priority }, 'Slot registered');
  }

  countPluginRegistrations(pluginId: PluginId): number {
    let count = 0;

    for (const registrations of this.slots.values()) {
      count += registrations.filter((registration) => registration.pluginId === pluginId).length;
    }

    return count;
  }

  /**
   * ==========================================================================
   * ==========================================================================
   *
   *
   * @param pluginId - PluginID
   */
  async registerFromContract(pluginId: PluginId): Promise<number> {
    try {
      const contract = await pluginRuntimeRegistry.getOrLoad(pluginId);
      const declarations = toDeclarations(contract.slots);
      this.unregister(pluginId);

      if (declarations.length === 0) {
        logger.debug({ pluginId, contractId: contract.id }, 'No plugin slot declarations found');
        return 0;
      }

      const pluginTrustLevel = getPluginTrustLevelForSlots(contract);
      for (const declaration of declarations) {
        this.register(
          {
            pluginId,
            slotName: declaration.slotName,
            componentPath: declaration.componentPath,
            priority: declaration.priority,
            enabled: true,
            registeredAt: new Date(),
          },
          { pluginTrustLevel }
        );
      }

      return this.countPluginRegistrations(pluginId);
    } catch (error) {
      logger.error({ error, pluginId }, 'Failed to register slots from runtime contract');
      return 0;
    }
  }

  /**
   * ==========================================================================
   * Initialize with plugin list (dependency injection - preferred)
   * ==========================================================================
   *
   * Preferred method for initialization - allows external code to provide
   * the list of enabled plugins instead of querying the database directly.
   * This improves testability and reduces coupling.
   *
   * @param pluginIds - List of enabled plugin IDs to register slots for
   */
  async initializeWithPlugins(pluginIds: PluginId[]): Promise<void> {
    if (this.initialized) {
      logger.debug('SlotManager: Already initialized, skipping');
      return;
    }

    if (this.initializing && this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initializing = true;
    this.initPromise = this._initializeWithPlugins(pluginIds);

    try {
      await this.initPromise;
    } finally {
      this.initializing = false;
      this.initPromise = null;
    }
  }

  /**
   * Internal initialization with provided plugin list
   */
  private async _initializeWithPlugins(pluginIds: PluginId[]): Promise<void> {
    logger.info(
      { count: pluginIds.length, plugins: pluginIds },
      'SlotManager: Initializing with provided plugin list'
    );

    if (pluginIds.length === 0) {
      logger.info('SlotManager: No plugins provided, skipping slot registration');
      this.initialized = true;
      return;
    }

    let registeredCount = 0;
    for (const pluginId of pluginIds) {
      try {
        if (
          !hasPluginRuntimeContract(pluginId) &&
          !pluginRuntimeRegistry.get(pluginId) &&
          !pluginRuntimeRegistry.getEntry(pluginId)
        ) {
          logger.warn({ pluginId }, 'SlotManager: Plugin runtime contract not found, skipping');
          continue;
        }

        registeredCount += await this.registerFromContract(pluginId);

        logger.debug({ pluginId }, 'SlotManager: Successfully registered slots for plugin');
      } catch (error) {
        logger.error({ error, pluginId }, 'SlotManager: Failed to register slots for plugin');
      }
    }

    this.initialized = true;

    logger.info(
      { registeredCount, totalPlugins: pluginIds.length, totalSlots: this.slots.size },
      'SlotManager: Initialization complete'
    );
  }

  /**
   * ==========================================================================
   * Ensure initialized (lazy initialization fallback)
   * ==========================================================================
   *
   * Lazy initialization that queries the database directly.
   * Note: Prefer using initializeWithPlugins() for better testability.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializing && this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initializing = true;
    this.initPromise = this._initializeFromDatabase();

    try {
      await this.initPromise;
    } finally {
      this.initializing = false;
      this.initPromise = null;
    }
  }

  /**
   * Initialize from database (fallback for lazy initialization)
   */
  private async _initializeFromDatabase(): Promise<void> {
    try {
      logger.info('SlotManager: Lazy initializing from database...');

      const { getEnabledPlugins } = await import('@/lib/bus/hook-helpers.server');
      const enabledPluginIds = await getEnabledPlugins();
      const pluginIds = enabledPluginIds.filter((pluginId) => hasPluginRuntimeContract(pluginId));

      await this._initializeWithPlugins(pluginIds);
    } catch (error) {
      logger.error({ error }, 'SlotManager: Database initialization failed');
      this.initialized = true;
    }
  }

  /**
   * ==========================================================================
   * ==========================================================================
   *
   * @param mode - RenderPattern
   * @returns ReactComponentArray
   */
  async renderSlot(slotName: SlotName, mode: SlotMode = 'append'): Promise<React.ReactNode[]> {
    await this.ensureInitialized();

    logger.debug({ slotName, mode }, 'renderSlot called');

    // GetRegisterList
    const registrations = this.slots.get(slotName) || [];

    logger.debug(
      {
        slotName,
        foundRegistrations: registrations.length,
        pluginIds: registrations.map((r) => r.pluginId),
        componentPaths: registrations.map((r) => r.componentPath),
      },
      'Found registrations for slot'
    );

    const enabled = registrations.filter((r) => r.enabled);

    return this.renderRegistrations(slotName, enabled, mode);
  }

  async renderRouteSlot(
    pathname: string,
    position: PluginRouteSlotPosition,
    mode: SlotMode = 'append'
  ): Promise<React.ReactNode[]> {
    await this.ensureInitialized();

    const normalizedPathname = normalizeRuntimePath(pathname);
    const enabled = [...this.slots.entries()]
      .filter(([slotName]) => {
        const routeSlot = parsePluginRouteSlotName(slotName);
        return (
          !!routeSlot &&
          routeSlot.position === position &&
          matchRuntimePath(routeSlot.path, normalizedPathname)
        );
      })
      .flatMap(([, registrations]) => registrations)
      .filter((registration) => registration.enabled)
      .sort((a, b) => a.priority - b.priority);

    const syntheticSlotName = `route:${normalizedPathname}:${position}` as SlotName;

    return this.renderRegistrations(syntheticSlotName, enabled, mode);
  }

  private async renderRegistrations(
    slotName: SlotName,
    registrations: SlotRegistration[],
    mode: SlotMode
  ): Promise<React.ReactNode[]> {
    if (registrations.length === 0) {
      logger.debug({ slotName }, 'No enabled registrations for slot');
      return [];
    }

    const toRender = mode === 'replace' ? [registrations[0]] : registrations;

    const components = await Promise.all(
      toRender.map(async (registration) => {
        try {
          const Component = await this.loadComponent(registration);
          return <Component key={`${registration.pluginId}:${slotName}`} />;
        } catch (error) {
          logger.error(
            { error, pluginId: registration.pluginId, slotName },
            'Failed to load slot component'
          );
          return null;
        }
      })
    );

    const validComponents = components.filter((c) => c !== null);

    logger.debug({ slotName, mode, count: validComponents.length }, 'Rendered slot');

    return validComponents;
  }

  /**
   * ==========================================================================
   * ==========================================================================
   *
   * @param registration - RegisterInformation
   * @returns ReactComponent
   */
  private async loadComponent(registration: SlotRegistration): Promise<ComponentType> {
    const { pluginId, slotName, componentPath } = registration;
    const cacheKey = `${pluginId}:${slotName}:${componentPath}`;

    if (this.componentCache.has(cacheKey)) {
      logger.debug({ cacheKey }, 'Using cached component');
      return this.componentCache.get(cacheKey)!;
    }

    const entry = getPluginRuntimeMapEntry(pluginId) ?? pluginRuntimeRegistry.getEntry(pluginId);
    if (!entry) {
      throw new Error(`Plugin "${pluginId}" not found in the runtime plugin map`);
    }

    logger.debug(
      {
        pluginId,
        slotName,
        originalPath: componentPath,
      },
      'Loading slot component from runtime plugin map'
    );

    const componentLoader = resolvePluginComponentModule(entry, componentPath);

    if (!componentLoader) {
      throw new Error(
        `Component "${componentPath}" not found in the runtime plugin map for plugin "${pluginId}". ` +
          `Available components: ${Object.keys(entry.components ?? {}).join(', ')}`
      );
    }

    try {
      const componentModule = (await componentLoader()) as { default?: ComponentType };

      logger.debug(
        {
          pluginId,
          slotName,
          moduleKeys: Object.keys(componentModule),
          hasDefault: !!componentModule.default,
          defaultType: typeof componentModule.default,
        },
        'Component module loaded successfully'
      );

      const Component = componentModule.default;

      if (!Component) {
        throw new Error(
          `Plugin "${pluginId}" slot component at "${componentPath}" doesn't have a default export`
        );
      }

      // CacheComponent

      this.componentCache.set(cacheKey, Component);

      logger.info({ pluginId, slotName }, 'Loaded and cached slot component');

      return Component;
    } catch (error) {
      logger.error(
        {
          error,
          pluginId,
          slotName,
          componentPath,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          errorCode: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
        },
        'Failed to load slot component from runtime plugin map'
      );
      throw error;
    }
  }

  /**
   * ==========================================================================
   * ==========================================================================
   *
   *
   * @param pluginId - PluginID
   */
  unregister(pluginId: string): void {
    let unregisteredCount = 0;

    // Register
    for (const [slotName, registrations] of this.slots.entries()) {
      const filtered = registrations.filter((r) => r.pluginId !== pluginId);

      if (filtered.length < registrations.length) {
        unregisteredCount += registrations.length - filtered.length;
      }

      if (filtered.length === 0) {
        this.slots.delete(slotName);
      } else {
        // UpdateRegisterList
        this.slots.set(slotName, filtered);
      }
    }

    // Cache
    for (const key of this.componentCache.keys()) {
      if (key.startsWith(`${pluginId}:`)) {
        this.componentCache.delete(key);
      }
    }

    logger.info({ pluginId, count: unregisteredCount }, 'Unregistered all slots for plugin');
  }

  /**
   * ==========================================================================
   * ==========================================================================
   *
   */
  getSlotCount(slotName: SlotName): number {
    const registrations = this.slots.get(slotName) || [];
    return registrations.filter((r) => r.enabled).length;
  }

  /**
   * ==========================================================================
   * ==========================================================================
   *
   * @returns StatisticsInformation
   */
  getStats() {
    const stats = {
      totalSlots: this.slots.size,
      totalRegistrations: 0,
      cachedComponents: this.componentCache.size,
      initialized: this.initialized,
      slots: [] as { name: string; count: number }[],
    };

    for (const [slotName, registrations] of this.slots.entries()) {
      stats.totalRegistrations += registrations.length;
      stats.slots.push({
        name: slotName,
        count: registrations.filter((r) => r.enabled).length,
      });
    }

    return stats;
  }

  /**
   * ==========================================================================
   * ==========================================================================
   *
   */
  getDetailedState() {
    type SlotRegistrationDetail = {
      pluginId: string;
      componentPath: string;
      priority: number;
      enabled: boolean;
      registeredAt: string;
    };

    const result: Record<string, SlotRegistrationDetail[]> = {};

    for (const [slotName, registrations] of this.slots.entries()) {
      result[slotName] = registrations.map((r) => ({
        pluginId: r.pluginId,
        componentPath: r.componentPath,
        priority: r.priority,
        enabled: r.enabled,
        registeredAt: r.registeredAt.toISOString(),
      }));
    }

    return result;
  }
}

/**
 * ==========================================================================
 * ==========================================================================
 */
export const slotManager = new SlotManager();

/**
 * ==========================================================================
 * ==========================================================================
 *
 * @param mode - RenderPattern
 * @returns ReactComponentArray
 */
export async function renderSlot(slotName: SlotName, mode?: SlotMode): Promise<React.ReactNode[]> {
  return slotManager.renderSlot(slotName, mode);
}

export async function renderRouteSlot(
  pathname: string,
  position: PluginRouteSlotPosition,
  mode?: SlotMode
): Promise<React.ReactNode[]> {
  return slotManager.renderRouteSlot(pathname, position, mode);
}
