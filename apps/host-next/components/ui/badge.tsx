import type { ComponentProps } from 'react';
import { cn } from './cn';

type BadgeTone = 'default' | 'neutral' | 'success' | 'warning' | 'danger' | 'ok' | 'warn' | 'bad';

const toneClass: Record<BadgeTone, string> = {
  default: 'border-admin-border bg-admin-surface-muted text-admin-text-muted',
  neutral: 'border-admin-border bg-admin-surface-muted text-admin-text-muted',
  success: 'border-admin-success/25 bg-admin-success/10 text-admin-success',
  warning: 'border-admin-warning/25 bg-admin-warning/10 text-admin-warning',
  danger: 'border-admin-danger/25 bg-admin-danger/10 text-admin-danger',
  ok: 'border-admin-success/25 bg-admin-success/10 text-admin-success',
  warn: 'border-admin-warning/25 bg-admin-warning/10 text-admin-warning',
  bad: 'border-admin-danger/25 bg-admin-danger/10 text-admin-danger',
};

export function Badge({
  tone = 'default',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      {...props}
      className={cn(
        'inline-flex h-6 max-w-full items-center rounded-full border px-2.5 text-xs font-semibold leading-none',
        toneClass[tone],
        className
      )}
    />
  );
}
