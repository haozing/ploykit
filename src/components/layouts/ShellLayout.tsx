/**
 * ============================================================================
 * Shell Layout Component
 * ============================================================================
 *
 * Standard Header + Main + Footer layout
 *
 * Features:
 * - Dynamically loads Header/Footer components (based on site.config.ts)
 * - Responsive container (fixed/full)
 * - Supports page-level slots (before/after/replace)
 * - Passes design tokens to layout components
 *
 * Workflow:
 * 1. Load theme tokens
 * 2. Load Header/Footer components
 * 3. Render layout structure
 * 4. Apply container configuration and content spacing
 */

import { getThemeTokens } from '../../../theme.config';
import { loadHeaderComponent, loadFooterComponent } from '@/lib/ui/layout/layout-resolver';
import { resolvePluginThemeTokens } from '@/lib/ui/theme/plugin-theme.server';
import { siteConfig } from '../../../site.config';
import { SlotRenderer } from '@/components/SlotRenderer';
import { RouteSlotRenderer } from '@/components/RouteSlotRenderer';
import type { SlotName } from '@/lib/ui/slots/types';
import type { ReactNode, ReactElement } from 'react';
import { resolveHostPageSurface } from '@/lib/host-pages/surface.server';
import { HostPageOverride, HostPageSlotList } from '@/components/HostPageSurfaceRenderer';

/**
 * ============================================================================
 * ShellLayout Props
 * ============================================================================
 */
export interface ShellLayoutProps {
  /** Page path (used to find page configuration) */
  pathname: string;

  /** Active locale passed to plugin-rendered host page surfaces */
  locale?: string;

  /** Page content */
  children: ReactNode;
}

/**
 * ============================================================================
 * ShellLayout Component
 * ============================================================================
 *
 * This is a Server Component (still needs async due to other async operations)
 */
export async function ShellLayout({
  pathname,
  locale = 'en',
  children,
}: ShellLayoutProps): Promise<ReactElement> {
  //
  // 1. Load Design Tokens (synchronous)
  //
  const tokens = await resolvePluginThemeTokens(getThemeTokens());
  const surface = await resolveHostPageSurface(pathname);

  //
  // 2. Load Header and Footer components
  //
  const HeaderComponent = await loadHeaderComponent();
  const FooterComponent = await loadFooterComponent();

  //
  // 3. Get page configuration
  //
  const pageConfig = siteConfig.pages[pathname] || {
    layout: 'shell' as const,
    container: 'fixed' as const,
  };
  const shell = surface?.override?.shell;
  const showHeader = pageConfig.hideHeader !== true && shell?.header !== 'hidden';
  const showFooter = pageConfig.hideFooter !== true && shell?.footer !== 'hidden';
  const container = shell?.container ?? surface?.page.defaultContainer ?? pageConfig.container;

  //
  // 4. Calculate page-level slot names
  //
  // Convert pathname to slot name: '/' -> 'site.home', '/about' -> 'site.about'
  const pageName = pathname === '/' ? 'home' : pathname.slice(1).replace(/\//g, '.');
  const slotPrefix = surface?.page.slotPrefix ?? (`site.${pageName}` as const);

  const beforeSlot = `${slotPrefix}:main.before` as SlotName;
  const afterSlot = `${slotPrefix}:main.after` as SlotName;
  const replaceSlot = `${slotPrefix}:main.replace` as SlotName;

  //
  // 5. Container styles
  //
  const containerStyle =
    container === 'fixed'
      ? {
          maxWidth: tokens.common.containerMaxW,
          marginLeft: 'auto',
          marginRight: 'auto',
          paddingLeft: '24px',
          paddingRight: '24px',
        }
      : container === 'full'
        ? {
            width: '100%',
          }
        : {
            width: '100%',
            paddingLeft: '24px',
            paddingRight: '24px',
          };

  //
  // 6. Render layout
  //
  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      {showHeader ? <HeaderComponent tokens={tokens} locale={locale} /> : null}

      {/* 🆕 Content before slot */}
      <SlotRenderer slotName="content:before" mode="append" className="w-full" locale={locale} />

      {/* Main Content */}
      <main
        className="flex-1 flex"
        style={{
          paddingTop: tokens.content.paddingY,
          paddingBottom: tokens.content.paddingY,
          backgroundColor: tokens.content.bg,
        }}
      >
        {/* 🆕 Left sidebar slot */}
        <SlotRenderer
          slotName="sidebar:left"
          mode="append"
          className="hidden lg:block lg:w-64 lg:flex-shrink-0"
          locale={locale}
        />

        <div className="flex-1" style={containerStyle}>
          {/* Before slot: render before content (existing) */}
          <SlotRenderer slotName={beforeSlot} mode="append" className="mb-8" locale={locale} />
          <HostPageSlotList
            slots={surface?.slots.filter((slot) => slot.position === 'main.before') ?? []}
            locale={locale}
            className="mb-8"
          />
          <RouteSlotRenderer
            pathname={pathname}
            position="main.before"
            className="mb-8"
            locale={locale}
          />

          {/* Replace slot: if exists, completely replace page content (existing) */}
          {surface?.override ? (
            <HostPageOverride
              override={surface.override}
              locale={locale}
              fallback={
                <RouteSlotRenderer
                  pathname={pathname}
                  position="main.replace"
                  mode="replace"
                  fallback={children}
                  locale={locale}
                />
              }
            />
          ) : (
            <SlotRenderer
              slotName={replaceSlot}
              mode="replace"
              fallback={
                <RouteSlotRenderer
                  pathname={pathname}
                  position="main.replace"
                  mode="replace"
                  fallback={children}
                  locale={locale}
                />
              }
              locale={locale}
            />
          )}

          {/* After slot: render after content (existing) */}
          <RouteSlotRenderer
            pathname={pathname}
            position="main.after"
            className="mt-8"
            locale={locale}
          />
          <HostPageSlotList
            slots={surface?.slots.filter((slot) => slot.position === 'main.after') ?? []}
            locale={locale}
            className="mt-8"
          />
          <SlotRenderer slotName={afterSlot} mode="append" className="mt-8" locale={locale} />
        </div>

        {/* 🆕 Right sidebar slot */}
        <SlotRenderer
          slotName="sidebar:right"
          mode="append"
          className="hidden lg:block lg:w-64 lg:flex-shrink-0"
          locale={locale}
        />
      </main>

      {/* 🆕 Content after slot */}
      <SlotRenderer slotName="content:after" mode="append" className="w-full" locale={locale} />

      {/* Footer */}
      {showFooter ? <FooterComponent tokens={tokens} locale={locale} /> : null}
    </div>
  );
}
