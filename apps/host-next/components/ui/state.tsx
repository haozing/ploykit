import type { ReactNode } from 'react';
import { cn } from './cn';
import { ButtonLink } from './button';

export function EmptyState({
  title,
  actionHref,
  actionLabel,
  children,
}: {
  title: string;
  actionHref?: string;
  actionLabel?: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-admin-md border border-dashed border-admin-border bg-admin-surface p-7 text-center">
      <div className="mx-auto mb-4 h-10 w-10 rounded-full border border-admin-border bg-admin-surface-muted" aria-hidden />
      <strong className="text-sm font-semibold text-admin-text">{title}</strong>
      {children ? <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-admin-text-muted">{children}</p> : null}
      {actionHref && actionLabel ? (
        <div className="mt-4">
          <ButtonLink href={actionHref} variant="secondary" size="small">
            {actionLabel}
          </ButtonLink>
        </div>
      ) : null}
    </section>
  );
}

export function ErrorState({
  title,
  actionHref,
  actionLabel,
  children,
}: {
  title: string;
  actionHref?: string;
  actionLabel?: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 p-7 text-center">
      <strong className="text-sm font-semibold text-admin-danger">{title}</strong>
      {children ? <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-admin-text">{children}</p> : null}
      {actionHref && actionLabel ? (
        <div className="mt-4">
          <ButtonLink href={actionHref} variant="secondary" size="small">
            {actionLabel}
          </ButtonLink>
        </div>
      ) : null}
    </section>
  );
}

export function PageHeader({
  eyebrow = 'PloyKit',
  title,
  subtitle,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <span className="text-xs font-semibold uppercase tracking-normal text-admin-text-subtle">
        {eyebrow}
      </span>
      <h1 className="text-[28px] font-bold leading-9 tracking-normal text-admin-text">{title}</h1>
      {subtitle ? <p className="max-w-3xl text-sm leading-6 text-admin-text-muted">{subtitle}</p> : null}
    </div>
  );
}

export function Skeleton({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn('block h-4 min-w-20 animate-pulse rounded-admin-sm bg-admin-surface-muted', className)}
      aria-label={label}
    />
  );
}
