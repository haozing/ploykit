import { ShellLayout } from '@/components/layouts/ShellLayout';
import { HostPageSlotBoundary } from '@/components/HostPageSurfaceRenderer';
import { getTranslations } from 'next-intl/server';
import { createSitePageMetadata } from '@/lib/seo/site-metadata';
import { createHostPageOverrideMetadata } from '@/lib/plugin-runtime/seo';

interface PrivacyPageProps {
  params: Promise<{ lang: string }>;
}

export async function generateMetadata({ params }: PrivacyPageProps) {
  const { lang } = await params;
  const overrideMetadata = await createHostPageOverrideMetadata({ path: '/privacy', locale: lang });
  if (overrideMetadata) {
    return overrideMetadata;
  }

  const t = await getTranslations('privacy');

  return createSitePageMetadata({
    locale: lang,
    path: '/privacy',
    title: t('title'),
    description: t('intro'),
  });
}

export default async function PrivacyPage({ params }: PrivacyPageProps) {
  const { lang } = await params;
  const t = await getTranslations('privacy');

  return (
    <ShellLayout pathname="/privacy" locale={lang}>
      <div className="max-w-4xl mx-auto py-16 px-4">
        {/* Hero Section */}
        <HostPageSlotBoundary
          pathname="/privacy"
          position="hero.before"
          locale={lang}
          className="mb-8"
        />
        <div className="mb-12">
          <h1
            className="text-4xl md:text-5xl font-bold mb-4"
            style={{ color: 'var(--color-text)' }}
          >
            {t('title')}
          </h1>
          <p className="text-sm opacity-60" style={{ color: 'var(--color-text)' }}>
            {t('lastUpdated')}: 2025-01-01
          </p>
        </div>
        <HostPageSlotBoundary
          pathname="/privacy"
          position="hero.after"
          locale={lang}
          className="mb-12"
        />

        {/* Introduction */}
        <div className="mb-12 p-6 rounded-lg" style={{ backgroundColor: 'var(--color-bg)' }}>
          <p className="text-lg leading-relaxed" style={{ color: 'var(--color-text)' }}>
            {t('intro')}
          </p>
        </div>

        {/* Section 1: Information Collection */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--color-text)' }}>
            {t('sections.collection.title')}
          </h2>
          <p
            className="text-base leading-relaxed opacity-90"
            style={{ color: 'var(--color-text)' }}
          >
            {t('sections.collection.content')}
          </p>
        </section>

        {/* Section 2: Information Usage */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--color-text)' }}>
            {t('sections.usage.title')}
          </h2>
          <p
            className="text-base leading-relaxed opacity-90"
            style={{ color: 'var(--color-text)' }}
          >
            {t('sections.usage.content')}
          </p>
        </section>

        {/* Section 3: Data Isolation (Highlight) */}
        <section
          className="mb-10 p-6 rounded-lg border-l-4"
          style={{
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            borderColor: 'rgb(59, 130, 246)',
          }}
        >
          <h2 className="text-2xl font-bold mb-4" style={{ color: 'rgb(59, 130, 246)' }}>
            {t('sections.isolation.title')}
          </h2>
          <p className="text-base leading-relaxed" style={{ color: 'var(--color-text)' }}>
            {t('sections.isolation.content')}
          </p>
        </section>

        {/* Section 4: Third-Party Services */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--color-text)' }}>
            {t('sections.thirdparty.title')}
          </h2>
          <p
            className="text-base leading-relaxed opacity-90"
            style={{ color: 'var(--color-text)' }}
          >
            {t('sections.thirdparty.content')}
          </p>
        </section>

        {/* Section 5: Cookies */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--color-text)' }}>
            {t('sections.cookies.title')}
          </h2>
          <p
            className="text-base leading-relaxed opacity-90"
            style={{ color: 'var(--color-text)' }}
          >
            {t('sections.cookies.content')}
          </p>
        </section>

        {/* Section 6: Security */}
        <section className="mb-10">
          <h2 className="text-2xl font-bold mb-4" style={{ color: 'var(--color-text)' }}>
            {t('sections.security.title')}
          </h2>
          <p
            className="text-base leading-relaxed opacity-90"
            style={{ color: 'var(--color-text)' }}
          >
            {t('sections.security.content')}
          </p>
        </section>

        {/* Section 7: User Rights (Highlight) */}
        <section
          className="mb-10 p-6 rounded-lg border-l-4"
          style={{
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            borderColor: 'rgb(34, 197, 94)',
          }}
        >
          <h2 className="text-2xl font-bold mb-4" style={{ color: 'rgb(34, 197, 94)' }}>
            {t('sections.rights.title')}
          </h2>
          <p className="text-base leading-relaxed" style={{ color: 'var(--color-text)' }}>
            {t('sections.rights.content')}
          </p>
        </section>
      </div>
    </ShellLayout>
  );
}
