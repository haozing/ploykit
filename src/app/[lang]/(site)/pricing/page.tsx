/**
 * 定价页面 - 平台级Subscription
 *
 * Path: /[lang]/pricing
 * 设计方案参考：PaymentSubscriptionSystem设计方案.md 第5.1节
 *
 * 🆕 架构：
 * - Server Component wrapper with ShellLayout
 * - Client Component (PricingContent) for interactive features
 * - Ensures consistent layout with other frontend pages (about, contact)
 */

import { ShellLayout } from '@/components/layouts/ShellLayout';
import { getTranslations } from 'next-intl/server';
import { createSitePageMetadata } from '@/lib/seo/site-metadata';
import PricingContent from './PricingContent';

interface PricingPageProps {
  params: Promise<{ lang: string }>;
}

export async function generateMetadata({ params }: PricingPageProps) {
  const { lang } = await params;
  const t = await getTranslations('pricing');

  return createSitePageMetadata({
    locale: lang,
    path: '/pricing',
    title: t('hero.title'),
    description: t('hero.subtitle'),
  });
}

export default async function PricingPage() {
  return (
    <ShellLayout pathname="/pricing">
      <PricingContent />
    </ShellLayout>
  );
}
