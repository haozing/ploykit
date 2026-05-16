import { IntlMessagesProvider } from '@/i18n/IntlMessagesProvider';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <IntlMessagesProvider scope="site">{children}</IntlMessagesProvider>;
}
