import { NextResponse } from 'next/server';
import { getSitemapChunk, listSitemapChunks } from '@/lib/seo/sitemap.server';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

interface SitemapChunkRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: SitemapChunkRouteContext) {
  const { id } = await params;
  const match = id.match(/^(\d+)\.xml$/);
  const numericId = match ? Number(match[1]) : Number.NaN;

  if (!Number.isInteger(numericId) || numericId < 0) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const chunks = await listSitemapChunks();
  if (!chunks.some((chunk) => chunk.id === numericId)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  return new NextResponse(renderSitemapXml(await getSitemapChunk(numericId)), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}

function renderSitemapXml(items: Awaited<ReturnType<typeof getSitemapChunk>>): string {
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
