import type { MetadataRoute } from 'next';

export function renderSitemapXml(items: MetadataRoute.Sitemap): string {
  const body = items
    .map((item) => {
      const languages = Object.entries(
        (item.alternates?.languages ?? {}) as Record<string, string | undefined>
      );
      const alternates = languages
        .flatMap(([language, href]) =>
          href
            ? [
                `    <xhtml:link rel="alternate" hreflang="${escapeXml(
                  language
                )}" href="${escapeXml(href)}" />`,
              ]
            : []
        )
        .join('\n');

      return [
        '  <url>',
        `    <loc>${escapeXml(item.url)}</loc>`,
        item.lastModified ? `    <lastmod>${formatLastModified(item.lastModified)}</lastmod>` : '',
        item.changeFrequency ? `    <changefreq>${item.changeFrequency}</changefreq>` : '',
        item.priority !== undefined
          ? `    <priority>${formatPriority(item.priority)}</priority>`
          : '',
        alternates,
        '  </url>',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    body,
    '</urlset>',
    '',
  ].join('\n');
}

function formatLastModified(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString();
}

function formatPriority(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
