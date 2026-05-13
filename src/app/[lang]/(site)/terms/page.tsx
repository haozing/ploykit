import { ShellLayout } from '@/components/layouts/ShellLayout';
import { getTranslations } from 'next-intl/server';
import { createSitePageMetadata } from '@/lib/seo/site-metadata';

interface TermsPageProps {
  params: Promise<{ lang: string }>;
}

export async function generateMetadata({ params }: TermsPageProps) {
  const { lang } = await params;
  const t = await getTranslations('terms');

  return createSitePageMetadata({
    locale: lang,
    path: '/terms',
    title: t('title'),
    description: t('intro'),
  });
}

export default async function TermsPage() {
  const t = await getTranslations('terms');

  const sections = [
    'service',
    'account',
    'usage',
    'plugins',
    'billing',
    'ip',
    'liability',
    'changes',
  ];

  return (
    <ShellLayout pathname="/terms">
      <div className="max-w-4xl mx-auto py-16 px-4">
        {/* Hero */}
        <div className="mb-12">
          <h1
            className="text-4xl md:text-5xl font-bold mb-4"
            style={{ color: 'var(--color-text)' }}
          >
            {t('title')}
          </h1>
          <p className="text-sm opacity-60" style={{ color: 'var(--color-text)' }}>
            {t('effectiveDate')}: 2025-01-01
          </p>
        </div>

        {/* Introduction */}
        <div className="mb-12 p-6 rounded-lg" style={{ backgroundColor: 'var(--color-bg)' }}>
          <p className="text-lg leading-relaxed" style={{ color: 'var(--color-text)' }}>
            {t('intro')}
          </p>
        </div>

        {/* Sections */}
        {sections.map((section) => {
          const isHighlight = section === 'plugins' || section === 'billing';

          return (
            <section
              key={section}
              className={`mb-10 ${isHighlight ? 'p-6 rounded-lg border-l-4' : ''}`}
              style={
                isHighlight
                  ? {
                      backgroundColor: 'rgba(147, 51, 234, 0.1)',
                      borderColor: 'rgb(147, 51, 234)',
                    }
                  : {}
              }
            >
              <h2
                className="text-2xl font-bold mb-4"
                style={{ color: isHighlight ? 'rgb(147, 51, 234)' : 'var(--color-text)' }}
              >
                {t(`sections.${section}.title`)}
              </h2>
              <p
                className="text-base leading-relaxed opacity-90"
                style={{ color: 'var(--color-text)' }}
              >
                {t(`sections.${section}.content`)}
              </p>
            </section>
          );
        })}
      </div>
    </ShellLayout>
  );
}
