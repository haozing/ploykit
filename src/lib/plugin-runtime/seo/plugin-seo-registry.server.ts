import 'server-only';

import type { Metadata, MetadataRoute } from 'next';
import { locales } from '@/i18n/config';
import { absoluteUrl, languageAlternates, localizedAbsoluteUrl } from '@/lib/seo/url-policy';
import { siteConfig } from '@/site.config';
import {
  resolveHostPageSurface,
  type HostPageOverrideRegistration,
} from '@/lib/host-pages/surface.server';
import { translatePluginMessage } from '../i18n/plugin-i18n-registry.server';
import { resolvePluginRouteMetadata } from '../metadata';
import type { RuntimePageRoute } from '../contract';

function robotValue(value: boolean | string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'boolean') return value;
  return value === 'index' || value === 'follow';
}

async function hostPageOverrideText(
  override: HostPageOverrideRegistration,
  locale: string
): Promise<{ title: string; description: string }> {
  const [title, description] = await Promise.all([
    translatePluginMessage({
      pluginId: override.pluginId,
      locale,
      key: override.seo.titleKey,
      fallback: override.seo.fallbackTitle,
    }),
    translatePluginMessage({
      pluginId: override.pluginId,
      locale,
      key: override.seo.descriptionKey,
      fallback: override.seo.fallbackDescription,
    }),
  ]);

  return { title, description };
}

export async function createHostPageOverrideMetadata(input: {
  path: string;
  locale: string;
}): Promise<Metadata | null> {
  const surface = await resolveHostPageSurface(input.path);
  const override = surface?.override;
  if (!override) {
    return null;
  }

  if (override.metadata) {
    const route: RuntimePageRoute = {
      kind: 'page',
      path: override.page,
      component: override.component,
      loader: override.loader,
      metadata: override.metadata,
      auth: 'public',
      layout: 'site',
      area: 'public',
      permissions: [],
      publicAliases: [],
    };
    const resolved = await resolvePluginRouteMetadata({
      pluginId: override.pluginId,
      contract: override.contract,
      route,
      localPath: override.page,
      requestPath: override.page,
      locale: input.locale,
      pathname: `/${input.locale}${override.page === '/' ? '' : override.page}`,
      requestHeaders: new Headers(),
    });
    if (Object.keys(resolved.metadata).length > 0) {
      return resolved.metadata;
    }
  }

  const { title, description } = await hostPageOverrideText(override, input.locale);
  const canonicalUrl = localizedAbsoluteUrl(input.locale, override.seo.canonical);
  const ogImageUrl = absoluteUrl(
    override.seo.openGraph?.image ?? siteConfig.assets.brand.openGraph
  );

  return {
    title,
    description,
    alternates: {
      canonical: canonicalUrl,
      languages: languageAlternates(override.seo.canonical),
    },
    robots: {
      index: robotValue(override.seo.robots?.index),
      follow: robotValue(override.seo.robots?.follow),
    },
    openGraph: {
      title,
      description,
      type: override.seo.openGraph?.type === 'article' ? 'article' : 'website',
      url: canonicalUrl,
      siteName: siteConfig.name,
      images: [{ url: ogImageUrl, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
  };
}

export async function listHostPageOverrideSitemapEntries(): Promise<MetadataRoute.Sitemap> {
  const entries = await Promise.all(
    locales.flatMap((locale) =>
      ['/', '/about', '/contact', '/pricing', '/privacy', '/terms', '/success'].map(
        async (path) => {
          const surface = await resolveHostPageSurface(path);
          const override = surface?.override;
          if (!override || override.seo.sitemap?.include === false) {
            return null;
          }

          if (override.seo.robots?.index === false || override.seo.robots?.index === 'noindex') {
            return null;
          }

          return {
            url: localizedAbsoluteUrl(locale, override.seo.canonical),
            lastModified: override.seo.sitemap?.lastModified,
            changeFrequency: override.seo.sitemap?.changeFrequency,
            priority: override.seo.sitemap?.priority,
            alternates: {
              languages: languageAlternates(override.seo.canonical),
            },
          } satisfies MetadataRoute.Sitemap[number];
        }
      )
    )
  );

  return entries.flatMap((entry) => (entry ? [entry] : []));
}
