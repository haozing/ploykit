import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ModuleValue } from '@host/components/ModuleValue';
import { ErrorPanel } from '@host/components/layout/ErrorPanel';
import { SiteFrame } from '@host/components/site/SiteFrame';
import { SitePageShell } from '@host/components/site/SitePageShell';
import {
  DEFAULT_LANGUAGE,
  HOST_LANGUAGE_HEADER,
  isSupportedLanguage,
  stripLanguagePrefix,
  type SupportedLanguage,
} from './i18n';
import { getModuleHost } from './module-host';
import { createHostRequest, hostBaseUrl } from './paths';
import { createLocalizedAlternates } from './presentation/seo-presentation';
import { renderPageComponent } from './rendering';
import { resolvePublicNavigation } from './site-navigation';

function languageFromPathname(pathname: string): SupportedLanguage {
  const segment = pathname.split('/').filter(Boolean)[0];
  return segment && isSupportedLanguage(segment) ? segment : DEFAULT_LANGUAGE;
}

function readMetadataString(metadata: unknown, key: 'title' | 'description'): string | undefined {
  if (!metadata || typeof metadata !== 'object' || !(key in metadata)) {
    return undefined;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readOpenGraphImage(metadata: unknown): string | undefined {
  if (!metadata || typeof metadata !== 'object' || !('openGraph' in metadata)) {
    return undefined;
  }
  const openGraph = (metadata as { openGraph?: unknown }).openGraph;
  if (!openGraph || typeof openGraph !== 'object' || !('image' in openGraph)) {
    return undefined;
  }
  const image = (openGraph as { image?: unknown }).image;
  return typeof image === 'string' && image.trim().length > 0 ? image : undefined;
}

function moduleRobots(metadata: unknown): Metadata['robots'] {
  if (!metadata || typeof metadata !== 'object' || !('robots' in metadata)) {
    return undefined;
  }
  const value = (metadata as { robots?: unknown }).robots;
  if (typeof value !== 'string') {
    return undefined;
  }
  const tokens = new Set(
    value
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!tokens.has('noindex') && !tokens.has('nofollow')) {
    return undefined;
  }
  return {
    index: !tokens.has('noindex'),
    follow: !tokens.has('nofollow'),
  };
}

export async function siteModuleMetadata(pathname: string): Promise<Metadata> {
  const lang = languageFromPathname(pathname);
  const modulePathname = stripLanguagePrefix(pathname);
  const host = await getModuleHost();
  const result = await host.resolvePageRoute({
    kind: 'site',
    pathname: modulePathname,
    request: createHostRequest(pathname, { headers: { [HOST_LANGUAGE_HEADER]: lang } }),
  });

  if (!result.ok) {
    return {
      title: 'Not Found | PloyKit',
    };
  }

  const title = readMetadataString(result.page.metadata, 'title') ?? result.page.contract.name;
  const description = readMetadataString(result.page.metadata, 'description');
  const canonicalPath =
    result.page.routeSource === 'publicAlias' ? result.page.matchedPath : result.page.canonicalPath;
  const alternates = createLocalizedAlternates(canonicalPath, lang);
  const openGraphImage = readOpenGraphImage(result.page.metadata);

  return {
    title,
    description,
    robots: moduleRobots(result.page.metadata),
    alternates,
    openGraph: {
      type: 'website',
      url: alternates.canonical,
      title,
      description,
      images: openGraphImage ? [{ url: new URL(openGraphImage, hostBaseUrl()).toString() }] : undefined,
    },
  };
}

export async function renderSiteModulePage(pathname: string) {
  const lang = languageFromPathname(pathname);
  const modulePathname = stripLanguagePrefix(pathname);
  const host = await getModuleHost();
  const result = await host.resolvePageRoute({
    kind: 'site',
    pathname: modulePathname,
    request: createHostRequest(pathname, { headers: { [HOST_LANGUAGE_HEADER]: lang } }),
  });

  if (!result.ok && result.status === 404) {
    notFound();
  }

  const { headerItems, footerItems } = await resolvePublicNavigation(lang);

  if (!result.ok) {
    return (
      <SiteFrame lang={lang} navItems={headerItems} footerItems={footerItems}>
        <SitePageShell title="Site Route Error">
          <ErrorPanel status={result.status} code={result.code} message={result.message} />
        </SitePageShell>
      </SiteFrame>
    );
  }

  const output = await renderPageComponent(result.page.component, {
    params: result.page.params,
    loaderData: result.page.loaderData,
    metadata: result.page.metadata,
    language: lang,
  });
  const title = readMetadataString(result.page.metadata, 'title') ?? result.page.contract.name;
  const description =
    readMetadataString(result.page.metadata, 'description') ?? result.page.contract.description;

  return (
    <SiteFrame lang={lang} navItems={headerItems} footerItems={footerItems}>
      <SitePageShell title={title} description={description}>
        <section className="rounded-md border border-border bg-card p-5 shadow-sm">
          <ModuleValue value={output} />
        </section>
      </SitePageShell>
    </SiteFrame>
  );
}
