import { ShellLayout } from '@/components/layouts/ShellLayout';
import { HostPageSlotBoundary } from '@/components/HostPageSurfaceRenderer';
import { getTranslations } from 'next-intl/server';
import { createSitePageMetadata } from '@/lib/seo/site-metadata';
import { createHostPageOverrideMetadata } from '@/lib/plugin-runtime/seo';

interface AboutPageProps {
  params: Promise<{ lang: string }>;
}

export async function generateMetadata({ params }: AboutPageProps) {
  const { lang } = await params;
  const overrideMetadata = await createHostPageOverrideMetadata({ path: '/about', locale: lang });
  if (overrideMetadata) {
    return overrideMetadata;
  }

  const t = await getTranslations('about');

  return createSitePageMetadata({
    locale: lang,
    path: '/about',
    title: t('title'),
    description: t('description'),
  });
}

export default async function AboutPage({ params }: AboutPageProps) {
  const { lang } = await params;
  const t = await getTranslations('about');

  return (
    <ShellLayout pathname="/about" locale={lang}>
      <div className="max-w-4xl mx-auto py-16">
        <HostPageSlotBoundary
          pathname="/about"
          position="hero.before"
          locale={lang}
          className="mb-8"
        />
        <div className="text-center mb-16">
          <h1
            className="text-4xl md:text-5xl font-bold mb-4"
            style={{ color: 'var(--color-text)' }}
          >
            {t('hero.title')}
          </h1>
          <p className="text-xl opacity-80" style={{ color: 'var(--color-text)' }}>
            {t('hero.subtitle')}
          </p>
        </div>
        <HostPageSlotBoundary
          pathname="/about"
          position="hero.after"
          locale={lang}
          className="mb-16"
        />

        <section className="mb-16">
          <h2 className="text-3xl font-bold mb-6" style={{ color: 'var(--color-text)' }}>
            {t('mission.title')}
          </h2>
          <p className="text-lg leading-relaxed opacity-90" style={{ color: 'var(--color-text)' }}>
            {t('mission.content')}
          </p>
        </section>

        <section>
          <h2 className="text-3xl font-bold mb-8" style={{ color: 'var(--color-text)' }}>
            {t('values.title')}
          </h2>

          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-6 rounded-lg" style={{ backgroundColor: 'var(--color-bg)' }}>
              <h3 className="text-xl font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
                {t('values.openness.title')}
              </h3>
              <p className="opacity-80" style={{ color: 'var(--color-text)' }}>
                {t('values.openness.description')}
              </p>
            </div>

            <div className="p-6 rounded-lg" style={{ backgroundColor: 'var(--color-bg)' }}>
              <h3 className="text-xl font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
                {t('values.innovation.title')}
              </h3>
              <p className="opacity-80" style={{ color: 'var(--color-text)' }}>
                {t('values.innovation.description')}
              </p>
            </div>

            <div className="p-6 rounded-lg" style={{ backgroundColor: 'var(--color-bg)' }}>
              <h3 className="text-xl font-semibold mb-3" style={{ color: 'var(--color-text)' }}>
                {t('values.quality.title')}
              </h3>
              <p className="opacity-80" style={{ color: 'var(--color-text)' }}>
                {t('values.quality.description')}
              </p>
            </div>
          </div>
        </section>
      </div>
    </ShellLayout>
  );
}
