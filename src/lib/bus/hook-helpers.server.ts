/**
 * Hook Helpers
 *
 * Server-side utilities for triggering hooks from the global plugin system.
 */

import 'server-only';

import { db } from '@/lib/db/client.server';
import { pluginInstallations } from '@/lib/db/schema/plugins';
import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { cache } from 'react';
import { unifiedHookSystem } from './hooks/unified-system';
import { logger } from '@/lib/_core/logger';
import { auth } from '@/lib/auth/server';
import { normalizeSitemapEntry } from '@/lib/seo/sitemap-policy';
import type { MetadataRoute } from 'next';
import {
  getPluginHeadTagAllowedSources,
  getPluginTrustLevel,
  sanitizeHeadTags,
} from '@/lib/plugins/head/head-tag-policy.server';

function isDynamicServerUsageError(error: unknown): boolean {
  const candidate = error as { digest?: unknown; message?: unknown; description?: unknown };
  const text = [candidate.digest, candidate.message, candidate.description]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');

  return text.includes('DYNAMIC_SERVER_USAGE') || text.includes("couldn't be rendered statically");
}

/**
 * Get user ID from session headers
 */
export const getUserIdFromHeaders = cache(async (): Promise<string | undefined> => {
  try {
    const session = await auth.api.getSession({
      headers: await headers(),
    });

    return session?.user?.id;
  } catch (error) {
    if (isDynamicServerUsageError(error)) {
      return undefined;
    }

    logger.warn({ error }, 'Failed to get user ID from session');
    return undefined;
  }
});

/**
 * Get request ID from headers
 */
export async function getRequestIdFromHeaders(): Promise<string> {
  try {
    const headersList = await headers();
    return headersList.get('x-request-id') || 'unknown';
  } catch (error) {
    if (isDynamicServerUsageError(error)) {
      return 'static-build';
    }

    throw error;
  }
}

export async function getPathnameFromHeaders(): Promise<string> {
  try {
    const headersList = await headers();
    return headersList.get('x-pathname') || '/';
  } catch (error) {
    if (isDynamicServerUsageError(error)) {
      return '/';
    }

    throw error;
  }
}

export async function getUrlFromHeaders(): Promise<string> {
  try {
    const headersList = await headers();
    return headersList.get('x-url') || '';
  } catch (error) {
    if (isDynamicServerUsageError(error)) {
      return '';
    }

    throw error;
  }
}

// Query (Global)

/**
 * Get all enabled plugins
 */
export const getEnabledPlugins = cache(async (): Promise<string[]> => {
  try {
    const installations = await db
      .select({ pluginId: pluginInstallations.pluginId })
      .from(pluginInstallations)
      .where(eq(pluginInstallations.enabled, true));

    return installations.map((i) => i.pluginId);
  } catch (error) {
    logger.error({ error }, 'Failed to get enabled plugins');
    return [];
  }
});

/**
 * Check if a plugin is enabled
 *
 * @param pluginId - Plugin identifier
 */
export async function isPluginEnabled(pluginId: string): Promise<boolean> {
  const enabledPlugins = await getEnabledPlugins();
  return enabledPlugins.includes(pluginId);
}

/**
 * Build hook execution environment
 *
 * @param options - Environment options
 * @returns Execution environment object
 */
export async function buildHookEnvironment(options: {
  userId?: string;
  requestId?: string;
}): Promise<{
  userId?: string;
  requestId?: string;
}> {
  return {
    userId: options.userId,
    requestId: options.requestId || (await getRequestIdFromHeaders()),
  };
}

/**
 * Trigger onRenderHead hook
 *
 * @returns Array of head tags
 *
 * @example
 * ```typescript
 * // In layout.tsx
 * const headTags = await triggerRenderHeadHook({
 *   url: '/products',
 *   userId: await getUserIdFromHeaders(),
 * });
 * ```
 */
export async function triggerRenderHeadHook(options?: {
  url?: string;
  pathname?: string;
  userId?: string;
}): Promise<HeadTag[]> {
  try {
    const enabledPlugins = await getEnabledPlugins();
    if (enabledPlugins.length === 0) {
      return [];
    }

    const environment = await buildHookEnvironment({
      userId: options?.userId,
    });

    const results = await unifiedHookSystem.executeAndMerge<'onRenderHead', HeadTag>(
      'onRenderHead',
      environment,
      {
        url: options?.url || '',
        pathname: options?.pathname || '/',
      },
      {
        pluginIds: enabledPlugins,
      }
    );

    logger.debug({ tagCount: results.length }, 'Collected raw head tags from plugins');

    return results;
  } catch (error) {
    if (isDynamicServerUsageError(error)) {
      return [];
    }

    logger.error({ error }, 'Failed to trigger onRenderHead hook');
    return [];
  }
}

/**
 * Trigger onRenderHead hook and keep plugin ownership for per-plugin policy.
 */
export async function triggerRenderHeadHookResults(options?: {
  url?: string;
  pathname?: string;
  userId?: string;
}): Promise<PluginHeadTagResult[]> {
  try {
    const enabledPlugins = await getEnabledPlugins();
    if (enabledPlugins.length === 0) {
      return [];
    }

    const environment = await buildHookEnvironment({
      userId: options?.userId,
    });

    const executionResults = await unifiedHookSystem.execute(
      'onRenderHead',
      environment,
      {
        url: options?.url || '',
        pathname: options?.pathname || '/',
      },
      {
        pluginIds: enabledPlugins,
      }
    );

    return executionResults
      .filter((result) => result.success && result.data != null)
      .flatMap((result) => {
        const tags = Array.isArray(result.data) ? result.data : [result.data];
        return tags.map((tag) => ({
          pluginId: result.pluginId,
          tag: tag as HeadTag,
        }));
      });
  } catch (error) {
    if (isDynamicServerUsageError(error)) {
      return [];
    }

    logger.error({ error }, 'Failed to trigger onRenderHead hook results');
    return [];
  }
}

/**
 * Collect and sanitize render head tags per plugin trust level.
 */
export async function collectPluginHeadTags(options?: {
  url?: string;
  pathname?: string;
  userId?: string;
  nonce?: string;
}): Promise<HeadTag[]> {
  const resolvedOptions = {
    url: options?.url ?? (await getUrlFromHeaders()),
    pathname: options?.pathname ?? (await getPathnameFromHeaders()),
    userId: options?.userId,
    nonce: options?.nonce,
  };
  const results = await triggerRenderHeadHookResults(resolvedOptions);
  const allowed: HeadTag[] = [];

  for (const result of results) {
    const policyResult = sanitizeHeadTags([result.tag], {
      trustLevel: await getPluginTrustLevel(result.pluginId),
      allowedSources: await getPluginHeadTagAllowedSources(result.pluginId),
      nonce: resolvedOptions.nonce,
    });

    allowed.push(...policyResult.allowed);
  }

  return dedupeHeadTags(sortHeadTags(allowed));
}

/**
 * Trigger onBeforeHandle hook
 *
 * @example
 * ```typescript
 * // In route.ts
 * const userId = await getUserIdFromHeaders();
 * const result = await triggerBeforeHandleHook({
 *   request,
 *   route: {
 *     path: '/api/orders',
 *     method: 'POST',
 *   },
 *   userId,
 * });
 *
 * if (result.cancel) {
 *   return new Response('Cancelled by plugin', { status: 403 });
 * }
 * ```
 */
export async function triggerBeforeHandleHook(options: {
  request: Request;
  route: {
    path: string;
    method: string;
  };
  userId?: string;
}): Promise<BeforeHandleResult> {
  try {
    const enabledPlugins = await getEnabledPlugins();
    if (enabledPlugins.length === 0) {
      return {};
    }

    const environment = await buildHookEnvironment({
      userId: options.userId,
    });

    const executionResults = await unifiedHookSystem.executeSequential(
      'onBeforeHandle',
      environment,
      {
        request: options.request,
        route: options.route,
      },
      {
        pluginIds: enabledPlugins,
      }
    );

    const merged: BeforeHandleResult = {};

    for (const execResult of executionResults) {
      if (!execResult.success || !execResult.data) continue;
      const result = execResult.data as Partial<BeforeHandleResult>;

      // Merge headers
      if (result.headers) {
        if (!merged.headers) merged.headers = {};
        merged.headers = { ...merged.headers, ...result.headers };
      }

      // Merge cookies
      if (result.cookies) {
        if (!merged.cookies) merged.cookies = {};
        merged.cookies = { ...merged.cookies, ...result.cookies };
      }

      if (result.cancel) {
        merged.cancel = true;
        merged.cancelReason = result.cancelReason || 'Cancelled by plugin';
        break;
      }

      if (result.redirect && !merged.redirect) {
        merged.redirect = result.redirect;
        break;
      }

      if (result.rewrite && !merged.rewrite) {
        merged.rewrite = result.rewrite;
        break;
      }
    }

    logger.debug({ result: merged }, 'Before handle hook completed');

    return merged;
  } catch (error) {
    logger.error({ error }, 'Failed to trigger onBeforeHandle hook');
    return {};
  }
}

/**
 * Trigger onAfterHandle hook
 *
 * @example
 * ```typescript
 * // In route.ts
 * const userId = await getUserIdFromHeaders();
 * await triggerAfterHandleHook({
 *   request,
 *   response,
 *   duration,
 *   userId,
 * });
 * ```
 */
export async function triggerAfterHandleHook(options: {
  request: Request;
  response: Response;
  duration: number;
  userId?: string;
}): Promise<void> {
  try {
    const enabledPlugins = await getEnabledPlugins();

    if (enabledPlugins.length === 0) return;

    const environment = await buildHookEnvironment({
      userId: options.userId,
    });

    await unifiedHookSystem.execute(
      'onAfterHandle',
      environment,
      {
        request: options.request,
        response: options.response,
        duration: options.duration,
      },
      {
        pluginIds: enabledPlugins,
      }
    );

    logger.debug('After handle hook completed');
  } catch (error) {
    logger.error({ error }, 'Failed to trigger onAfterHandle hook');
  }
}

/**
 * Trigger onSitemap hook and merge plugin-provided sitemap entries.
 */
export async function triggerSitemapHook(options: {
  baseUrl: string;
  userId?: string;
}): Promise<SitemapEntry[]> {
  try {
    const enabledPlugins = await getEnabledPlugins();
    if (enabledPlugins.length === 0) {
      return [];
    }

    const environment = await buildHookEnvironment({
      userId: options.userId,
    });

    const results = await unifiedHookSystem.execute(
      'onSitemap',
      environment,
      {
        baseUrl: options.baseUrl,
      },
      {
        pluginIds: enabledPlugins,
      }
    );

    const entries: MetadataRoute.Sitemap = results.flatMap((result) => {
      if (!result.success || result.data == null) {
        return [];
      }

      const values = Array.isArray(result.data) ? result.data : [result.data];
      return values.flatMap((entry) => {
        const normalized = normalizeSitemapEntry(entry as SitemapEntry, {
          source: 'plugin-hook',
          pluginId: result.pluginId,
        });

        return normalized
          ? [
              {
                url: normalized.url,
                lastModified: normalized.lastModified,
                changeFrequency: normalized.changeFrequency,
                priority: normalized.priority,
                alternates: normalized.alternates,
              },
            ]
          : [];
      });
    });

    return dedupeSitemapEntries(
      entries.map((entry) => ({
        url: entry.url,
        lastModified: entry.lastModified,
        changeFrequency: entry.changeFrequency,
        priority: entry.priority,
        alternates: normalizeSitemapAlternates(entry.alternates),
      }))
    );
  } catch (error) {
    if (isDynamicServerUsageError(error)) {
      return [];
    }

    logger.error({ error }, 'Failed to trigger onSitemap hook');
    return [];
  }
}

// Type Definitions

/**
 * Head tag for onRenderHead hook results
 */
export interface HeadTag {
  /** Tag type */
  tag: 'meta' | 'link' | 'script' | 'style' | 'title';

  /** Tag attributes */
  attrs?: Record<string, string>;

  /** Tag content (for script/style) */
  content?: string;

  /** Priority (lower = rendered first) */
  priority?: number;
}

export interface PluginHeadTagResult {
  pluginId: string;
  tag: HeadTag;
}

export interface SitemapEntry {
  url: string;
  lastModified?: string | Date;
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
  alternates?: {
    languages?: Record<string, string>;
  };
}

function normalizeSitemapAlternates(
  alternates: MetadataRoute.Sitemap[number]['alternates']
): SitemapEntry['alternates'] {
  const languages = alternates?.languages;
  if (!languages) {
    return undefined;
  }

  const normalized = Object.fromEntries(
    Object.entries(languages as Record<string, string | undefined>).flatMap(([language, href]) =>
      href ? [[language, href]] : []
    )
  );

  return Object.keys(normalized).length > 0 ? { languages: normalized } : undefined;
}

/**
 * Result for onBeforeHandle hook
 */
export interface BeforeHandleResult {
  /** Whether to cancel request processing */
  cancel?: boolean;

  /** Cancel reason */
  cancelReason?: string;

  /** Redirect URL */
  redirect?: string;

  /** Rewrite to another path */
  rewrite?: string;

  /** Add/modify response headers */
  headers?: Record<string, string>;

  /** Set cookies */
  cookies?: Record<string, string>;
}

function sortHeadTags(tags: HeadTag[]): HeadTag[] {
  return [...tags].sort((a, b) => {
    const priorityA = a.priority ?? 100;
    const priorityB = b.priority ?? 100;
    return priorityA - priorityB;
  });
}

function headTagDedupeKey(tag: HeadTag): string | null {
  if (tag.tag === 'title') {
    return 'title';
  }

  if (tag.tag === 'meta') {
    const key =
      tag.attrs?.name ?? tag.attrs?.property ?? tag.attrs?.charset ?? tag.attrs?.['http-equiv'];
    return key ? `meta:${key}` : null;
  }

  if (tag.tag === 'link') {
    const key = `${tag.attrs?.rel ?? ''}:${tag.attrs?.href ?? ''}`;
    return key === ':' ? null : `link:${key}`;
  }

  if (tag.tag === 'script') {
    const key = tag.attrs?.src ?? tag.attrs?.id;
    return key ? `script:${key}` : null;
  }

  if (tag.tag === 'style') {
    const key = tag.attrs?.id;
    return key ? `style:${key}` : null;
  }

  return null;
}

function dedupeHeadTags(tags: HeadTag[]): HeadTag[] {
  const seen = new Set<string>();
  const deduped: HeadTag[] = [];

  for (const tag of tags) {
    const key = headTagDedupeKey(tag);
    if (key && seen.has(key)) {
      continue;
    }

    if (key) {
      seen.add(key);
    }

    deduped.push(tag);
  }

  return deduped;
}

function dedupeSitemapEntries(entries: SitemapEntry[]): SitemapEntry[] {
  const byUrl = new Map<string, SitemapEntry>();

  for (const entry of entries) {
    if (!entry?.url || byUrl.has(entry.url)) {
      continue;
    }

    byUrl.set(entry.url, entry);
  }

  return [...byUrl.values()];
}
