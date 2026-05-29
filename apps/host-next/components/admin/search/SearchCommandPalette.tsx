'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@host/components/ui';
import type { SupportedLanguage } from '@host/lib/i18n';
import { getAdminSearchUiCopy } from '@host/lib/admin-search-model';

function normalizeRecent(values: readonly string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 12);
}

async function persistRecentSearches(values: readonly string[]) {
  const next = normalizeRecent(values);
  try {
    await fetch('/api/user/profile/preferences', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ searchRecent: next }),
    });
  } catch {
    window.localStorage.setItem('ploykit-admin-search-recent', JSON.stringify(next));
  }
  window.localStorage.setItem('ploykit-admin-search-recent', JSON.stringify(next));
  return next;
}

export function SearchCommandPalette({
  lang,
  basePath,
  currentQuery,
  quickSearches,
  commands,
  placeholder,
  submitLabel,
  ariaLabel,
}: {
  lang: SupportedLanguage;
  basePath: string;
  currentQuery: string;
  quickSearches: readonly string[];
  commands: readonly { label: string; href: string; detail: string }[];
  placeholder?: string;
  submitLabel?: string;
  ariaLabel?: string;
}) {
  const copy = getAdminSearchUiCopy(lang);
  const resolvedPlaceholder = placeholder ?? copy.placeholder;
  const resolvedSubmitLabel = submitLabel ?? copy.submit;
  const resolvedAriaLabel = ariaLabel ?? copy.queryLabel;
  const [recent, setRecent] = useState<string[]>([]);
  const visibleRecent = useMemo(
    () => normalizeRecent([currentQuery, ...recent, ...quickSearches]).slice(0, 10),
    [currentQuery, quickSearches, recent]
  );

  useEffect(() => {
    let active = true;
    async function loadPreferences() {
      try {
        const response = await fetch('/api/user/profile/preferences', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('PREFERENCES_UNAVAILABLE');
        }
        const payload = await response.json() as { data?: { preferences?: { search?: { recentSearches?: string[] } } } };
        const serverRecent = payload.data?.preferences?.search?.recentSearches ?? [];
        const next = normalizeRecent([currentQuery, ...serverRecent]);
        if (active) {
          setRecent(next);
        }
        if (currentQuery) {
          await persistRecentSearches(next);
        }
      } catch {
        const localValue = (() => {
          try {
            const parsed = JSON.parse(window.localStorage.getItem('ploykit-admin-search-recent') ?? '[]');
            return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
          } catch {
            return [];
          }
        })();
        const stored = normalizeRecent(localValue);
        const next = normalizeRecent([currentQuery, ...stored]);
        window.localStorage.setItem('ploykit-admin-search-recent', JSON.stringify(next));
        if (active) {
          setRecent(next);
        }
      }
    }
    void loadPreferences();
    return () => {
      active = false;
    };
  }, [currentQuery]);

  return (
    <section className="overflow-hidden rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-card">
      <div className="flex flex-col gap-3 border-b border-admin-border px-4 py-3.5 sm:px-5 sm:py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold leading-6 text-admin-text">{copy.paletteTitle}</h2>
          <p className="mt-1 text-sm leading-6 text-admin-text-muted">
            {copy.paletteDescription}
          </p>
        </div>
        <span className="inline-flex w-fit items-center gap-1 rounded-admin-md border border-admin-border bg-admin-bg px-2.5 py-1 text-xs font-semibold text-admin-text-muted">
          <kbd className="font-mono">Ctrl</kbd>
          <span>+</span>
          <kbd className="font-mono">K</kbd>
        </span>
      </div>
      <div className="grid gap-4 p-4 sm:p-5">
        <form method="get" action={basePath} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-text-muted" aria-hidden />
            <Input
              name="q"
              defaultValue={currentQuery}
              className="pl-9"
              placeholder={resolvedPlaceholder}
              aria-label={resolvedAriaLabel}
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-9 items-center justify-center rounded-admin-md bg-admin-primary px-3 py-1.5 text-xs font-semibold text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
          >
            {resolvedSubmitLabel}
          </button>
        </form>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase text-admin-text-subtle">{copy.recentQuick}</span>
            {recent.length > 0 ? (
              <button
                type="button"
                className="text-xs font-semibold text-admin-text-muted transition hover:text-admin-primary"
                onClick={() => {
                  void persistRecentSearches([]).then(setRecent);
                }}
              >
                {copy.clear}
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {visibleRecent.map((item) => (
              <Link
                key={item}
                href={`${basePath}?q=${encodeURIComponent(item)}`}
                className="rounded-full border border-admin-border bg-admin-bg px-3 py-1.5 text-xs font-semibold text-admin-text-muted transition hover:border-admin-primary/30 hover:bg-admin-primary-soft hover:text-admin-primary"
              >
                {item === currentQuery ? `${copy.currentPrefix}: ${item}` : item}
              </Link>
            ))}
          </div>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {commands.map((command) => (
            <Link
              key={command.href}
              href={command.href}
              className="rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-3 transition hover:border-admin-primary/25 hover:bg-admin-primary-soft"
            >
              <span className="block text-sm font-semibold text-admin-text">{command.label}</span>
              <span className="mt-1 block text-xs text-admin-text-muted">{command.detail}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
