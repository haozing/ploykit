/**
 * Registration Page
 *
 * Uses RegisterForm component to provide registration functionality
 */

import { RegisterForm } from '@/components/auth/register-form';
import { getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  const t = await getTranslations('auth.register');
  const common = await getTranslations('common');

  return {
    title: `${t('title')} | ${common('siteName')}`,
    description: t('description'),
  };
}

export default function RegisterPage() {
  return <RegisterForm />;
}
