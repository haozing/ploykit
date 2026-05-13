import 'server-only';

import { PluginError } from '@ploykit/plugin-sdk';
import { matchRuntimePath, normalizeRuntimePath, type PluginRuntimeContract } from '../contract';
import {
  getPluginRuntimeMapEntry,
  listPluginRuntimeIds,
  type PluginRuntimeMapEntry,
} from '../loader';
import { enforcePluginRuntimeEnabled, pluginRuntimeRegistry } from '../registry';
import type { RuntimePageRoute } from '../contract';

export interface PluginPublicRouteAliasMatch {
  pluginId: string;
  contract: PluginRuntimeContract;
  route: RuntimePageRoute;
  aliasPath: string;
  requestPath: string;
  slug: string[];
  entry: PluginRuntimeMapEntry | null;
}

export interface ResolvePluginPublicRouteAliasOptions {
  entries?: Record<string, PluginRuntimeMapEntry>;
  enforceInstallation?: boolean;
}

function pathToSlug(path: string): string[] {
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

export async function resolvePluginPublicRouteAlias(
  path: string,
  options: ResolvePluginPublicRouteAliasOptions = {}
): Promise<PluginPublicRouteAliasMatch | null> {
  const requestPath = normalizeRuntimePath(path);
  const entries = options.entries ?? {};
  const candidateIds = new Set([...Object.keys(entries), ...listPluginRuntimeIds()]);

  for (const pluginId of candidateIds) {
    const entry = entries[pluginId] ?? getPluginRuntimeMapEntry(pluginId);
    const contract = await resolveCandidateContract(pluginId, entry);
    if (!contract) {
      continue;
    }

    for (const route of contract.routes.pages) {
      if (route.area !== 'public' || route.layout !== 'site') {
        continue;
      }

      const alias = route.publicAliases.find((candidate) =>
        matchRuntimePath(candidate.path, requestPath)
      );
      if (!alias) {
        continue;
      }

      await enforcePluginRuntimeEnabled(pluginId, {
        enforce: options.enforceInstallation ?? !options.entries,
      });

      return {
        pluginId,
        contract,
        route,
        aliasPath: alias.path,
        requestPath,
        slug: pathToSlug(route.path),
        entry,
      };
    }
  }

  return null;
}
