'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Command, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Select } from '@host/components/ui';
import { cn } from '@host/components/ui/cn';
import type { SupportedLanguage } from '@host/lib/i18n';
import {
  getAdminSearchQuickCommands,
  getAdminSearchResultDetail,
  getAdminSearchResultHref,
  getAdminSearchTypeLabel,
  getAdminSearchTypeOptions,
  getAdminSearchUiCopy,
  type AdminSearchResult,
  type AdminSearchType,
} from '@host/lib/admin-search-model';

function normalizeRecent(values: readonly string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 12);
}

async function readRecentSearches() {
  try {
    const response = await fetch('/api/user/profile/preferences', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('PREFERENCES_UNAVAILABLE');
    }
    const payload = await response.json() as { data?: { preferences?: { search?: { recentSearches?: string[] } } } };
    return normalizeRecent(payload.data?.preferences?.search?.recentSearches ?? []);
  } catch {
    try {
      const parsed = JSON.parse(window.localStorage.getItem('ploykit-admin-search-recent') ?? '[]');
      return normalizeRecent(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []);
    } catch {
      return [];
    }
  }
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

export function AdminGlobalSearch({
  lang,
  searchPath,
}: {
  lang: SupportedLanguage;
  searchPath: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [type, setType] = useState<AdminSearchType>('');
  const [recent, setRecent] = useState<string[]>([]);
  const [results, setResults] = useState<AdminSearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const copy = getAdminSearchUiCopy(lang);
  const searchTypes = getAdminSearchTypeOptions(lang, { includeAll: true });
  const quickCommands = getAdminSearchQuickCommands(lang);

  const searchUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (query.trim()) {
      params.set('q', query.trim());
    }
    if (type) {
      params.set('type', type);
    }
    return `${searchPath}${params.toString() ? `?${params}` : ''}`;
  }, [query, searchPath, type]);
  const groupedResults = useMemo(() => {
    const groups = results.reduce((acc, result) => {
      const key = result.type || 'object';
      const group = acc.get(key) ?? [];
      group.push(result);
      acc.set(key, group);
      return acc;
    }, new Map<string, AdminSearchResult[]>());
    return Array.from(groups.entries());
  }, [results]);

  useEffect(() => {
    void readRecentSearches().then(setRecent);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') {
        return;
      }
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
      if (focusable.length === 0) {
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
    const focusInput = () => inputRef.current?.focus();
    window.requestAnimationFrame(focusInput);
    const focusTimer = window.setTimeout(focusInput, 80);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocused === triggerRef.current || dialogRef.current?.contains(previouslyFocused)) {
        triggerRef.current?.focus();
      }
    };
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length === 0) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      const params = new URLSearchParams({ q: query.trim(), limit: '8' });
      if (type) {
        params.set('type', type);
      }
      try {
        const response = await fetch(`/api/admin/search?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          return;
        }
        const payload = await response.json() as { data?: { items?: AdminSearchResult[] } };
        setResults(payload.data?.items ?? []);
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
        }
      }
    }, 160);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [open, query, type]);

  async function submitSearch() {
    const trimmed = query.trim();
    if (trimmed) {
      setRecent(await persistRecentSearches([trimmed, ...recent]));
    }
    setOpen(false);
    router.push(searchUrl);
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="hidden h-10 w-full max-w-sm items-center gap-2 rounded-admin-md border border-admin-border bg-admin-bg px-3 text-left text-sm text-admin-text-muted shadow-sm shadow-slate-950/5 transition hover:border-admin-primary/25 hover:bg-admin-surface-muted lg:flex xl:max-w-md 2xl:max-w-lg"
        onClick={() => setOpen(true)}
        aria-label={copy.openLabel}
      >
        <Search className="h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{copy.trigger}</span>
        <span className="inline-flex items-center gap-1 rounded border border-admin-border bg-admin-surface px-1.5 py-0.5 text-[11px] font-semibold text-admin-text-subtle">
          <Command className="h-3 w-3" aria-hidden />K
        </span>
      </button>
      <button
        type="button"
        className="inline-flex h-9 w-9 items-center justify-center rounded-admin-md text-admin-text-muted hover:bg-admin-surface-muted hover:text-admin-text lg:hidden"
        aria-label={copy.openLabel}
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" aria-hidden />
      </button>
      {open ? (
        <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true" aria-label={copy.title}>
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-slate-950/20 backdrop-blur-sm dark:bg-slate-950/65"
            aria-label={copy.closeLabel}
            onClick={() => setOpen(false)}
          />
          <div
            ref={dialogRef}
            className="absolute left-1/2 top-4 grid max-h-[calc(100vh-2rem)] w-[calc(100vw-1.5rem)] max-w-3xl -translate-x-1/2 overflow-hidden rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-popover sm:top-10"
          >
            <div className="flex items-center justify-between gap-3 border-b border-admin-border px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-admin-text">{copy.title}</h2>
                <p className="mt-0.5 text-xs text-admin-text-muted">{copy.description}</p>
              </div>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-admin-md text-admin-text-muted hover:bg-admin-surface-muted hover:text-admin-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary"
                aria-label={copy.closeLabel}
                onClick={() => setOpen(false)}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <form
              className="grid gap-3 border-b border-admin-border p-4 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                void submitSearch();
              }}
            >
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-admin-text-muted" aria-hidden />
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="pl-9"
                  placeholder={copy.placeholder}
                  aria-label={copy.queryLabel}
                />
              </label>
              <Select value={type} onChange={(event) => setType(event.target.value as AdminSearchType)} aria-label={copy.typeLabel}>
                {searchTypes.map((item) => (
                  <option key={item.value || 'all'} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
              <Button type="submit">{copy.submit}</Button>
            </form>
            <div className="min-h-0 overflow-y-auto p-4">
              {recent.length > 0 ? (
                <div className="mb-4 grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-semibold uppercase text-admin-text-subtle">{copy.recent}</span>
                    <button
                      type="button"
                      className="text-xs font-semibold text-admin-text-muted transition hover:text-admin-primary"
                      onClick={() => {
                        void persistRecentSearches([]).then(setRecent);
                      }}
                    >
                      {copy.clear}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {recent.slice(0, 8).map((item) => (
                      <button
                        key={item}
                        type="button"
                        className="rounded-full border border-admin-border bg-admin-bg px-3 py-1.5 text-xs font-semibold text-admin-text-muted transition hover:border-admin-primary/25 hover:bg-admin-primary-soft hover:text-admin-primary"
                        onClick={() => setQuery(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="grid gap-2">
                <span className="text-[11px] font-semibold uppercase text-admin-text-subtle">
                  {query.trim() ? copy.matches : copy.quick}
                </span>
                {query.trim() ? (
                  <div className="divide-y divide-admin-border rounded-admin-md border border-admin-border bg-admin-bg/40">
                    {groupedResults.length > 0 ? (
                      groupedResults.map(([groupType, groupItems]) => (
                        <section key={groupType}>
                          <div className="flex items-center justify-between gap-3 bg-admin-surface-muted px-3 py-2">
                            <span className="text-[11px] font-semibold uppercase text-admin-text-subtle">
                              {getAdminSearchTypeLabel(lang, groupType)}
                            </span>
                            <span className="text-[11px] font-semibold text-admin-text-muted">{groupItems.length}</span>
                          </div>
                          {groupItems.map((result) => {
                            const typeLabel = getAdminSearchTypeLabel(lang, result.type);
                            return (
                              <Link
                                key={`${result.type}:${result.id}`}
                                href={getAdminSearchResultHref(lang, result)}
                                className="flex items-center justify-between gap-3 px-3 py-2.5 transition hover:bg-admin-surface-muted"
                                onClick={() => {
                                  void persistRecentSearches([query.trim(), ...recent]).then(setRecent);
                                  setOpen(false);
                                }}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold text-admin-text">{result.label}</span>
                                  <span className="mt-0.5 block truncate text-xs text-admin-text-muted">
                                    {getAdminSearchResultDetail(lang, result)}
                                  </span>
                                  <span className="mt-0.5 block truncate font-mono text-[11px] text-admin-text-muted">{typeLabel}:{result.id}</span>
                                </span>
                                <span className="rounded-full border border-admin-border bg-admin-surface px-2 py-0.5 text-[11px] font-semibold uppercase text-admin-text-subtle">
                                  {typeLabel}
                                </span>
                              </Link>
                            );
                          })}
                        </section>
                      ))
                    ) : (
                      <div className="px-3 py-6 text-sm text-admin-text-muted">
                        {copy.noMatch(type)}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {quickCommands.map((command) => (
                      <Link
                        key={command.href}
                        href={command.href}
                        className={cn(
                          'rounded-admin-md border border-admin-border bg-admin-bg/45 px-3 py-3 transition',
                          'hover:border-admin-primary/25 hover:bg-admin-primary-soft'
                        )}
                        onClick={() => setOpen(false)}
                      >
                        <span className="block text-sm font-semibold text-admin-text">{command.label}</span>
                        <span className="mt-1 block text-xs text-admin-text-muted">{command.detail}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
