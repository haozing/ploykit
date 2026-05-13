/**
 * Forgot Password Page
 *
 * Uses ForgotPasswordForm component to provide password reset functionality
 */

import { ForgotPasswordForm } from '@/components/auth/forgot-password-form';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  const t = await getTranslations('auth.forgotPassword');
  const common = await getTranslations('common');

  return {
    title: `${t('title')} | ${common('siteName')}`,
    description: t('description'),
  };
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
