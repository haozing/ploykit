'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@host/components/ui/cn';
import type { SupportedLanguage } from '@host/lib/i18n';
import type { AppFrameLabels } from './AppFrame';
import { isActiveNavHref, resolveActiveNavItem, resolveNavHref } from './nav-active';
import type { NavGroup } from './types';

export function MobileNav({
  area,
  lang,
  groups,
  activePath,
  labels,
}: {
  area: 'admin' | 'dashboard';
  lang: SupportedLanguage;
  groups: readonly NavGroup[];
  activePath?: string;
  labels: AppFrameLabels;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const currentPath = activePath ?? pathname;
  const activeNavItem = resolveActiveNavItem(lang, groups, currentPath);
  const activeGroup = activeNavItem?.group ?? groups[0];
  const activeItem = activeNavItem?.item ?? groups[0]?.items[0];

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => !element.hasAttribute('aria-hidden'));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    window.requestAnimationFrame(() => {
      closeRef.current?.focus();
    });
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      if (
        previouslyFocused === triggerRef.current ||
        drawerRef.current?.contains(previouslyFocused)
      ) {
        triggerRef.current?.focus();
      }
    };
  }, [open]);

  const drawer = open ? (
    <div
      className="fixed inset-0 z-[100] lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label={labels.navigation}
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-admin-bg/80 backdrop-blur-sm dark:bg-slate-950/70"
        aria-label={labels.closeNavigation}
        onClick={() => setOpen(false)}
      />
      <nav
        id="mobile-admin-navigation"
        ref={drawerRef}
        data-host-mobile-nav-drawer={area}
        className="absolute left-0 top-0 flex h-full w-[min(86vw,320px)] flex-col border-r border-admin-border bg-admin-surface shadow-admin-popover"
        aria-label={labels.mobileNavigation}
      >
        <div className="flex h-16 items-center justify-between border-b border-admin-border px-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-admin-text">{labels.brandName}</p>
            <p className="text-xs text-admin-text-muted">{labels.consoleLabel}</p>
          </div>
          <button
            type="button"
            ref={closeRef}
            className="grid h-9 w-9 place-items-center rounded-admin-md text-admin-text-muted transition hover:bg-admin-surface-muted hover:text-admin-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
            aria-label={labels.closeNavigation}
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <section key={group.id} className="space-y-2">
              <h2 className="px-3 text-[11px] font-semibold text-admin-text-subtle">
                {group.label}
              </h2>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const href = resolveNavHref(lang, item);
                  const itemActive = isActiveNavHref(activeNavItem, href);
                  return (
                    <Link
                      key={`${group.id}:${item.href}`}
                      href={href}
                      prefetch={false}
                      className={cn(
                        'flex min-h-10 items-center justify-between gap-3 rounded-admin-md px-3 py-2 text-sm font-semibold text-admin-text-muted transition',
                        'hover:bg-admin-surface-muted hover:text-admin-text',
                        itemActive &&
                          'bg-admin-primary-soft text-admin-primary ring-1 ring-admin-primary/10'
                      )}
                      aria-current={itemActive ? 'page' : undefined}
                      onClick={() => setOpen(false)}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{item.label}</span>
                        {item.detail ? (
                          <span className="mt-0.5 block truncate text-xs font-normal text-admin-text-muted">
                            {item.detail}
                          </span>
                        ) : null}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </nav>
    </div>
  ) : null;

  return (
    <div
      className="border-b border-admin-border bg-admin-surface/95 px-4 py-3 backdrop-blur lg:hidden"
      data-host-mobile-nav={area}
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          ref={triggerRef}
          className="inline-flex h-9 items-center gap-2 rounded-admin-md border border-admin-border bg-admin-surface px-3 text-sm font-semibold text-admin-text shadow-sm shadow-slate-950/5 transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
          aria-expanded={open}
          aria-controls="mobile-admin-navigation"
          onClick={() => setOpen(true)}
        >
          <Menu className="h-4 w-4" aria-hidden />
          {labels.menu}
        </button>
        <div className="min-w-0 text-right">
          <p className="truncate text-[11px] font-semibold text-admin-text-subtle">
            {activeGroup?.label ?? labels.navigation}
          </p>
          <p className="truncate text-sm font-semibold text-admin-text">
            {activeItem?.label ?? labels.overview}
          </p>
        </div>
      </div>

      {mounted ? createPortal(drawer, document.body) : null}
    </div>
  );
}
