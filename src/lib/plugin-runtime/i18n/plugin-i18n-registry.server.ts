import 'server-only';

import fs from 'fs';
import path from 'path';
import { cache } from 'react';
import { logger } from '@/lib/_core/logger';
import { pluginRuntimeRegistry } from '../registry';

export type PluginMessages = Record<string, unknown>;

function normalizeResourcePath(resourcePath: string): string {
  return resourcePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

export const loadPluginLocaleMessages = cache(
  async (pluginId: string, locale: string): Promise<PluginMessages | null> => {
    try {
      const contract = await pluginRuntimeRegistry.getOrLoad(pluginId);
      const declaredPath = contract.resources.locales?.[locale];
      if (!declaredPath) {
        return null;
      }

      const resourcePath = normalizeResourcePath(declaredPath);
      const filePath = path.join(process.cwd(), 'plugins', pluginId, resourcePath);
      if (!fs.existsSync(filePath)) {
        return null;
      }

      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as PluginMessages;
    } catch (error) {
      logger.warn({ pluginId, locale, error }, 'Failed to load plugin locale messages');
      return null;
    }
  }
);

function readPath(source: PluginMessages, key: string): string | null {
  const value = key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, source);

  return typeof value === 'string' && value.trim() ? value : null;
}

export async function translatePluginMessage(input: {
  pluginId: string;
  locale: string;
  key: string;
  fallback?: string;
}): Promise<string> {
  const messages = await loadPluginLocaleMessages(input.pluginId, input.locale);
  return (messages ? readPath(messages, input.key) : null) ?? input.fallback ?? input.key;
}
