/**
 * ════════════════════════════════════════════════════════════
 * 联系我们页面
 * ════════════════════════════════════════════════════════════
 */

import { getTranslations } from 'next-intl/server';
import { ShellLayout } from '@/components/layouts/ShellLayout';
import { HostPageSlotBoundary } from '@/components/HostPageSurfaceRenderer';
import { SlotRenderer } from '@/components/SlotRenderer';
import { ContactForm } from '@/components/forms/ContactForm';
import { createSitePageMetadata } from '@/lib/seo/site-metadata';
import { createHostPageOverrideMetadata } from '@/lib/plugin-runtime/seo';

interface ContactPageProps {
  params: Promise<{ lang: string }>;
}

export async function generateMetadata({ params }: ContactPageProps) {
  const { lang } = await params;
  const overrideMetadata = await createHostPageOverrideMetadata({ path: '/contact', locale: lang });
  if (overrideMetadata) {
    return overrideMetadata;
  }

  const t = await getTranslations('contact');

  return createSitePageMetadata({
    locale: lang,
    path: '/contact',
    title: t('title'),
    description: t('subtitle'),
  });
}

export default async function ContactPage({ params }: ContactPageProps) {
  const { lang } = await params;
  const t = await getTranslations('contact');
  const tMethods = await getTranslations('contact.methods');

  const contactMethods = [
    {
      icon: (
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ),
      title: tMethods('support.title'),
      value: tMethods('support.value'),
      description: tMethods('support.description'),
      color: 'rgb(59, 130, 246)', // Blue
    },
    {
      icon: (
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      ),
      title: tMethods('business.title'),
      value: tMethods('business.value'),
      description: tMethods('business.description'),
      color: 'rgb(139, 92, 246)', // Purple
    },
    {
      icon: (
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
          />
        </svg>
      ),
      title: tMethods('github.title'),
      value: tMethods('github.value'),
      description: tMethods('github.description'),
      color: 'rgb(34, 197, 94)', // Green
    },
  ];

  return (
    <ShellLayout pathname="/contact" locale={lang}>
      <div className="max-w-6xl mx-auto py-16 px-4">
        <SlotRenderer slotName="site.contact:main.before" />

        {/* Hero Section */}
        <HostPageSlotBoundary
          pathname="/contact"
          position="hero.before"
          locale={lang}
          className="mb-8"
        />
        <div className="text-center mb-16">
          <h1
            className="text-4xl md:text-5xl font-bold mb-4"
            style={{ color: 'var(--color-text)' }}
          >
            {t('title')}
          </h1>
          <p
            className="text-lg md:text-xl opacity-80 max-w-2xl mx-auto"
            style={{ color: 'var(--color-text)' }}
          >
            {t('subtitle')}
          </p>
        </div>
        <HostPageSlotBoundary
          pathname="/contact"
          position="hero.after"
          locale={lang}
          className="mb-16"
        />

        {/* Contact Methods */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {contactMethods.map((method, index) => (
            <div
              key={index}
              className="p-6 rounded-lg border transition-all hover:shadow-lg"
              style={{
                backgroundColor: 'var(--color-background)',
                borderColor: method.color,
                borderWidth: '2px',
              }}
            >
              <div className="mb-4" style={{ color: method.color }}>
                {method.icon}
              </div>
              <h3 className="text-xl font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
                {method.title}
              </h3>
              <p className="font-medium mb-2" style={{ color: method.color }}>
                {method.value}
              </p>
              <p className="text-sm opacity-70" style={{ color: 'var(--color-text)' }}>
                {method.description}
              </p>
            </div>
          ))}
        </div>

        {/* Contact Form Section */}
        <div className="max-w-2xl mx-auto">
          <div
            className="p-8 rounded-lg shadow-lg"
            style={{
              backgroundColor: 'var(--color-background)',
              border: '1px solid rgba(0, 0, 0, 0.1)',
            }}
          >
            <h2
              className="text-2xl font-bold mb-6 text-center"
              style={{ color: 'var(--color-text)' }}
            >
              {t('form.title')}
            </h2>
            <ContactForm />
          </div>
        </div>

        <SlotRenderer slotName="site.contact:main.after" />
      </div>
    </ShellLayout>
  );
}
