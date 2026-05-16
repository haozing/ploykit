import Link from 'next/link';
import { ShellLayout } from '@/components/layouts/ShellLayout';
import { HostPageSlotBoundary } from '@/components/HostPageSurfaceRenderer';
import { getTranslations } from 'next-intl/server';
import { createSitePageMetadata } from '@/lib/seo/site-metadata';
import { createHostPageOverrideMetadata } from '@/lib/plugin-runtime/seo';

interface HomePageProps {
  params: Promise<{ lang: string }>;
}

export async function generateMetadata({ params }: HomePageProps) {
  const { lang } = await params;
  const overrideMetadata = await createHostPageOverrideMetadata({ path: '/', locale: lang });
  if (overrideMetadata) {
    return overrideMetadata;
  }

  const t = await getTranslations('home');
  const tCommon = await getTranslations('common');

  return createSitePageMetadata({
    locale: lang,
    path: '/',
    title: t('title', { siteName: tCommon('siteName') }),
    description: t('description'),
  });
}

export default async function Home({ params }: HomePageProps) {
  const { lang } = await params;
  const t = await getTranslations('home');
  const tCommon = await getTranslations('common');

  return (
    <ShellLayout pathname="/" locale={lang}>
      <div className="flex flex-col items-center justify-center py-16">
        <HostPageSlotBoundary
          pathname="/"
          position="hero.before"
          locale={lang}
          className="mb-8 w-full"
        />
        <div className="text-center max-w-3xl">
          <h1
            className="text-4xl md:text-6xl font-bold mb-6"
            style={{
              color: 'var(--color-text)',
            }}
          >
            {t('title', { siteName: tCommon('siteName') })}
          </h1>

          <p
            className="text-lg md:text-xl mb-8 opacity-80"
            style={{
              color: 'var(--color-text)',
            }}
          >
            {t('description')}
          </p>

          <div className="flex gap-4 justify-center">
            <Link
              href={`/${lang}/tools`}
              className="px-6 py-3 rounded-lg font-medium transition-colors"
              style={{
                backgroundColor: 'var(--color-primary)',
                color: 'var(--color-primary-text)',
              }}
            >
              {t('exploreTools')}
            </Link>
            <Link
              href={`/${lang}/about`}
              className="px-6 py-3 rounded-lg font-medium transition-colors border"
              style={{
                color: 'var(--color-text)',
                borderColor: 'var(--color-text)',
              }}
            >
              {t('learnMore')}
            </Link>
          </div>
        </div>
        <HostPageSlotBoundary
          pathname="/"
          position="hero.after"
          locale={lang}
          className="mt-8 w-full"
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-16 w-full max-w-5xl">
          <div className="p-6 rounded-lg" style={{ backgroundColor: 'var(--color-bg)' }}>
            <h3 className="text-xl font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
              {t('features.plugins.title')}
            </h3>
            <p className="opacity-80" style={{ color: 'var(--color-text)' }}>
              {t('features.plugins.description')}
            </p>
          </div>

          <div className="p-6 rounded-lg" style={{ backgroundColor: 'var(--color-bg)' }}>
            <h3 className="text-xl font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
              {t('features.theme.title')}
            </h3>
            <p className="opacity-80" style={{ color: 'var(--color-text)' }}>
              {t('features.theme.description')}
            </p>
          </div>

          <div className="p-6 rounded-lg" style={{ backgroundColor: 'var(--color-bg)' }}>
            <h3 className="text-xl font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
              {t('features.developer.title')}
            </h3>
            <p className="opacity-80" style={{ color: 'var(--color-text)' }}>
              {t('features.developer.description')}
            </p>
          </div>
        </div>
      </div>
    </ShellLayout>
  );
}
