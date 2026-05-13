/**
 * Login Page
 *
 * Uses LoginForm component to provide login functionality
 */

import { LoginForm } from '@/components/auth/login-form';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  const t = await getTranslations('auth.login');
  const common = await getTranslations('common');

  return {
    title: `${t('title')} | ${common('siteName')}`,
    description: t('description'),
  };
}

export default function LoginPage() {
  return <LoginForm />;
}
