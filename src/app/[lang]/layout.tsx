import { notFound } from 'next/navigation';
import { locales, type Locale } from '@/i18n/config';
import { IntlMessagesProvider } from '@/i18n/IntlMessagesProvider';

interface LangLayoutProps {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}

export default async function LangLayout({ children, params }: LangLayoutProps) {
  const { lang } = await params;

  if (!locales.includes(lang as Locale)) {
    notFound();
  }

  return <IntlMessagesProvider scope="global">{children}</IntlMessagesProvider>;
}

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}
