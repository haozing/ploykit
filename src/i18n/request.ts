import { getRequestConfig } from 'next-intl/server';
import { unstable_noStore as noStore } from 'next/cache';
import { locales, type Locale } from './config';
import { getEnabledPlugins } from '@/lib/bus/hook-helpers.server';
import { logger } from '@/lib/_core/logger';
import { env } from '@/lib/_core/env';
import { pluginRuntimeRegistry } from '@/lib/plugin-runtime/registry';
import {
  validateDeclaredPluginResources,
  validateResourceFile,
} from '@/lib/plugins/resources/plugin-resource-policy.server';
import fs from 'fs';
import path from 'path';

const pluginTranslationCache = new Map<string, Record<string, unknown>>();

function normalizePluginResourcePath(resourcePath: string): string {
  return resourcePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function resolveLocalesDir(): string {
  const candidates = [
    path.join(process.cwd(), 'locales'),
    path.join(process.cwd(), 'web', 'locales'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  return candidates[0];
}

async function loadMainTranslations(locale: string): Promise<Record<string, unknown>> {
  const localesDir = resolveLocalesDir();
  const filePath = path.join(localesDir, `${locale}.json`);

  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    }
  } catch (error) {
    logger.warn({ locale, filePath, error }, 'Failed to read locale JSON from disk, falling back');
  }

  // Fallback to bundler import (works in environments without filesystem access)
  return (await import(`../../locales/${locale}.json`)).default as Record<string, unknown>;
}

/**
 * Load plugin translation files
 *
 * @param locale - Language code
 * @returns Plugin translation object, format is { pluginId: translations }
 */
async function loadPluginTranslations(
  locale: string
): Promise<Record<string, Record<string, unknown>>> {
  const pluginTranslations: Record<string, Record<string, unknown>> = {};

  try {
    // Get all enabled plugins
    const enabledPluginIds = await getEnabledPlugins('i18n');

    logger.debug(
      { enabledPlugins: enabledPluginIds, locale },
      '🌍 Loading translations for enabled plugins'
    );

    // Load translations for each plugin
    for (const pluginId of enabledPluginIds) {
      try {
        const contract = await pluginRuntimeRegistry.getOrLoad(pluginId);
        const declaredLocalePath = contract.resources.locales?.[locale];

        if (!declaredLocalePath) {
          logger.debug(
            { pluginId, locale },
            'Plugin locale resource is not declared in plugin.ts resources, skipping'
          );
          continue;
        }

        const resourcePath = normalizePluginResourcePath(declaredLocalePath);
        const declaredResources = validateDeclaredPluginResources(pluginId, [resourcePath]);

        if (!declaredResources.valid) {
          logger.warn(
            { pluginId, locale, errors: declaredResources.errors },
            'Plugin resource declarations are invalid, skipping translation load'
          );
          continue;
        }

        const cacheKey = `${pluginId}:${locale}`;
        if (env.NODE_ENV === 'production' && pluginTranslationCache.has(cacheKey)) {
          pluginTranslations[pluginId] = pluginTranslationCache.get(cacheKey)!;
          continue;
        }

        // Construct translation file path
        const translationPath = path.join(process.cwd(), 'plugins', pluginId, resourcePath);

        // Check if translation file exists
        if (!fs.existsSync(translationPath)) {
          logger.debug(
            { pluginId, locale, path: translationPath },
            'Plugin translation file not found, skipping'
          );
          continue;
        }

        const rawTranslations = fs.readFileSync(translationPath, 'utf-8');
        const validation = validateResourceFile(resourcePath, rawTranslations, pluginId);
        if (!validation.valid) {
          logger.warn(
            { pluginId, locale, resourcePath, reason: validation.reason },
            'Plugin translation file failed resource policy validation'
          );
          continue;
        }

        // Read and parse translation file
        const translations = JSON.parse(rawTranslations) as Record<string, unknown>;

        // Store translations with plugin namespace
        pluginTranslations[pluginId] = translations;
        if (env.NODE_ENV === 'production') {
          pluginTranslationCache.set(cacheKey, translations);
        }

        logger.debug(
          { pluginId, locale, keys: Object.keys(translations) },
          '✅ Plugin translation loaded successfully'
        );
      } catch (error) {
        logger.error({ pluginId, locale, error }, 'Failed to load plugin translation file');
        // Continue processing other plugins
      }
    }
  } catch (error) {
    logger.error({ locale, error }, 'Failed to load plugin translations');
  }

  return pluginTranslations;
}

export default getRequestConfig(async ({ requestLocale }) => {
  // In development, avoid caching message bundles so plugin locale edits take effect without restart.
  if (env.NODE_ENV === 'development') {
    noStore();
  }

  // Verify and use requested language
  let locale = await requestLocale;

  if (!locale || !locales.includes(locale as Locale)) {
    locale = 'zh'; // Default fallback
  }

  // Load main application translations
  const mainMessages = await loadMainTranslations(locale);

  // Load plugin translations
  const pluginMessages = await loadPluginTranslations(locale);

  // Merge all translations
  const messages = {
    ...mainMessages,
    ...pluginMessages,
  };

  logger.debug(
    {
      locale,
      mainKeys: Object.keys(mainMessages),
      pluginNamespaces: Object.keys(pluginMessages),
      totalKeys: Object.keys(messages),
    },
    '🌍 i18n messages loaded and merged'
  );

  return {
    locale,
    messages,
    timeZone: 'Asia/Shanghai',
  };
});
