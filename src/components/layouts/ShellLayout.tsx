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

/**
 * ============================================================================
 * ShellLayout Props
 * ============================================================================
 */
export interface ShellLayoutProps {
  /** Page path (used to find page configuration) */
  pathname: string;

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
export async function ShellLayout({ pathname, children }: ShellLayoutProps): Promise<ReactElement> {
  //
  // 1. Load Design Tokens (synchronous)
  //
  const tokens = await resolvePluginThemeTokens(getThemeTokens());

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

  //
  // 4. Calculate page-level slot names
  //
  // Convert pathname to slot name: '/' -> 'site.home', '/about' -> 'site.about'
  const pageName = pathname === '/' ? 'home' : pathname.slice(1).replace(/\//g, '.');
  const slotPrefix = `site.${pageName}` as const;

  const beforeSlot = `${slotPrefix}:main.before` as SlotName;
  const afterSlot = `${slotPrefix}:main.after` as SlotName;
  const replaceSlot = `${slotPrefix}:main.replace` as SlotName;

  //
  // 5. Container styles
  //
  const containerStyle =
    pageConfig.container === 'fixed'
      ? {
          maxWidth: tokens.common.containerMaxW,
          marginLeft: 'auto',
          marginRight: 'auto',
          paddingLeft: '24px',
          paddingRight: '24px',
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
      <HeaderComponent tokens={tokens} />

      {/* 🆕 Content before slot */}
      <SlotRenderer slotName="content:before" mode="append" className="w-full" />

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
        />

        <div className="flex-1" style={containerStyle}>
          {/* Before slot: render before content (existing) */}
          <SlotRenderer slotName={beforeSlot} mode="append" className="mb-8" />
          <RouteSlotRenderer pathname={pathname} position="main.before" className="mb-8" />

          {/* Replace slot: if exists, completely replace page content (existing) */}
          <SlotRenderer
            slotName={replaceSlot}
            mode="replace"
            fallback={
              <RouteSlotRenderer
                pathname={pathname}
                position="main.replace"
                mode="replace"
                fallback={children}
              />
            }
          />

          {/* After slot: render after content (existing) */}
          <RouteSlotRenderer pathname={pathname} position="main.after" className="mt-8" />
          <SlotRenderer slotName={afterSlot} mode="append" className="mt-8" />
        </div>

        {/* 🆕 Right sidebar slot */}
        <SlotRenderer
          slotName="sidebar:right"
          mode="append"
          className="hidden lg:block lg:w-64 lg:flex-shrink-0"
        />
      </main>

      {/* 🆕 Content after slot */}
      <SlotRenderer slotName="content:after" mode="append" className="w-full" />

      {/* Footer */}
      <FooterComponent tokens={tokens} />
    </div>
  );
}
