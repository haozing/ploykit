import 'server-only';

import { PluginError } from '@ploykit/plugin-sdk';
import { normalizeRuntimePath, type PluginRuntimeContract } from '../contract';
import { getPluginRuntimeMapEntry, type PluginRuntimeMapEntry } from '../loader';
import { enforcePluginRuntimeEnabled, pluginRuntimeRegistry } from '../registry';
import { runtimeScopeService } from '../scope';

export interface PluginToolRouteMatch {
  pluginId: string;
  contract: PluginRuntimeContract;
  localPath: string;
  slug: string[];
  entry: PluginRuntimeMapEntry | null;
}

export interface ResolvePluginToolRouteOptions {
  entries?: Record<string, PluginRuntimeMapEntry>;
  enforceInstallation?: boolean;
}

function routeToSlug(path: string): string[] {
  const normalized = normalizeRuntimePath(path);
  return normalized === '/' ? [] : normalized.slice(1).split('/').filter(Boolean);
}

async function resolveCandidateContract(
  pluginId: string,
  entry: PluginRuntimeMapEntry | null
): Promise<PluginRuntimeContract | null> {
  try {
    return await pluginRuntimeRegistry.getOrLoad(pluginId, entry);
  } catch (error) {
    if (
      error instanceof PluginError &&
      ['PLUGIN_RUNTIME_NOT_FOUND', 'PLUGIN_RUNTIME_CONTRACT_MISSING'].includes(error.code)
    ) {
      return null;
    }

    throw error;
  }
}

export async function resolvePluginToolRoute(
  path: string,
  options: ResolvePluginToolRouteOptions = {}
): Promise<PluginToolRouteMatch | null> {
  const localPath = normalizeRuntimePath(path);
  const entries = options.entries ?? {};
  const scopedPluginIds = options.entries
    ? []
    : await runtimeScopeService.listRuntimePluginIds({
        surface: 'route',
        includeDisabled: Boolean(options.entries),
      });
  const candidateIds = new Set([...Object.keys(entries), ...scopedPluginIds]);

  for (const pluginId of candidateIds) {
    const entry = entries[pluginId] ?? getPluginRuntimeMapEntry(pluginId);
    const contract = await resolveCandidateContract(pluginId, entry);
    if (!contract) {
      continue;
    }

    const route = contract.routes.pages.find(
      (candidate) => candidate.tool && candidate.path === localPath
    );
    if (!route) {
      continue;
    }

    await enforcePluginRuntimeEnabled(pluginId, {
      enforce: options.enforceInstallation ?? !options.entries,
    });

    return {
      pluginId,
      contract,
      localPath,
      slug: routeToSlug(localPath),
      entry,
    };
  }

  return null;
}
