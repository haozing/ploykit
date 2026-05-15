import { PluginError } from '@ploykit/plugin-sdk';
import { CACHE_KEYS, pluginContractCache } from '@/lib/cache';
import {
  assertValidPluginRuntimeContract,
  findRuntimeApiRouteMatch,
  findRuntimePageRouteMatch,
  normalizePluginRuntimeContract,
  type PluginRuntimeContract,
  type RuntimeApiRoute,
  type RuntimePageRoute,
  type RuntimePluginDefinition,
} from '../contract';
import { loadPluginRuntimeContract, type PluginRuntimeMapEntry } from '../loader';

export interface RegisterPluginRuntimeOptions {
  replace?: boolean;
  entry?: PluginRuntimeMapEntry;
}

export class PluginRuntimeRegistry {
  private contracts = new Map<string, PluginRuntimeContract>();
  private entries = new Map<string, PluginRuntimeMapEntry>();

  clear(): void {
    this.contracts.clear();
    this.entries.clear();
    pluginContractCache.clear();
  }

  registerDefinition(
    definition: RuntimePluginDefinition,
    options: RegisterPluginRuntimeOptions = {}
  ): PluginRuntimeContract {
    const contract = normalizePluginRuntimeContract(definition);
    assertValidPluginRuntimeContract(definition, contract);
    this.registerContract(contract, options);
    return contract;
  }

  registerContract(
    contract: PluginRuntimeContract,
    options: RegisterPluginRuntimeOptions = {}
  ): void {
    if (this.contracts.has(contract.id) && !options.replace) {
      throw new PluginError({
        code: 'PLUGIN_RUNTIME_DUPLICATE',
        message: `Plugin runtime contract "${contract.id}" is already registered.`,
        statusCode: 409,
        fix: 'Use replace: true during hot reload or unregister the plugin first.',
      });
    }

    this.contracts.set(contract.id, contract);
    pluginContractCache.set(
      CACHE_KEYS.plugin.contract(contract.id),
      contract as unknown as Record<string, unknown>
    );

    if (options.entry) {
      this.entries.set(contract.id, options.entry);
    }
  }

  unregister(pluginId: string): void {
    this.contracts.delete(pluginId);
    this.entries.delete(pluginId);
    pluginContractCache.delete(CACHE_KEYS.plugin.contract(pluginId));
  }

  get(pluginId: string): PluginRuntimeContract | null {
    const memoryContract = this.contracts.get(pluginId);
    if (memoryContract) {
      return memoryContract;
    }

    const cachedContract = pluginContractCache.get(CACHE_KEYS.plugin.contract(pluginId));
    if (cachedContract) {
      const contract = cachedContract as unknown as PluginRuntimeContract;
      this.contracts.set(pluginId, contract);
      return contract;
    }

    return null;
  }

  getEntry(pluginId: string): PluginRuntimeMapEntry | null {
    return this.entries.get(pluginId) ?? null;
  }

  list(): PluginRuntimeContract[] {
    return [...this.contracts.values()];
  }

  async getOrLoad(
    pluginId: string,
    entry?: PluginRuntimeMapEntry | null
  ): Promise<PluginRuntimeContract> {
    const cached = this.get(pluginId);
    if (cached) {
      return cached;
    }

    const contract = await loadPluginRuntimeContract({ pluginId, entry });
    this.registerContract(contract, { replace: true, entry: entry ?? undefined });
    return contract;
  }

  matchPage(
    pluginId: string,
    path: string,
    area?: RuntimePageRoute['area']
  ): RuntimePageRoute | null {
    const contract = this.get(pluginId);
    return contract
      ? (findRuntimePageRouteMatch(contract.routes.pages, path, area)?.route ?? null)
      : null;
  }

  matchApi(pluginId: string, path: string, method: string): RuntimeApiRoute | null {
    const contract = this.get(pluginId);
    return contract
      ? (findRuntimeApiRouteMatch(contract.routes.apis, path, method)?.route ?? null)
      : null;
  }
}

export const pluginRuntimeRegistry = new PluginRuntimeRegistry();
