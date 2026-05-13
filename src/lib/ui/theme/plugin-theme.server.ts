import 'server-only';

import { getEnabledPlugins } from '@/lib/bus/hook-helpers.server';
import { logger } from '@/lib/_core/logger';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime/registry';
import type { PluginThemeDefinition, PluginThemeTokenOverrides } from '@ploykit/plugin-sdk';
import type { ThemeTokens } from './types';

const THEME_TRUST_LEVELS = new Set(['trusted', 'system']);

function mergeSection<TSection extends object>(
  current: TSection,
  overrides: Partial<TSection> | undefined
): TSection {
  return overrides ? ({ ...current, ...overrides } as TSection) : current;
}

export function applyPluginThemeTokens(
  baseTokens: ThemeTokens,
  overrides: PluginThemeTokenOverrides
): ThemeTokens {
  return {
    common: mergeSection<ThemeTokens['common']>(baseTokens.common, overrides.common),
    header: mergeSection<ThemeTokens['header']>(baseTokens.header, overrides.header),
    footer: mergeSection<ThemeTokens['footer']>(baseTokens.footer, overrides.footer),
    content: mergeSection<ThemeTokens['content']>(baseTokens.content, overrides.content),
  };
}

export async function listEnabledPluginThemes(input?: {
  pluginIds?: readonly string[];
}): Promise<Array<{ pluginId: string; theme: PluginThemeDefinition }>> {
  const pluginIds = input?.pluginIds ?? (await getEnabledPlugins());
  const themes: Array<{ pluginId: string; theme: PluginThemeDefinition }> = [];

  for (const pluginId of pluginIds) {
    try {
      const contract = await pluginRuntimeRegistry.getOrLoad(pluginId);
      if (!contract.theme) {
        continue;
      }

      if (!THEME_TRUST_LEVELS.has(contract.trustLevel)) {
        logger.warn(
          { pluginId, trustLevel: contract.trustLevel },
          'Plugin theme ignored because the plugin is not trusted'
        );
        continue;
      }

      themes.push({ pluginId, theme: contract.theme });
    } catch (error) {
      logger.warn({ pluginId, error }, 'Failed to load plugin theme');
    }
  }

  return themes;
}

export async function resolvePluginThemeTokens(
  baseTokens: ThemeTokens,
  input?: { pluginIds?: readonly string[] }
): Promise<ThemeTokens> {
  const themes = await listEnabledPluginThemes(input);
  return themes.reduce(
    (tokens, item) => applyPluginThemeTokens(tokens, item.theme.tokens),
    baseTokens
  );
}
