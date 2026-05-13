/**
 * ==========================================================================
 * ==========================================================================
 *
 *
 */

import { siteConfig } from '@/site.config';
import { getThemeTokens } from '@/theme.config';
import { resolvePluginThemeTokens } from './plugin-theme.server';
import { tokensToCSS } from './theme-css';
import type { ThemeTokens } from './types';
import { logger } from '@/lib/_core/logger';

/**
 * ==========================================================================
 * Load Design Tokens
 * ==========================================================================
 *
 *
 * @returns ThemeTokens
 */
export async function loadThemeTokens(): Promise<ThemeTokens> {
  const source = siteConfig.theme.tokens;

  try {
    if (source === 'default') {
      logger.debug('Loading default theme tokens');
      return getThemeTokens();
    }

    if (source.startsWith('plugin:')) {
      const pluginId = source.replace('plugin:', '');
      return resolvePluginThemeTokens(getThemeTokens(), { pluginIds: [pluginId] });
    }

    logger.warn({ source }, 'Invalid theme source, falling back to default');
    return getThemeTokens();
  } catch (error) {
    logger.error({ error, source }, 'Failed to load theme tokens, using default');
    return getThemeTokens();
  }
}

/**
 * ==========================================================================
 * ==========================================================================
 *
 *
 * @param tokens - Design Tokens
 *
 * @example
 * ```css
 * :root {
 *   --color-bg: #ffffff;
 *   --color-text: #0a0a0a;
 *   --header-bg: #ffffff;
 *   ...
 * }
 * ```
 */
export { tokensToCSS };
