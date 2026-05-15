import { NextResponse } from 'next/server';
import { getSitemapChunk, listSitemapChunks } from '@/lib/seo/sitemap.server';
import { renderSitemapXml } from '@/lib/seo/sitemap-xml';

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
