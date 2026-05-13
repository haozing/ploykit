import type { MetadataRoute } from 'next';
import { appBaseUrl, absoluteUrl } from '@/lib/seo/url-policy';
import { listSitemapChunks } from '@/lib/seo/sitemap.server';

export const dynamic = 'force-dynamic';
export const revalidate = 3600;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const chunks = await listSitemapChunks();

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/plugins/',
          '/profile',
          '/billing',
          '/notifications',
          '/tasks',
          '/settings/',
          '/login',
          '/register',
          '/forgot-password',
          '/reset-password',
          '/success',
        ],
      },
    ],
    sitemap: [
      absoluteUrl('/sitemap.xml'),
      ...chunks.map((chunk) => absoluteUrl(`/sitemap/${chunk.id}.xml`)),
    ],
    host: appBaseUrl(),
  };
}
