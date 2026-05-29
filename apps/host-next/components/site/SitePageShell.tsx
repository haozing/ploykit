import type { ReactNode } from 'react';
import { cn } from '@host/components/ui/cn';

export function SitePageShell({
  title,
  description,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className={cn('mx-auto w-full px-4 py-10 sm:px-6 lg:px-8', wide ? 'max-w-7xl' : 'max-w-4xl')}>
      <header className="mb-8">
        <h1 className="text-4xl font-semibold tracking-normal text-foreground sm:text-5xl">{title}</h1>
        {description ? (
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{description}</p>
        ) : null}
      </header>
      {children}
    </main>
  );
}
