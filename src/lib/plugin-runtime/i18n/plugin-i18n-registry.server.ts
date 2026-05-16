import 'server-only';

import fs from 'fs';
import path from 'path';
import { cache } from 'react';
import type { PluginI18nRuntime } from '@ploykit/plugin-sdk';
import { logger } from '@/lib/_core/logger';
import { env } from '@/lib/_core/env';
import {
  validateDeclaredPluginResources,
  validateResourceFile,
} from '@/lib/plugins/resources/plugin-resource-policy.server';
import type { PluginRuntimeContract } from '../contract';
import { pluginRuntimeRegistry } from '../registry';

export type PluginMessages = Record<string, unknown>;

const pluginTranslationCache = new Map<string, PluginMessages>();

function normalizeResourcePath(resourcePath: string): string {
  return resourcePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function localeCandidates(locale: string): string[] {
  const normalized = locale.trim();
  const base = normalized.split('-')[0];
  return [...new Set([normalized, base].filter(Boolean))];
}

export const loadPluginLocaleMessages = cache(
  async (pluginId: string, locale: string): Promise<PluginMessages | null> => {
    try {
      const contract = await pluginRuntimeRegistry.getOrLoad(pluginId);
      return loadPluginLocaleMessagesForContract(contract, locale);
    } catch (error) {
      logger.warn({ pluginId, locale, error }, 'Failed to load plugin locale messages');
      return null;
    }
  }
);

export async function loadPluginLocaleMessagesForContract(
  contract: PluginRuntimeContract,
  locale: string
): Promise<PluginMessages | null> {
  const matchedLocale = localeCandidates(locale).find(
    (candidate) => contract.resources.locales?.[candidate]
  );
  if (!matchedLocale) {
    return null;
  }

  const declaredPath = contract.resources.locales?.[matchedLocale];
  if (!declaredPath) {
    return null;
  }

  const cacheKey = `${contract.id}:${matchedLocale}`;
  if (env.NODE_ENV === 'production' && pluginTranslationCache.has(cacheKey)) {
    return pluginTranslationCache.get(cacheKey)!;
  }

  const resourcePath = normalizeResourcePath(declaredPath);
  const declaredResources = validateDeclaredPluginResources(contract.id, [resourcePath]);
  if (!declaredResources.valid) {
    logger.warn(
      { pluginId: contract.id, locale: matchedLocale, errors: declaredResources.errors },
      'Plugin locale resource declaration is invalid'
    );
    return null;
  }

  const filePath = path.join(process.cwd(), 'plugins', contract.id, resourcePath);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const rawMessages = fs.readFileSync(filePath, 'utf-8');
    const validation = validateResourceFile(resourcePath, rawMessages, contract.id);
    if (!validation.valid) {
      logger.warn(
        { pluginId: contract.id, locale: matchedLocale, resourcePath, reason: validation.reason },
        'Plugin locale resource failed policy validation'
      );
      return null;
    }

    const messages = JSON.parse(rawMessages) as PluginMessages;
    if (env.NODE_ENV === 'production') {
      pluginTranslationCache.set(cacheKey, messages);
    }

    return messages;
  } catch (error) {
    logger.warn(
      { pluginId: contract.id, locale: matchedLocale, resourcePath, error },
      'Failed to read plugin locale resource'
    );
    return null;
  }
}

export async function resolvePluginI18nRuntime(
  pluginId: string,
  locale: string
): Promise<PluginI18nRuntime> {
  const messages = await loadPluginLocaleMessages(pluginId, locale);
  return {
    locale,
    messages: (messages ?? {}) as PluginI18nRuntime['messages'],
  };
}

export async function resolvePluginI18nRuntimeForContract(
  contract: PluginRuntimeContract,
  locale: string
): Promise<PluginI18nRuntime> {
  const messages = await loadPluginLocaleMessagesForContract(contract, locale);
  return {
    locale,
    messages: (messages ?? {}) as PluginI18nRuntime['messages'],
  };
}

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
