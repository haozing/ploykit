import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { getClientMessagesForScope, type ClientMessageScope } from './client-messages';

interface IntlMessagesProviderProps {
  scope?: ClientMessageScope;
  children: React.ReactNode;
}

export async function IntlMessagesProvider({
  scope = 'global',
  children,
}: IntlMessagesProviderProps) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  const clientMessages = getClientMessagesForScope(messages, scope);

  return (
    <NextIntlClientProvider locale={locale} messages={clientMessages}>
      {children}
    </NextIntlClientProvider>
  );
}
