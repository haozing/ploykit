/**
 * Subscription success page
 *
 * Path: /[lang]/success
 * 设计方案参考：PaymentSubscriptionSystem设计方案.md 第5节
 */

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

export default function SuccessPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locale = useLocale();
  const t = useTranslations('success');
  const [countdown, setCountdown] = useState(5);

  const sessionId = searchParams.get('session_id');
  const billingPath = `/${locale}/billing`;
  const profilePath = `/${locale}/profile`;

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    } else {
      router.push(billingPath);
    }
  }, [billingPath, countdown, router]);

  return (
    <div className="success-page min-h-screen flex items-center justify-center bg-muted">
      <div className="text-center max-w-md mx-auto p-8">
        <div className="mb-8">
          <div className="w-20 h-20 bg-success-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-12 h-12 text-success"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold mb-4 text-foreground">{t('title')}</h1>
          <p className="text-muted-foreground mb-2">{t('thanks')}</p>
          <p className="text-muted-foreground">{t('ready')}</p>
        </div>

        {sessionId && (
          <div className="mb-6 p-3 bg-muted rounded-lg">
            <p className="text-xs text-muted-foreground break-all">
              {t('sessionId')}: {sessionId}
            </p>
          </div>
        )}

        <div className="mb-8 bg-card border rounded-lg p-6 text-left">
          <h2 className="font-semibold mb-3 text-foreground">{t('availableTitle')}</h2>
          <ul className="space-y-2 text-sm text-foreground">
            <li className="flex items-start">
              <span className="text-success mr-2" aria-hidden="true">
                ✓
              </span>
              <span>{t('features.tools')}</span>
            </li>
            <li className="flex items-start">
              <span className="text-success mr-2" aria-hidden="true">
                ✓
              </span>
              <span>{t('features.limits')}</span>
            </li>
            <li className="flex items-start">
              <span className="text-success mr-2" aria-hidden="true">
                ✓
              </span>
              <span>{t('features.billing')}</span>
            </li>
          </ul>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => router.push(billingPath)}
            className="w-full bg-primary text-white px-8 py-3 rounded-lg hover:bg-primary font-semibold transition-colors"
          >
            {t('actions.billing')}
          </button>
          <button
            onClick={() => router.push(profilePath)}
            className="w-full bg-muted text-foreground px-8 py-3 rounded-lg hover:bg-accent font-semibold transition-colors"
          >
            {t('actions.profile')}
          </button>
        </div>

        <p className="text-sm text-muted-foreground mt-6">{t('redirect', { count: countdown })}</p>
      </div>
    </div>
  );
}
