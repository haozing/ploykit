import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { locales, type Locale } from '@/i18n/config';
import { getClientMessagesForPath } from '@/i18n/client-messages';

interface LangLayoutProps {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}

export default async function LangLayout({ children, params }: LangLayoutProps) {
  const { lang } = await params;

  if (!locales.includes(lang as Locale)) {
    notFound();
  }

  // Load messages and pass to ClientComponent
  const messages = await getMessages();
  const requestHeaders = await headers();
  const pathname = requestHeaders.get('x-pathname') || `/${lang}`;
  const clientMessages = getClientMessagesForPath(messages, pathname, lang);

  return (
    <NextIntlClientProvider messages={clientMessages} locale={lang}>
      {children}
    </NextIntlClientProvider>
  );
}

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}
