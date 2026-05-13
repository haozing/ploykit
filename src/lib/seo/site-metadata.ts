import type { Metadata } from 'next';
import { locales } from '@/i18n/config';
import { siteConfig } from '@/site.config';
import { absoluteUrl, languageAlternates, localizedAbsoluteUrl } from './url-policy';

function openGraphLocale(locale: string): string {
  return locale === 'zh' ? 'zh_CN' : 'en_US';
}

export function createSitePageMetadata(input: {
  locale: string;
  path: string;
  title: string;
  description: string;
}): Metadata {
  const canonicalUrl = localizedAbsoluteUrl(input.locale, input.path);
  const ogImageUrl = absoluteUrl('/opengraph-image');

  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical: canonicalUrl,
      languages: languageAlternates(input.path),
    },
    openGraph: {
      title: input.title,
      description: input.description,
      type: 'website',
      url: canonicalUrl,
      siteName: siteConfig.name,
      locale: openGraphLocale(input.locale),
      alternateLocale: locales
        .filter((locale) => locale !== input.locale)
        .map((locale) => openGraphLocale(locale)),
      images: [
        {
          url: ogImageUrl,
          width: 1200,
          height: 630,
          alt: `${siteConfig.name} preview`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: input.title,
      description: input.description,
      images: [ogImageUrl],
    },
  };
}
