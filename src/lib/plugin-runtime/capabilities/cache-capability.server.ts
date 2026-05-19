import 'server-only';

import { revalidatePath, revalidateTag } from 'next/cache';
import { Permission, PluginError, type PluginCache } from '@ploykit/plugin-sdk';
import { enforceCapabilityPermission, type PluginCapabilityScope } from './guards.server';

export interface PluginCacheHost {
  revalidatePath(path: string, type?: 'page' | 'layout'): Promise<void> | void;
  revalidateTag(tag: string): Promise<void> | void;
}

export interface CreatePluginCacheOptions {
  host?: Partial<PluginCacheHost>;
}

function defaultHost(host?: Partial<PluginCacheHost>): PluginCacheHost {
  return {
    revalidatePath(path, type) {
      if (type) {
        revalidatePath(path, type);
      } else {
        revalidatePath(path, undefined);
      }
    },
    revalidateTag(tag) {
      revalidateTag(tag, 'max');
    },
    ...host,
  };
}

function normalizePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.startsWith('/')) {
    throw new PluginError({
      code: 'PLUGIN_CACHE_PATH_INVALID',
      message: 'Cache revalidation path must start with "/".',
      statusCode: 400,
    });
  }
  return trimmed.replace(/\/+/g, '/');
}

function normalizeTag(scope: PluginCapabilityScope, tag: string): string {
  const trimmed = tag.trim();
  if (!trimmed || trimmed.length > 200 || /\s/.test(trimmed)) {
    throw new PluginError({
      code: 'PLUGIN_CACHE_TAG_INVALID',
      message: 'Cache revalidation tag must be non-empty and contain no whitespace.',
      statusCode: 400,
    });
  }
  return `plugin:${scope.contract.id}:${trimmed}`;
}

export function createPluginCacheCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginCacheOptions = {}
): PluginCache {
  const host = defaultHost(options.host);

  return {
    async revalidatePath(input) {
      enforceCapabilityPermission(scope, Permission.CacheRevalidate, 'ctx.cache.revalidatePath');
      const pathInput = typeof input === 'string' ? { path: input } : input;
      await host.revalidatePath(normalizePath(pathInput.path), pathInput.type);
    },
    async revalidateTag(tag) {
      enforceCapabilityPermission(scope, Permission.CacheRevalidate, 'ctx.cache.revalidateTag');
      await host.revalidateTag(normalizeTag(scope, tag));
    },
  };
}
