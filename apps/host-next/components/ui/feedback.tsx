import type { ReactNode } from 'react';

export function Toast({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-md border border-border bg-card p-4 shadow-sm" role="status">
      <strong className="text-sm font-semibold text-foreground">{title}</strong>
      {children ? <p className="mt-1 text-sm text-muted-foreground">{children}</p> : null}
    </section>
  );
}
