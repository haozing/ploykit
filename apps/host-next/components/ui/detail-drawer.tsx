import type { ReactNode } from 'react';
import { cn } from './cn';

export function DetailDrawer({
  title,
  description,
  open,
  children,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  open?: boolean;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <aside
      aria-hidden={!open}
      className={cn(
        'max-w-full overflow-hidden rounded-admin-md border border-admin-border bg-admin-surface text-admin-text shadow-admin-popover',
        open ? 'block' : 'hidden',
        className
      )}
    >
      <header className="flex flex-col gap-3 border-b border-admin-border px-4 py-3.5 sm:flex-row sm:items-start sm:justify-between sm:px-5 sm:py-4">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold leading-6">{title}</h2>
          {description ? <p className="mt-1 break-all text-sm leading-6 text-admin-text-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div> : null}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </aside>
  );
}
