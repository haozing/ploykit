import type { ReactNode } from 'react';
import { cn } from '@host/components/ui/cn';

export function PageShell({
  eyebrow,
  title,
  description,
  actions,
  wide = false,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <main className={cn('mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-10', wide ? 'max-w-[1480px]' : 'max-w-5xl')}>
      <header className="mb-6 flex flex-col gap-4 sm:mb-7 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-normal text-admin-text-subtle">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="text-[28px] font-bold leading-9 tracking-normal text-admin-text">{title}</h1>
          {description ? (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-admin-text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      <div className="space-y-6">{children}</div>
    </main>
  );
}
