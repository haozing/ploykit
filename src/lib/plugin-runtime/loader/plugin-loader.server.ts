import { PluginError, type DefinedApi, type DefinedPlugin } from '@ploykit/plugin-sdk';
import {
  assertValidPluginRuntimeContract,
  isDefinedPlugin,
  normalizePluginRuntimeContract,
  type PluginRuntimeContract,
} from '../contract';
import { getPluginRuntimeMapEntry, type PluginRuntimeMapEntry } from './module-resolver.server';

export interface LoadPluginRuntimeOptions {
  pluginId: string;
  entry?: PluginRuntimeMapEntry | null;
}

function extractDefinedPlugin(module: unknown, pluginId: string): DefinedPlugin {
  if (isDefinedPlugin(module)) {
    return module;
  }

  if (module && typeof module === 'object') {
    const mod = module as Record<string, unknown>;
    const candidate = mod.default ?? mod.plugin;

    if (isDefinedPlugin(candidate)) {
      return candidate;
    }
  }

  throw new PluginError({
    code: 'PLUGIN_RUNTIME_CONTRACT_MISSING',
    message: `Plugin "${pluginId}" does not export a definePlugin() contract.`,
    statusCode: 500,
    fix: 'Export default definePlugin(...) from plugin.ts.',
  });
}

export function extractDefinedApi(module: unknown): DefinedApi {
  if (module && typeof module === 'object') {
    const mod = module as Record<string, unknown>;
    const candidate = mod.default ?? mod.api ?? module;

    if (
      candidate &&
      typeof candidate === 'object' &&
      '$$ploykit' in candidate &&
      (candidate as { $$ploykit?: { type?: unknown } }).$$ploykit?.type === 'ploykit.api'
    ) {
      return candidate as DefinedApi;
    }
  }

  throw new PluginError({
    code: 'PLUGIN_RUNTIME_API_INVALID',
    message: 'Plugin API module does not export defineApi(...).',
    statusCode: 500,
    fix: 'Export default defineApi({ get/post/... }) from the declared API handler module.',
  });
}

export async function loadPluginRuntimeContract(
  options: LoadPluginRuntimeOptions
): Promise<PluginRuntimeContract> {
  const entry = options.entry ?? getPluginRuntimeMapEntry(options.pluginId);

  if (!entry) {
    throw new PluginError({
      code: 'PLUGIN_RUNTIME_NOT_FOUND',
      message: `Plugin "${options.pluginId}" is not present in the runtime plugin map.`,
      statusCode: 404,
      fix: 'Run npm run plugins:scan after adding the plugin.',
    });
  }

  if (entry.runtimeContract) {
    return entry.runtimeContract;
  }

  if (!entry.plugin) {
    throw new PluginError({
      code: 'PLUGIN_RUNTIME_CONTRACT_LOADER_MISSING',
      message: `Plugin "${options.pluginId}" has no plugin.ts loader in the runtime plugin map.`,
      statusCode: 500,
      fix: 'Add plugin.ts and run npm run plugins:scan.',
    });
  }

  const pluginModule = await entry.plugin();
  const definition = extractDefinedPlugin(pluginModule, options.pluginId);
  const contract = normalizePluginRuntimeContract(definition);
  assertValidPluginRuntimeContract(definition, contract);

  if (contract.id !== options.pluginId) {
    throw new PluginError({
      code: 'PLUGIN_RUNTIME_ID_MISMATCH',
      message: `Plugin contract id "${contract.id}" does not match loader id "${options.pluginId}".`,
      statusCode: 500,
      fix: 'Make plugin.ts id match the plugin directory name.',
    });
  }

  return contract;
}
