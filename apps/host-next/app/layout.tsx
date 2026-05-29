import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { LanguageDocumentState } from '@host/components/i18n/LanguageDocumentState';
import { ProductStructuredData } from '@host/components/seo/ProductStructuredData';
import { ProductThemeStyle } from '@host/components/theme/ProductThemeStyle';
import { ThemeProvider } from '@host/components/theme/ThemeProvider';
import {
  getDefaultProductSeoMetadata,
  getDefaultProductViewport,
} from '@host/lib/presentation/seo-presentation';
import { getProductThemeRuntimeView } from '@host/lib/product-composition';
import { languageFromHeaders } from '@host/lib/i18n';
import './globals.css';

export const metadata: Metadata = getDefaultProductSeoMetadata();
export const viewport: Viewport = getDefaultProductViewport();

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const lang = languageFromHeaders(requestHeaders);
  const productTheme = getProductThemeRuntimeView();
  return (
    <html lang={lang} data-lang={lang} suppressHydrationWarning>
      <body suppressHydrationWarning>
        <LanguageDocumentState />
        <ProductThemeStyle theme={productTheme} />
        <ProductStructuredData lang={lang} />
        <ThemeProvider defaultTheme={productTheme.defaultTheme}>{children}</ThemeProvider>
      </body>
    </html>
  );
}
