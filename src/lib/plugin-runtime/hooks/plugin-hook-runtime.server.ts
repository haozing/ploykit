import { PluginError, type PluginContext } from '@ploykit/plugin-sdk';
import { unifiedHookSystem } from '@/lib/bus/hooks/unified-system';
import type { AllHookName, HookExecutionContext } from '@/lib/bus/hooks';
import {
  getPluginRuntimeMapEntry,
  resolvePluginHookModule,
  type PluginRuntimeMapEntry,
} from '../loader';
import { pluginRuntimeRegistry } from '../registry';
import type { PluginRuntimeContract } from '../contract';

type PluginHookKey = 'renderHead' | 'sitemap';

export interface RegisteredPluginHook {
  hook: AllHookName;
  key: PluginHookKey;
  handler: string;
  priority: number;
}

export interface PluginRuntimeHookMetadata {
  key: PluginHookKey;
  hook: AllHookName;
}

type PluginRuntimeHookHandler = (
  ctx: PluginContext,
  payload: unknown | undefined,
  metadata: PluginRuntimeHookMetadata,
  hookContext: HookExecutionContext
) => unknown | Promise<unknown>;

const HOOK_NAME_BY_KEY: Record<PluginHookKey, AllHookName> = {
  renderHead: 'onRenderHead',
  sitemap: 'onSitemap',
};

function extractPluginHookHandler(module: unknown, key: PluginHookKey): PluginRuntimeHookHandler {
  if (typeof module === 'function') {
    return module as PluginRuntimeHookHandler;
  }

  if (module && typeof module === 'object') {
    const mod = module as Record<string, unknown>;
    const defaultExport = mod.default;
    const handler =
      mod[key] ??
      mod.handler ??
      (defaultExport && typeof defaultExport === 'object'
        ? ((defaultExport as Record<string, unknown>)[key] ??
          (defaultExport as Record<string, unknown>).handler)
        : defaultExport);

    if (typeof handler === 'function') {
      return handler as PluginRuntimeHookHandler;
    }
  }

  throw new PluginError({
    code: 'PLUGIN_HOOK_HANDLER_INVALID',
    message: `Hook module for "${key}" must export a handler function.`,
    statusCode: 500,
    fix: 'Export a default function, named handler, or named hook function from the hook module.',
    details: {
      hook: key,
    },
  });
}

async function resolveContract(
  pluginId: string,
  entry: PluginRuntimeMapEntry | null
): Promise<PluginRuntimeContract> {
  return pluginRuntimeRegistry.getOrLoad(pluginId, entry);
}

export async function registerPluginRuntimeHooks(
  pluginId: string,
  entry: PluginRuntimeMapEntry | null = getPluginRuntimeMapEntry(pluginId)
): Promise<RegisteredPluginHook[]> {
  const contract = await resolveContract(pluginId, entry);
  unregisterPluginRuntimeHooks(pluginId);

  const registered: RegisteredPluginHook[] = [];

  for (const key of Object.keys(HOOK_NAME_BY_KEY) as PluginHookKey[]) {
    const declaration = contract.hooks[key];
    if (!declaration) {
      continue;
    }

    const moduleLoader = entry ? resolvePluginHookModule(entry, declaration.handler) : null;
    if (!moduleLoader) {
      throw new PluginError({
        code: 'PLUGIN_HOOK_HANDLER_NOT_FOUND',
        message: `Hook handler "${declaration.handler}" was not found for plugin "${pluginId}".`,
        statusCode: 500,
        fix: 'Run npm run plugins:scan and ensure the hook handler exists inside the plugin.',
        details: {
          pluginId,
          hook: key,
          handler: declaration.handler,
        },
      });
    }

    const hookName = HOOK_NAME_BY_KEY[key];
    const pluginHandler = extractPluginHookHandler(await moduleLoader(), key);
    const priority = declaration.priority ?? 100;

    unifiedHookSystem.register(
      pluginId,
      hookName,
      async (hookContext) =>
        pluginHandler(
          hookContext.plugin,
          hookContext.payload,
          { key, hook: hookName },
          hookContext
        ),
      priority
    );

    registered.push({
      hook: hookName,
      key,
      handler: declaration.handler,
      priority,
    });
  }

  return registered;
}

export function unregisterPluginRuntimeHooks(pluginId: string): number {
  const removed = unifiedHookSystem.getPluginHooks(pluginId).length;
  unifiedHookSystem.unregister(pluginId);
  return removed;
}
