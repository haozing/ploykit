/**
 * RBAC Page - Redirect to Users Page (RBAC Tab)
 *
 * This page has been merged into the Users page as a tab.
 * Redirects to: /[lang]/admin/users?tab=rbac
 */

'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

export default function RBACRedirectPage() {
  const t = useTranslations('dashboard.rbac.redirect');
  const router = useRouter();
  const params = useParams();
  const lang = params.lang as string;

  useEffect(() => {
    // Redirect to users page with RBAC tab
    router.replace(`/${lang}/admin/users?tab=rbac`);
  }, [router, lang]);

  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <p className="text-muted-foreground">{t('redirecting')}</p>
      </div>
    </div>
  );
}
