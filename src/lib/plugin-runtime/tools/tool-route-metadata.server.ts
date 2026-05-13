import type { Metadata } from 'next';
import type { MetadataRoute } from 'next';
import type {
  PluginOpenGraphMetadata,
  PluginRobotsFollow,
  PluginRobotsIndex,
  PluginToolRouteRuntimeMetadata,
  PluginToolSeoLocalizedMetadata,
  PluginToolSeoMetadata,
} from '@ploykit/plugin-sdk';
import { normalizeRuntimePath } from '../contract';
import type { SitemapEntry } from '@/lib/bus/hook-helpers.server';
import {
  absoluteUrl,
  languageAlternates,
  normalizeCanonicalUrl,
  normalizeIndexableAppPath,
  stripLocalePrefix,
} from '@/lib/seo/url-policy';

function robotIndex(value: PluginRobotsIndex | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'index';
}

function robotFollow(value: PluginRobotsFollow | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'follow';
}

function chooseLocalizedSeo(
  seo: PluginToolSeoMetadata,
  locale?: string
): PluginToolSeoMetadata & PluginToolSeoLocalizedMetadata {
  const localized = locale ? seo.locales?.[locale] : undefined;

  return {
    ...seo,
    ...localized,
    openGraph: {
      ...(seo.openGraph ?? {}),
      ...(localized?.openGraph ?? {}),
    } satisfies PluginOpenGraphMetadata,
  };
}

function openGraphImages(openGraph?: PluginOpenGraphMetadata) {
  if (!openGraph?.image) {
    return undefined;
  }

  return [{ url: absoluteUrl(openGraph.image) }];
}

export function createPluginToolMetadata(
  tool: PluginToolRouteRuntimeMetadata,
  input: {
    locale?: string;
    pathname?: string;
  } = {}
): Metadata {
  const seo = chooseLocalizedSeo(tool.seo, input.locale);
  const canonical = seo.canonical ?? input.pathname ?? tool.path;
  const canonicalUrl =
    normalizeCanonicalUrl({
      path: canonical,
      locale: input.locale,
      fallbackPath: input.pathname ?? tool.path,
    }) ?? absoluteUrl(input.pathname ?? tool.path);

  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical: canonicalUrl,
    },
    robots: {
      index: robotIndex(seo.robots?.index),
      follow: robotFollow(seo.robots?.follow),
    },
    openGraph: seo.openGraph
      ? {
          title: seo.openGraph.title ?? seo.title,
          description: seo.openGraph.description ?? seo.description,
          type: seo.openGraph.type === 'article' ? 'article' : 'website',
          url: canonicalUrl,
          images: openGraphImages(seo.openGraph),
        }
      : undefined,
  };
}

export function createPluginToolStructuredDataScripts(
  tool: PluginToolRouteRuntimeMetadata,
  input: {
    locale?: string;
  } = {}
): Array<{ id: string; json: string }> {
  const seo = chooseLocalizedSeo(tool.seo, input.locale);
  const values = Array.isArray(seo.structuredData)
    ? seo.structuredData
    : seo.structuredData
      ? [seo.structuredData]
      : [];

  return values.map((value, index) => ({
    id: `plugin-tool-structured-data-${index}`,
    json: JSON.stringify(value),
  }));
}

export function createPluginToolCacheControl(
  tool: PluginToolRouteRuntimeMetadata
): string | undefined {
  const cache = tool.cache;
  if (!cache || cache.strategy === 'none') {
    return undefined;
  }

  const visibility = cache.strategy === 'public' ? 'public' : 'private';
  const directives = [visibility];
  if (cache.maxAgeSeconds !== undefined) {
    directives.push(`max-age=${cache.maxAgeSeconds}`);
  }
  if (cache.staleWhileRevalidateSeconds !== undefined && cache.strategy === 'public') {
    directives.push(`stale-while-revalidate=${cache.staleWhileRevalidateSeconds}`);
  }

  return directives.join(', ');
}

export function createPluginToolSitemapEntry(
  tool: PluginToolRouteRuntimeMetadata,
  input: { locale?: string } = {}
): (SitemapEntry & Pick<MetadataRoute.Sitemap[number], 'alternates'>) | null {
  if (tool.sitemap?.include === false) {
    return null;
  }

  if (robotIndex(tool.seo.robots?.index) === false) {
    return null;
  }

  const seo = chooseLocalizedSeo(tool.seo, input.locale);
  const canonical = seo.canonical ?? normalizeRuntimePath(tool.path);
  const path = normalizeIndexableAppPath({
    path: canonical,
    locale: input.locale,
    fallbackPath: normalizeRuntimePath(tool.path),
  });

  if (!path) {
    return null;
  }

  return {
    url: absoluteUrl(path),
    lastModified: tool.sitemap?.lastModified,
    changeFrequency: tool.sitemap?.changeFrequency,
    priority: tool.sitemap?.priority,
    alternates: input.locale
      ? {
          languages: languageAlternates(stripLocalePrefix(path)),
        }
      : undefined,
  };
}
