import type { Metadata, MetadataRoute, Viewport } from 'next';
import type { ProductPresentationLocalizedAsset } from '@ploykit/module-sdk/presentation';
import productPresentation from '../../../../product.presentation';
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, isSupportedLanguage, localizedPath, type SupportedLanguage } from '../i18n';
import { translateHostMessage } from '../host-i18n';
import { hostBaseUrl } from '../paths';

export interface ProductBrandPresentation {
  productName: string;
  logoLight: string | null;
  logoDark: string | null;
  logoMark: string | null;
  favicon: string | null;
  manifestIcon: string | null;
  openGraphImage: string | null;
  themeColor: string | null;
}

export interface ProductSeoMetadataInput {
  lang: SupportedLanguage;
  path?: string;
  pageKey?: string;
  title?: string;
  description?: string;
  noIndex?: boolean;
}

export interface ProductStructuredData {
  '@context': 'https://schema.org';
  '@type': 'WebSite';
  name: string;
  url: string;
  inLanguage: string;
  publisher: {
    '@type': 'Organization';
    name: string;
    url: string;
    logo?: string;
  };
  potentialAction?: {
    '@type': 'SearchAction';
    target: string;
    'query-input': string;
  };
}

function supportedSeoLanguages(): SupportedLanguage[] {
  return productPresentation.definition.supportedLanguages
    .map(String)
    .filter(isSupportedLanguage);
}

function normalizePath(pathname = '/'): string {
  const withSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return withSlash === '/' ? '/' : withSlash.replace(/\/+$/, '');
}

function stripLanguagePrefix(pathname: string): string {
  const segments = normalizePath(pathname).split('/').filter(Boolean);
  if (segments[0] && isSupportedLanguage(segments[0])) {
    const rest = segments.slice(1).join('/');
    return rest ? `/${rest}` : '/';
  }
  return normalizePath(pathname);
}

function absoluteUrl(pathOrUrl: string, baseUrl = hostBaseUrl()): string {
  return new URL(pathOrUrl, baseUrl).toString();
}

function resolveLocalizedAsset(
  asset: string | ProductPresentationLocalizedAsset | undefined,
  lang: SupportedLanguage
): string | null {
  if (!asset) {
    return null;
  }
  if (typeof asset === 'string') {
    return absoluteUrl(asset);
  }
  return absoluteUrl(asset[lang] ?? asset.default);
}

function metadataLocale(lang: SupportedLanguage): string {
  return lang === 'zh' ? 'zh_CN' : 'en_US';
}

export function getProductBrandPresentation(lang: SupportedLanguage): ProductBrandPresentation {
  const definition = productPresentation.definition;
  const brand = definition.brand;
  const productName = brand?.productNameKey
    ? translateHostMessage(lang, brand.productNameKey, { fallback: definition.name })
    : definition.name;

  return {
    productName,
    logoLight: brand?.logo?.light ?? null,
    logoDark: brand?.logo?.dark ?? null,
    logoMark: brand?.logo?.mark ?? null,
    favicon: brand?.favicon ?? null,
    manifestIcon: brand?.manifestIcon ?? null,
    openGraphImage: resolveLocalizedAsset(brand?.openGraphImage, lang),
    themeColor: brand?.themeColor ?? null,
  };
}

export function createLocalizedAlternates(pathname: string, lang: SupportedLanguage) {
  const unlocalizedPath = stripLanguagePrefix(pathname);
  const languages = Object.fromEntries(
    supportedSeoLanguages().map((language) => [
      language,
      absoluteUrl(localizedPath(language, unlocalizedPath)),
    ])
  );

  return {
    canonical: absoluteUrl(localizedPath(lang, unlocalizedPath)),
    languages,
  };
}

export function createProductSeoMetadata(input: ProductSeoMetadataInput): Metadata {
  const path = normalizePath(input.path ?? '/');
  const brand = getProductBrandPresentation(input.lang);
  const keyPrefix = input.pageKey ? `seo.pages.${input.pageKey}` : 'seo.default';
  const title =
    input.title ??
    translateHostMessage(input.lang, `${keyPrefix}.title`, { fallback: brand.productName });
  const description =
    input.description ??
    translateHostMessage(input.lang, `${keyPrefix}.description`, {
      fallback: translateHostMessage(input.lang, 'seo.default.description'),
    });
  const alternates = createLocalizedAlternates(path, input.lang);
  const alternateLocale = supportedSeoLanguages()
    .filter((language) => language !== input.lang)
    .map(metadataLocale);

  return {
    metadataBase: new URL(hostBaseUrl()),
    applicationName: brand.productName,
    title,
    description,
    alternates,
    icons: brand.favicon ? { icon: brand.favicon } : undefined,
    robots: input.noIndex ? { index: false, follow: false } : undefined,
    openGraph: {
      type: 'website',
      url: alternates.canonical,
      title,
      description,
      siteName: brand.productName,
      locale: metadataLocale(input.lang),
      alternateLocale,
      images: brand.openGraphImage ? [{ url: brand.openGraphImage }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: brand.openGraphImage ? [brand.openGraphImage] : undefined,
    },
  };
}

export function createProductViewport(lang: SupportedLanguage = DEFAULT_LANGUAGE): Viewport {
  const brand = getProductBrandPresentation(lang);
  return {
    themeColor: brand.themeColor ?? undefined,
  };
}

export function createProductStructuredData(lang: SupportedLanguage): ProductStructuredData {
  const brand = getProductBrandPresentation(lang);
  const baseUrl = hostBaseUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: brand.productName,
    url: absoluteUrl(localizedPath(lang), baseUrl),
    inLanguage: lang === 'zh' ? 'zh-CN' : 'en-US',
    publisher: {
      '@type': 'Organization',
      name: brand.productName,
      url: absoluteUrl(localizedPath(lang), baseUrl),
      logo: brand.logoMark ? absoluteUrl(brand.logoMark, baseUrl) : undefined,
    },
  };
}

export function createLocalizedSitemapEntry(
  pathname: string,
  lang: SupportedLanguage = DEFAULT_LANGUAGE,
  lastModified = new Date()
): MetadataRoute.Sitemap[number] {
  const path = normalizePath(pathname);
  const alternates = createLocalizedAlternates(path, lang);
  return {
    url: alternates.canonical,
    lastModified,
    alternates: {
      languages: alternates.languages,
    },
  };
}

export function getProductWebManifest(): MetadataRoute.Manifest {
  const brand = getProductBrandPresentation(DEFAULT_LANGUAGE);
  const icon = brand.manifestIcon ?? brand.logoMark ?? brand.favicon ?? '/favicon.ico';
  const themeProfiles = productPresentation.definition.theme?.profiles as
    | Record<string, { tokens?: Record<string, string | number> }>
    | undefined;
  const themeProfileId = productPresentation.definition.theme?.defaultProfileId ?? '';

  return {
    name: brand.productName,
    short_name: brand.productName,
    description: translateHostMessage(DEFAULT_LANGUAGE, 'seo.default.description'),
    start_url: localizedPath(DEFAULT_LANGUAGE),
    display: 'standalone',
    background_color: themeProfiles?.[themeProfileId]?.tokens?.colorBackground?.toString(),
    theme_color: brand.themeColor ?? undefined,
    icons: [
      {
        src: icon,
        sizes: '512x512',
        type: icon.endsWith('.svg') ? 'image/svg+xml' : 'image/png',
      },
    ],
  };
}

export function getDefaultProductSeoMetadata(): Metadata {
  return createProductSeoMetadata({
    lang: DEFAULT_LANGUAGE,
    path: '/',
    pageKey: 'home',
  });
}

export function getDefaultProductViewport(): Viewport {
  return createProductViewport(DEFAULT_LANGUAGE);
}
