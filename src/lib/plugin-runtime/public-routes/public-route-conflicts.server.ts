import 'server-only';

import { findPluginRoutePatternConflict } from '@/plugin-sdk/route-patterns';
import { logger } from '@/lib/_core/logger';
import { normalizeRuntimePath } from '../contract';
import { pluginRuntimeRegistry } from '../registry';

export interface PluginPublicAliasConflict {
  code: 'PLUGIN_PUBLIC_ALIAS_GLOBAL_CONFLICT';
  firstPluginId: string;
  firstPath: string;
  secondPluginId: string;
  secondPath: string;
  samplePath: string;
}

interface PublicAliasDeclaration {
  pluginId: string;
  path: string;
}

async function listPublicAliasDeclarations(
  pluginIds: readonly string[]
): Promise<PublicAliasDeclaration[]> {
  const declarations: PublicAliasDeclaration[] = [];

  for (const pluginId of pluginIds) {
    try {
      const contract = await pluginRuntimeRegistry.getOrLoad(pluginId);
      for (const route of contract.routes.pages) {
        for (const alias of route.publicAliases) {
          declarations.push({
            pluginId,
            path: normalizeRuntimePath(alias.path),
          });
        }
      }
    } catch (error) {
      logger.warn({ pluginId, error }, 'Failed to inspect plugin public route aliases');
    }
  }

  return declarations;
}

async function resolvePluginIds(input?: {
  pluginIds?: readonly string[];
}): Promise<readonly string[]> {
  if (input?.pluginIds) {
    return input.pluginIds;
  }

  const { getEnabledPlugins } = await import('@/lib/bus/hook-helpers.server');
  return getEnabledPlugins();
}

export async function findPluginPublicAliasConflicts(input?: {
  pluginIds?: readonly string[];
}): Promise<PluginPublicAliasConflict[]> {
  const pluginIds = await resolvePluginIds(input);
  const declarations = await listPublicAliasDeclarations(pluginIds);
  const conflicts: PluginPublicAliasConflict[] = [];

  for (let index = 0; index < declarations.length; index += 1) {
    const current = declarations[index];

    for (const previous of declarations.slice(0, index)) {
      const conflict = findPluginRoutePatternConflict(previous.path, current.path);
      if (!conflict) {
        continue;
      }

      conflicts.push({
        code: 'PLUGIN_PUBLIC_ALIAS_GLOBAL_CONFLICT',
        firstPluginId: previous.pluginId,
        firstPath: previous.path,
        secondPluginId: current.pluginId,
        secondPath: current.path,
        samplePath: conflict.samplePath,
      });
    }
  }

  return conflicts;
}

export async function assertNoPluginPublicAliasConflicts(input?: {
  pluginIds?: readonly string[];
}): Promise<void> {
  const conflicts = await findPluginPublicAliasConflicts(input);
  if (conflicts.length === 0) {
    return;
  }

  const conflict = conflicts[0];
  throw new Error(
    `PLUGIN_PUBLIC_ALIAS_GLOBAL_CONFLICT: ${conflict.firstPluginId}:${conflict.firstPath} overlaps with ${conflict.secondPluginId}:${conflict.secondPath} at ${conflict.samplePath}.`
  );
}
