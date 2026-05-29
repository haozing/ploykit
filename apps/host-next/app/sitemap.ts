import type { MetadataRoute } from 'next';
import { createModuleSitemapEntries } from '@/lib/module-runtime/ui/sitemap-runtime';
import { SUPPORTED_LANGUAGES } from '@host/lib/i18n';
import { getModuleHost } from '@host/lib/module-host';
import { createLocalizedSitemapEntry } from '@host/lib/presentation/seo-presentation';

function uniqueSitemapEntries(entries: MetadataRoute.Sitemap): MetadataRoute.Sitemap {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) {
      return false;
    }
    seen.add(entry.url);
    return true;
  });
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = await getModuleHost();
  const staticPages = [
    '/',
    '/about',
    '/pricing',
    '/docs',
    '/contact',
    '/privacy',
    '/terms',
    '/success',
  ];
  const staticEntries = SUPPORTED_LANGUAGES.flatMap((lang) =>
    staticPages.map((path) => createLocalizedSitemapEntry(path, lang, new Date()))
  );
  const moduleEntries = createModuleSitemapEntries(host.runtime);
  const moduleSitemapEntries = SUPPORTED_LANGUAGES.flatMap((lang) =>
    moduleEntries.map((entry) => createLocalizedSitemapEntry(entry.path, lang, new Date()))
  );

  return uniqueSitemapEntries([
    ...staticEntries,
    ...moduleSitemapEntries,
  ]);
}
