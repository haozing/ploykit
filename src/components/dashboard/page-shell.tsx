import type { ReactNode } from 'react';
import { cn } from '@/lib/_core/utils';

interface DashboardPageShellProps {
  children: ReactNode;
  className?: string;
  wide?: boolean;
}

interface DashboardPageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function DashboardPageShell({ children, className, wide = false }: DashboardPageShellProps) {
  return (
    <div className={cn('mx-auto w-full space-y-6', wide ? 'max-w-none' : 'max-w-7xl', className)}>
      {children}
    </div>
  );
}

export function DashboardPageHeader({
  title,
  description,
  actions,
  className,
}: DashboardPageHeaderProps) {
  return (
    <div
      className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
