import type { Metadata, MetadataRoute } from 'next';
import type { SitemapEntry } from '@/lib/bus/hook-helpers.server';
import {
  createPluginToolMetadata,
  createPluginToolSitemapUrl,
  createPluginToolStructuredDataScripts,
} from '../tools';
import type { PluginPublicRouteAlias, PluginToolSeoMetadata } from '@ploykit/plugin-sdk';
import {
  languageAlternates,
  normalizeIndexableAppPath,
  stripLocalePrefix,
} from '@/lib/seo/url-policy';

function withCanonical(alias: PluginPublicRouteAlias): PluginToolSeoMetadata | null {
  if (!alias.seo) {
    return null;
  }

  return {
    ...alias.seo,
    canonical: alias.seo.canonical ?? alias.path,
  };
}

export function createPluginPublicAliasMetadata(
  alias: PluginPublicRouteAlias,
  input: { locale?: string; pathname: string }
): Metadata {
  const seo = withCanonical(alias);
  return seo ? createPluginToolMetadata({ path: alias.path, seo }, input) : {};
}

export function createPluginPublicAliasStructuredDataScripts(
  alias: PluginPublicRouteAlias,
  input: { locale?: string } = {}
): Array<{ id: string; json: string }> {
  const seo = withCanonical(alias);
  return seo
    ? createPluginToolStructuredDataScripts({ path: alias.path, seo }, input).map((script) => ({
        ...script,
        id: script.id.replace('plugin-tool-', 'plugin-public-alias-'),
      }))
    : [];
}

export function createPluginPublicAliasSitemapEntry(
  alias: PluginPublicRouteAlias,
  input: { locale?: string } = {}
): (SitemapEntry & Pick<MetadataRoute.Sitemap[number], 'alternates'>) | null {
  if (alias.sitemap?.include === false) {
    return null;
  }

  if (!alias.seo?.title && !alias.sitemap) {
    return null;
  }

  if (alias.seo?.robots?.index === false || alias.seo?.robots?.index === 'noindex') {
    return null;
  }

  const localized = input.locale ? alias.seo?.locales?.[input.locale] : undefined;
  const canonical = localized?.canonical ?? alias.seo?.canonical ?? alias.path;
  const path = normalizeIndexableAppPath({
    path: canonical,
    locale: input.locale,
    fallbackPath: alias.path,
  });

  if (!path) {
    return null;
  }

  return {
    url: createPluginToolSitemapUrl(path),
    lastModified: alias.sitemap?.lastModified,
    changeFrequency: alias.sitemap?.changeFrequency,
    priority: alias.sitemap?.priority,
    alternates: input.locale
      ? {
          languages: languageAlternates(stripLocalePrefix(path)),
        }
      : undefined,
  };
}
