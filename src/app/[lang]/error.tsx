'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('errors.500');

  useEffect(() => {
    // Log error to console (in production, send to monitoring service)
    console.error('Error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-2xl">
        {/* Error Icon */}
        <div className="mb-8">
          <svg
            className="w-24 h-24 mx-auto"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            style={{ color: '#ef4444' }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        {/* Title */}
        <h1 className="text-3xl md:text-4xl font-bold mb-4" style={{ color: 'var(--color-text)' }}>
          {t('title')}
        </h1>

        {/* Description */}
        <p className="text-lg mb-8 opacity-80" style={{ color: 'var(--color-text)' }}>
          {t('description')}
        </p>

        {/* Error ID (if available) */}
        {error.digest && (
          <p className="text-sm mb-8 opacity-60 font-mono" style={{ color: 'var(--color-text)' }}>
            Error ID: {error.digest}
          </p>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={reset}
            className="px-6 py-3 rounded-lg font-medium transition-colors"
            style={{
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-primary-text)',
            }}
          >
            {t('retry')}
          </button>
          <Link
            href="/"
            className="px-6 py-3 rounded-lg font-medium transition-colors border"
            style={{
              color: 'var(--color-text)',
              borderColor: 'var(--color-text)',
            }}
          >
            {t('backHome') || 'Back to Home'}
          </Link>
        </div>
      </div>
    </div>
  );
}
