import type { ReactNode } from 'react';
import { SiteShell } from '@host/components/ProductShell';
import type { SupportedLanguage } from '@host/lib/i18n';

export function InfoPage({
  lang,
  title,
  subtitle,
  children,
}: {
  lang: SupportedLanguage;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <SiteShell lang={lang}>
      <main className="overflow-hidden">
        <section className="relative border-b border-admin-border bg-[radial-gradient(circle_at_16%_16%,rgba(37,99,235,0.14),transparent_28%),radial-gradient(circle_at_82%_12%,rgba(56,189,248,0.14),transparent_24%),linear-gradient(180deg,var(--admin-surface),var(--admin-bg))]">
          <div
            className="pointer-events-none absolute left-[-8rem] top-24 hidden h-72 w-72 rotate-45 border border-admin-primary/15 lg:block"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute right-10 top-24 hidden grid-cols-8 gap-3 opacity-30 lg:grid"
            aria-hidden
          >
            {Array.from({ length: 48 }).map((_, index) => (
              <span key={index} className="h-1 w-1 rounded-full bg-admin-primary" />
            ))}
          </div>
          <div className="mx-auto w-full max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-16">
            <div className="max-w-3xl">
              <h1 className="max-w-4xl text-[2.5rem] font-semibold leading-[1.08] tracking-normal text-admin-text sm:text-5xl sm:leading-[1.05] lg:text-6xl">
                {title}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-admin-text-muted sm:text-lg">
                {subtitle}
              </p>
            </div>
          </div>
        </section>
        <section className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="space-y-6 text-sm leading-7 text-admin-text">{children}</div>
        </section>
      </main>
    </SiteShell>
  );
}
