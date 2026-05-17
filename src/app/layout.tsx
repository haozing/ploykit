import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ErrorBoundary } from '@/components/errors';
import { PluginHeadTags } from '@/components/plugin-head-tags';
import { ThemeProvider } from '@/components/theme-provider';
import { LanguageProvider } from '@/contexts/language-context';
import { SWRProvider } from '@/providers/swr-provider';
import { tokensToCSS } from '@/lib/ui/theme/theme-css';
import { resolvePluginThemeTokens } from '@/lib/ui/theme/plugin-theme.server';
import { appBaseUrl } from '@/lib/seo/url-policy';
import { getThemeTokens } from '../../theme.config';
import { siteConfig } from '../../site.config';
import { SlotRenderer } from '@/components/SlotRenderer';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

/**
 * Dynamically generate metadata.
 *
 * - Collect meta tags and titles from plugins.
 * - Merge them into the base metadata.
 */
export async function generateMetadata(): Promise<Metadata> {
  const baseMetadata: Metadata = {
    metadataBase: new URL(appBaseUrl()),
    title: siteConfig.name,
    description: siteConfig.description,
    icons: {
      icon: [
        { url: siteConfig.assets.brand.faviconSvg, type: 'image/svg+xml' },
        { url: siteConfig.assets.brand.faviconIco },
      ],
      shortcut: siteConfig.assets.brand.faviconIco,
      apple: siteConfig.assets.brand.appleTouchIcon,
    },
  };

  // TODO: Collect metadata from plugin hooks.
  // const pluginMetadata = await collectPluginMetadata();
  // return { ...baseMetadata, ...pluginMetadata };

  return baseMetadata;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const tokens = await resolvePluginThemeTokens(getThemeTokens());
  const cssVariables = tokensToCSS(tokens);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Head meta slot */}
        <SlotRenderer slotName="head:meta" mode="append" />

        {/* Plugin injected head tags */}
        <PluginHeadTags />

        {/* Inject design tokens as CSS variables */}
        <style
          dangerouslySetInnerHTML={{
            __html: `:root { ${cssVariables} }`,
          }}
        />

        {/* Head scripts slot */}
        <SlotRenderer slotName="head:scripts" mode="append" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {/* Body start slot */}
        <SlotRenderer slotName="body:start" mode="append" />

        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <SWRProvider>
            <LanguageProvider>
              <ErrorBoundary context="root">{children}</ErrorBoundary>
            </LanguageProvider>
          </SWRProvider>
        </ThemeProvider>

        {/* Body end slot */}
        <SlotRenderer slotName="body:end" mode="append" />
      </body>
    </html>
  );
}
