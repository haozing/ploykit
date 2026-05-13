import type { MetadataRoute } from 'next';
import { collectSitemapItems } from '@/lib/seo/sitemap.server';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return collectSitemapItems();
}
