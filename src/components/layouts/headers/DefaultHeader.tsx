/**
 * ===========================================================================
 * Default Header Component
 * ===========================================================================
 *
 * Framework's built-in default header layout
 *
 * Features:
 * - Responsive to Design Tokens (height, colors, borders, etc.)
 * - Support plugin extensions (Logo, Nav, Extra)
 * - Contains protected business components (UserMenu)
 * - Support variant (solid/transparent)
 *
 * Slots:
 * - header:logo (replace) - Logo area
 * - header:nav (replace) - Navigation area
 * - header:extra (append) - Extra area (multiple plugins can share)
 */

import { SlotRenderer } from '@/components/SlotRenderer';
import type { LayoutComponentProps } from '@/lib/ui/layout/layout-resolver';
import Link from 'next/link';
import Image from 'next/image';
import { ClientNav } from './ClientNav';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { UserMenuClient } from './UserMenuClient';
import { getSiteHeaderNavItems } from '@/lib/ui/navigation';

/**
 * ===========================================================================
 * Default Logo Component (Fallback)
 * ===========================================================================
 */
function DefaultLogo() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 font-semibold text-xl"
      style={{
        color: 'var(--header-text)',
      }}
    >
      <Image
        src="/brand/ploykit-logo.svg"
        alt="PloyKit"
        width={210}
        height={48}
        priority
        className="h-9 w-auto"
      />
    </Link>
  );
}

/**
 * ===========================================================================
 * Default Navigation Component (Fallback)
 * ===========================================================================
 *
 * Note: Navigation functionality has been moved to ClientNav component
 * This function has been replaced by ClientNav, kept as a note
 */

/**
 * ===========================================================================
 * Protected Component: User menu
 * ===========================================================================
 *
 * This is a business logic component that cannot be replaced by plugins
 * Plugins can only affect its styles through tokens
 *
 * Note: Moved to UserMenuClient.tsx to support client-side routing
 */

/**
 * ===========================================================================
 * DefaultHeader Component
 * ===========================================================================
 */
export default async function DefaultHeader({ tokens }: LayoutComponentProps) {
  const variant = tokens.header.variant || 'solid';

  // Load navigation data (system + plugins)
  const navItems = await getSiteHeaderNavItems();

  return (
    <>
      {/* 🆕 Header before slot */}
      <SlotRenderer slotName="header:before" mode="append" />

      <header
        className="w-full"
        style={{
          height: tokens.header.height,
          backgroundColor: variant === 'transparent' ? 'transparent' : tokens.header.bg,
          borderBottom: tokens.header.borderBottom,
          position: tokens.header.sticky ? 'sticky' : 'relative',
          top: tokens.header.sticky ? 0 : undefined,
          zIndex: tokens.header.sticky ? 50 : undefined,
        }}
      >
        <div
          className="h-full mx-auto flex items-center justify-between"
          style={{
            maxWidth: tokens.common.containerMaxW,
            paddingLeft: tokens.header.paddingX,
            paddingRight: tokens.header.paddingX,
            paddingTop: tokens.header.paddingY,
            paddingBottom: tokens.header.paddingY,
          }}
        >
          {/* Left side: Logo area */}
          <div className="flex items-center gap-2">
            {/* 🆕 Logo before slot */}
            <SlotRenderer slotName="header:logo-before" mode="append" />

            {/* Logo slot (existing) */}
            <SlotRenderer slotName="header:logo" mode="replace" fallback={<DefaultLogo />} />

            {/* 🆕 Logo after slot */}
            <SlotRenderer slotName="header:logo-after" mode="append" />
          </div>

          {/* Center: Navigation area */}
          <div className="flex-1 flex justify-center items-center">
            {/* 🆕 Nav before slot */}
            <SlotRenderer slotName="header:nav-before" mode="append" />

            {/* Nav slot (existing) */}
            <SlotRenderer
              slotName="header:nav"
              mode="replace"
              fallback={<ClientNav navItems={navItems} />}
            />

            {/* 🆕 Nav after slot */}
            <SlotRenderer slotName="header:nav-after" mode="append" />
          </div>

          {/* Right side: Action area */}
          <div className="flex items-center gap-4">
            {/* 🆕 Actions before slot */}
            <SlotRenderer
              slotName="header:actions-before"
              mode="append"
              className="flex items-center gap-2"
            />

            {/* Extra slot (existing) */}
            <SlotRenderer
              slotName="header:extra"
              mode="append"
              className="flex items-center gap-2"
            />

            {/* Language switcher */}
            <LanguageSwitcher />

            {/* Protected user menu */}
            <UserMenuClient />

            {/* 🆕 Actions after slot */}
            <SlotRenderer
              slotName="header:actions-after"
              mode="append"
              className="flex items-center gap-2"
            />
          </div>
        </div>
      </header>

      {/* 🆕 Header after slot */}
      <SlotRenderer slotName="header:after" mode="append" />
    </>
  );
}
