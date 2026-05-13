import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export default async function NotFound() {
  const t = await getTranslations('errors.404');
  const tCommon = await getTranslations('common');

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-2xl">
        {/* 404 Big Number */}
        <div
          className="text-9xl font-bold mb-8"
          style={{
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}
        >
          404
        </div>

        {/* Title */}
        <h1 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: 'var(--color-text)' }}>
          {t('title')}
        </h1>

        {/* Description */}
        <p className="text-lg mb-8 opacity-80" style={{ color: 'var(--color-text)' }}>
          {t('description')}
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
          <Link
            href="/"
            className="px-6 py-3 rounded-lg font-medium transition-colors"
            style={{
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-primary-text)',
            }}
          >
            {t('backHome')}
          </Link>
        </div>

        {/* Quick Links */}
        <div className="flex flex-wrap gap-6 justify-center opacity-70">
          <Link
            href="/about"
            className="text-sm hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-text)' }}
          >
            {tCommon('nav.about')}
          </Link>
          <Link
            href="/contact"
            className="text-sm hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-text)' }}
          >
            {tCommon('nav.contact')}
          </Link>
        </div>
      </div>
    </div>
  );
}
