import type { ComponentProps } from 'react';
import { cn } from './cn';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      {...props}
      className={cn(
        'rounded-admin-md border border-admin-border bg-admin-surface p-5 text-admin-text shadow-admin-card',
        className
      )}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentProps<'header'>) {
  return <header {...props} className={cn('mb-4 flex flex-col gap-1', className)} />;
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 {...props} className={cn('text-base font-semibold leading-6 text-admin-text', className)} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p {...props} className={cn('text-sm leading-6 text-admin-text-muted', className)} />;
}
