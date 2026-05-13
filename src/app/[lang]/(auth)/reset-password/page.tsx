/**
 * Reset Password Page
 *
 * Handles the callback page for Better Auth password reset links.
 */

import { Suspense } from 'react';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  const t = await getTranslations('auth.resetPassword');
  const common = await getTranslations('common');

  return {
    title: `${t('title')} | ${common('siteName')}`,
    description: t('description'),
  };
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
