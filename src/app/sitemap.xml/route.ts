import { NextResponse } from 'next/server';
import { collectSitemapItems } from '@/lib/seo/sitemap.server';
import { renderSitemapXml } from '@/lib/seo/sitemap-xml';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

export async function GET() {
  return new NextResponse(renderSitemapXml(await collectSitemapItems()), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
