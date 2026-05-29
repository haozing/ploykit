import fs from 'node:fs';
import path from 'node:path';
import type { Metadata, MetadataRoute } from 'next';
import sitemap from '../apps/host-next/app/sitemap';
import { SUPPORTED_LANGUAGES, localizedPath, stripLanguagePrefix, type SupportedLanguage } from '../apps/host-next/lib/i18n';
import { getModuleHost } from '../apps/host-next/lib/module-host';
import { createHostRequest, hostBaseUrl } from '../apps/host-next/lib/paths';
import { createBrandAssetManifest } from '../apps/host-next/lib/presentation/brand-assets';
import { resolvePagePresentation } from '../apps/host-next/lib/presentation/page-presentation';
import { createRoutePresentationManifest } from '../apps/host-next/lib/presentation/route-presentation-manifest';
import {
  createProductSeoMetadata,
  createProductStructuredData,
  getProductBrandPresentation,
  getProductWebManifest,
} from '../apps/host-next/lib/presentation/seo-presentation';
import productPresentation from '../product.presentation';

type DiagnosticSeverity = 'error' | 'warning';

interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  path: string;
  fix?: string;
}

interface SitemapLanguageAlternates {
  languages?: Record<string, string>;
}

interface RouteSeoSnapshot {
  pageId: string;
  path: string;
  area: string;
  lang: SupportedLanguage;
  canonical: string | null;
  title: string | null;
  description: string | null;
  robotsNoIndex: boolean;
  cacheMode: string | null;
  sitemapUrl: string | null;
  diagnostics: readonly string[];
}

const required = process.argv.includes('--required');
const projectRoot = process.cwd();
const diagnostics: Diagnostic[] = [];
const baseUrl = hostBaseUrl();
const supportedLanguages = [...SUPPORTED_LANGUAGES];

function addDiagnostic(
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  diagnosticPath: string,
  fix?: string
): void {
  diagnostics.push({ severity, code, message, path: diagnosticPath, fix });
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function textFromTitle(value: Metadata['title']): string | null {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  if (value && typeof value === 'object' && 'default' in value) {
    const title = (value as { default?: unknown }).default;
    return hasText(title) ? title : null;
  }
  return null;
}

function textFromDescription(value: Metadata['description']): string | null {
  return hasText(value) ? value : null;
}

function alternatesFromMetadata(metadata: Metadata): {
  canonical?: string;
  languages?: Record<string, string>;
} {
  return (metadata.alternates ?? {}) as {
    canonical?: string;
    languages?: Record<string, string>;
  };
}

function sitemapAlternates(entry: MetadataRoute.Sitemap[number]): SitemapLanguageAlternates {
  return (entry.alternates ?? {}) as SitemapLanguageAlternates;
}

function absoluteUrl(pathname: string): string {
  return new URL(pathname, baseUrl).toString();
}

function pathFromUrl(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function languageFromUrl(url: string): SupportedLanguage | null {
  const pathname = pathFromUrl(url);
  const segment = pathname?.split('/').filter(Boolean)[0];
  return segment && SUPPORTED_LANGUAGES.includes(segment as SupportedLanguage)
    ? (segment as SupportedLanguage)
    : null;
}

function robotsNoIndex(robots: Metadata['robots']): boolean {
  if (!robots) {
    return false;
  }
  if (typeof robots === 'string') {
    return robots.toLowerCase().includes('noindex');
  }
  if (typeof robots === 'object' && 'index' in robots) {
    return (robots as { index?: unknown }).index === false;
  }
  return false;
}

function isPublicCache(cache: unknown): boolean {
  return Boolean(cache && typeof cache === 'object' && (cache as { mode?: unknown }).mode === 'public');
}

function cacheMode(cache: unknown): string | null {
  return cache && typeof cache === 'object' && typeof (cache as { mode?: unknown }).mode === 'string'
    ? ((cache as { mode: string }).mode)
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function writeManifest(manifest: unknown): string[] {
  const outputPaths = [
    path.join(projectRoot, '.runtime', 'seo-manifest.json'),
    path.join(projectRoot, '.ploykit', 'generated', 'seo.manifest.json'),
  ];
  for (const outputPath of outputPaths) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return outputPaths;
}

for (const lang of supportedLanguages) {
  const brand = getProductBrandPresentation(lang);
  if (!hasText(brand.productName)) {
    addDiagnostic('error', 'SEO_BRAND_NAME_MISSING', 'Product brand name is missing.', `brand.${lang}.productName`);
  }
  if (!hasText(brand.favicon)) {
    addDiagnostic('error', 'SEO_FAVICON_MISSING', 'Product favicon is missing.', `brand.${lang}.favicon`);
  }
  if (!hasText(brand.openGraphImage)) {
    addDiagnostic(
      'error',
      'SEO_OPEN_GRAPH_IMAGE_MISSING',
      'Product OpenGraph image is missing.',
      `brand.${lang}.openGraphImage`
    );
  }

  const metadata = createProductSeoMetadata({ lang, path: '/', pageKey: 'home' });
  const alternates = alternatesFromMetadata(metadata);
  if (!textFromTitle(metadata.title)) {
    addDiagnostic('error', 'SEO_TITLE_MISSING', 'Localized SEO title is missing.', `seo.pages.home.${lang}.title`);
  }
  if (!textFromDescription(metadata.description)) {
    addDiagnostic(
      'error',
      'SEO_DESCRIPTION_MISSING',
      'Localized SEO description is missing.',
      `seo.pages.home.${lang}.description`
    );
  }
  if (alternates.canonical !== absoluteUrl(localizedPath(lang))) {
    addDiagnostic(
      'error',
      'SEO_CANONICAL_INVALID',
      `Home canonical for "${lang}" must point at the localized URL.`,
      `metadata.${lang}.alternates.canonical`
    );
  }
  for (const alternateLang of supportedLanguages) {
    const expected = absoluteUrl(localizedPath(alternateLang));
    if (alternates.languages?.[alternateLang] !== expected) {
      addDiagnostic(
        'error',
        'SEO_ALTERNATE_LANGUAGE_MISSING',
        `Home metadata for "${lang}" is missing "${alternateLang}" alternate.`,
        `metadata.${lang}.alternates.languages.${alternateLang}`
      );
    }
  }

  const structuredData = createProductStructuredData(lang);
  if (structuredData['@type'] !== 'WebSite' || !hasText(structuredData.publisher.name)) {
    addDiagnostic(
      'error',
      'SEO_STRUCTURED_DATA_INVALID',
      'Product structured data must expose WebSite and Organization publisher identity.',
      `structuredData.${lang}`
    );
  }
}

const manifest = getProductWebManifest();
if (!manifest.icons?.length) {
  addDiagnostic('error', 'SEO_MANIFEST_ICON_MISSING', 'Web manifest must expose at least one icon.', 'manifest.icons');
}

const entries = await sitemap();
const brandAssets = createBrandAssetManifest();
for (const diagnostic of brandAssets.diagnostics) {
  addDiagnostic(
    diagnostic.severity,
    `SEO_${diagnostic.code}`,
    diagnostic.message,
    diagnostic.path
  );
}
const sitemapUrls = entries.map((entry) => entry.url);
const sitemapUrlSet = new Set<string>();
const duplicateSitemapUrls = new Set<string>();
for (const url of sitemapUrls) {
  if (sitemapUrlSet.has(url)) {
    duplicateSitemapUrls.add(url);
  }
  sitemapUrlSet.add(url);
}
for (const url of duplicateSitemapUrls) {
  addDiagnostic(
    'error',
    'SEO_SITEMAP_URL_DUPLICATE',
    `Sitemap URL appears more than once: ${url}`,
    'sitemap.urls'
  );
}

for (const entry of entries) {
  const lang = languageFromUrl(entry.url);
  if (!lang) {
    addDiagnostic(
      'error',
      'SEO_SITEMAP_URL_NOT_LOCALIZED',
      `Sitemap URL must include a supported language prefix: ${entry.url}`,
      'sitemap.urls',
      'Use createLocalizedSitemapEntry() for host and module pages.'
    );
    continue;
  }

  const pathname = pathFromUrl(entry.url);
  const unlocalizedPath = pathname ? stripLanguagePrefix(pathname) : '/';
  const alternates = sitemapAlternates(entry);
  for (const alternateLang of supportedLanguages) {
    const expected = absoluteUrl(localizedPath(alternateLang, unlocalizedPath));
    if (alternates.languages?.[alternateLang] !== expected) {
      addDiagnostic(
        'error',
        'SEO_SITEMAP_ALTERNATES_MISSING',
        `Sitemap entry is missing "${alternateLang}" alternate: ${entry.url}`,
        `sitemap.alternates.${entry.url}`,
        'Use createLocalizedSitemapEntry() for host and module pages.'
      );
    }
  }
}

const host = await getModuleHost();
const routeManifest = createRoutePresentationManifest();
const routeSnapshots: RouteSeoSnapshot[] = [];
const canonicalOwners = new Map<string, string>();

for (const route of routeManifest.routes) {
  const indexable = route.area === 'site';
  for (const lang of supportedLanguages) {
    const pathname = localizedPath(lang, route.path);
    const sitemapUrl = absoluteUrl(pathname);
    try {
      const presentation = await resolvePagePresentation({
        pageId: route.pageId,
        pathname,
        lang,
        workspaceId: route.area === 'dashboard' ? 'demo-workspace' : null,
      });
      const alternates = alternatesFromMetadata(presentation.seo);
      const title = textFromTitle(presentation.seo.title);
      const description = textFromDescription(presentation.seo.description);
      const noIndex = robotsNoIndex(presentation.seo.robots);
      const diagnosticCodes = presentation.diagnostics.map((item) => item.code);

      routeSnapshots.push({
        pageId: route.pageId,
        path: route.path,
        area: route.area,
        lang,
        canonical: alternates.canonical ?? null,
        title,
        description,
        robotsNoIndex: noIndex,
        cacheMode: cacheMode(presentation.cache),
        sitemapUrl: sitemapUrlSet.has(sitemapUrl) ? sitemapUrl : null,
        diagnostics: diagnosticCodes,
      });

      for (const diagnostic of presentation.diagnostics) {
        if (diagnostic.severity === 'error') {
          addDiagnostic(
            'error',
            `SEO_${diagnostic.code}`,
            diagnostic.message,
            `routes.${route.pageId}.diagnostics.${diagnostic.code}`
          );
        }
      }

      if (!title) {
        addDiagnostic(
          'error',
          'SEO_ROUTE_TITLE_MISSING',
          `Route "${route.pageId}" is missing a localized title for "${lang}".`,
          `routes.${route.pageId}.${lang}.title`
        );
      }
      if (!description) {
        addDiagnostic(
          'error',
          'SEO_ROUTE_DESCRIPTION_MISSING',
          `Route "${route.pageId}" is missing a localized description for "${lang}".`,
          `routes.${route.pageId}.${lang}.description`
        );
      }

      if (indexable) {
        if (!sitemapUrlSet.has(sitemapUrl)) {
          addDiagnostic(
            'error',
            'SEO_SITEMAP_PUBLIC_ROUTE_MISSING',
            `Public site route "${route.pageId}" is missing from sitemap for "${lang}".`,
            `sitemap.routes.${route.pageId}.${lang}`
          );
        }
        if (noIndex) {
          addDiagnostic(
            'error',
            'SEO_PUBLIC_ROUTE_NOINDEX',
            `Public site route "${route.pageId}" must not be noindex by default.`,
            `routes.${route.pageId}.${lang}.robots`
          );
        }
        if (alternates.canonical !== sitemapUrl) {
          addDiagnostic(
            'error',
            'SEO_ROUTE_CANONICAL_MISMATCH',
            `Public site route "${route.pageId}" canonical must match its localized sitemap URL.`,
            `routes.${route.pageId}.${lang}.canonical`
          );
        }
        for (const alternateLang of supportedLanguages) {
          const expected = absoluteUrl(localizedPath(alternateLang, route.path));
          if (alternates.languages?.[alternateLang] !== expected) {
            addDiagnostic(
              'error',
              'SEO_ROUTE_HREFLANG_MISSING',
              `Public site route "${route.pageId}" is missing "${alternateLang}" hreflang.`,
              `routes.${route.pageId}.${lang}.alternates.${alternateLang}`
            );
          }
        }
        const canonical = alternates.canonical;
        if (canonical) {
          const owner = canonicalOwners.get(canonical);
          if (owner && owner !== route.pageId) {
            addDiagnostic(
              'error',
              'SEO_ROUTE_CANONICAL_DUPLICATE',
              `Canonical "${canonical}" is shared by "${owner}" and "${route.pageId}".`,
              `routes.${route.pageId}.${lang}.canonical`
            );
          }
          canonicalOwners.set(canonical, route.pageId);
        }
      } else {
        if (sitemapUrlSet.has(sitemapUrl)) {
          addDiagnostic(
            'error',
            'SEO_SITEMAP_PRIVATE_ROUTE_PRESENT',
            `Non-site route "${route.pageId}" must not be present in sitemap.`,
            `sitemap.routes.${route.pageId}.${lang}`
          );
        }
        if (!noIndex) {
          addDiagnostic(
            'error',
            'SEO_PRIVATE_ROUTE_INDEXABLE',
            `Non-site route "${route.pageId}" must be noindex.`,
            `routes.${route.pageId}.${lang}.robots`
          );
        }
        if (isPublicCache(presentation.cache)) {
          addDiagnostic(
            'error',
            'SEO_PRIVATE_ROUTE_PUBLIC_CACHE',
            `Non-site route "${route.pageId}" must not use public cache.`,
            `routes.${route.pageId}.${lang}.cache`
          );
        }
      }
    } catch (error) {
      addDiagnostic(
        'error',
        'SEO_ROUTE_PRESENTATION_FAILED',
        `Route "${route.pageId}" failed to resolve SEO presentation: ${errorMessage(error)}`,
        `routes.${route.pageId}.${lang}`
      );
    }
  }
}

const moduleRouteSnapshots = [];
for (const route of host.runtime.routes.filter((entry) => entry.kind === 'site')) {
  for (const lang of supportedLanguages) {
    const localizedUrl = absoluteUrl(localizedPath(lang, route.path));
    if (!sitemapUrlSet.has(localizedUrl)) {
      addDiagnostic(
        'error',
        'SEO_MODULE_SITEMAP_ROUTE_MISSING',
        `Module site route "${route.moduleId}:${route.path}" is missing from sitemap for "${lang}".`,
        `sitemap.modules.${route.moduleId}.${route.path}.${lang}`
      );
    }

    const result = await host.resolvePageRoute({
      kind: 'site',
      pathname: stripLanguagePrefix(localizedPath(lang, route.path)),
      request: createHostRequest(localizedPath(lang, route.path)),
    });
    if (!result.ok) {
      addDiagnostic(
        'error',
        'SEO_MODULE_ROUTE_UNRESOLVABLE',
        `Module site route "${route.moduleId}:${route.path}" does not resolve for "${lang}".`,
        `modules.${route.moduleId}.routes.${route.path}.${lang}`
      );
      continue;
    }
    moduleRouteSnapshots.push({
      moduleId: route.moduleId,
      path: route.path,
      lang,
      source: route.source,
      canonicalPath: route.canonicalPath,
      title: hasText(result.page.metadata?.title) ? result.page.metadata.title : null,
      description: hasText(result.page.metadata?.description) ? result.page.metadata.description : null,
      sitemapUrl: localizedUrl,
    });
  }
}

const seoManifest = {
  kind: 'ploykit.seo.manifest',
  checkedAt: new Date().toISOString(),
  product: {
    id: productPresentation.definition.id,
    name: productPresentation.definition.name,
    defaultLanguage: productPresentation.definition.defaultLanguage,
    supportedLanguages: productPresentation.definition.supportedLanguages,
  },
  brand: Object.fromEntries(
    supportedLanguages.map((lang) => [lang, getProductBrandPresentation(lang)])
  ),
  brandAssets,
  routePresentation: routeSnapshots,
  moduleRoutes: moduleRouteSnapshots,
  sitemap: {
    count: entries.length,
    urls: sitemapUrls,
    localizedCount: entries.filter((entry) => languageFromUrl(entry.url)).length,
  },
  diagnostics,
};

const outputPaths = writeManifest(seoManifest);
const ok = diagnostics.every((item) => item.severity !== 'error');
const result = {
  ok: required ? ok : true,
  required,
  outputPath: outputPaths[0],
  outputPaths,
  diagnostics,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exitCode = result.ok ? 0 : 1;
