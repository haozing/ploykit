import type { Metadata } from 'next';
import { modulePathFromSegments } from '@host/lib/paths';
import { renderSiteModulePage, siteModuleMetadata } from '@host/lib/site-module-page';

export const dynamic = 'force-dynamic';

interface SitePageProps {
  params: Promise<{
    slug: string[];
  }>;
}

export async function generateMetadata({ params }: SitePageProps): Promise<Metadata> {
  const { slug } = await params;
  return siteModuleMetadata(modulePathFromSegments(slug));
}

export default async function SitePage({ params }: SitePageProps) {
  const { slug } = await params;
  return renderSiteModulePage(modulePathFromSegments(slug));
}
