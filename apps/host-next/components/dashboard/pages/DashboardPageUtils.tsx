import type { ReactNode } from 'react';
import { dashboardInlineText } from '@host/lib/dashboard-copy';
import type { SupportedLanguage } from '@host/lib/i18n';
import { friendlyStatusLabel, friendlyStatusTone, type UserTone } from './DashboardPageFormatting';

export * from './DashboardPageFormatting';

export const dashboardPrimaryButtonClass =
  'inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-admin-md bg-admin-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-blue-950/10 transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50';
export const dashboardGhostButtonClass =
  'inline-flex min-h-8 items-center justify-center whitespace-nowrap rounded-admin-md px-3 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary disabled:pointer-events-none disabled:opacity-50';

export const userToneClass: Record<UserTone, string> = {
  neutral: 'border-admin-border bg-admin-surface-muted text-admin-text-muted',
  primary: 'border-admin-primary/20 bg-admin-primary/10 text-admin-primary',
  success: 'border-admin-success/25 bg-admin-success/10 text-admin-success',
  warning: 'border-admin-warning/25 bg-admin-warning/10 text-admin-warning',
  danger: 'border-admin-danger/25 bg-admin-danger/10 text-admin-danger',
};

export function FriendlyStatusBadge({
  lang,
  value,
  tone,
}: {
  lang: SupportedLanguage;
  value: string | null | undefined;
  tone?: UserTone;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${userToneClass[tone ?? friendlyStatusTone(value)]}`}
    >
      {friendlyStatusLabel(lang, value)}
    </span>
  );
}

export function ProgressBar({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2 overflow-hidden rounded-full bg-admin-surface-muted">
      <span
        className="block h-full rounded-full bg-admin-primary"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  );
}

export function UserEmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-admin-md border border-dashed border-admin-border bg-admin-surface p-6 text-center shadow-admin-card">
      <h2 className="text-base font-semibold text-admin-text">{title}</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-admin-text-muted">{body}</p>
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function UserRecordCard({
  lang,
  title,
  description,
  meta,
  status,
  statusTone,
  details = [],
  actions,
}: {
  lang: SupportedLanguage;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  status?: string;
  statusTone?: UserTone;
  details?: Array<{ label: string; value: ReactNode }>;
  actions?: ReactNode;
}) {
  return (
    <article className="rounded-admin-md border border-admin-border bg-admin-surface p-4 shadow-admin-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-base font-semibold text-admin-text">{title}</h3>
            {status ? <FriendlyStatusBadge lang={lang} value={status} tone={statusTone} /> : null}
          </div>
          {description ? (
            <div className="mt-1 text-sm leading-6 text-admin-text-muted">{description}</div>
          ) : null}
          {meta ? (
            <div className="mt-2 text-xs font-medium text-admin-text-subtle">{meta}</div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {details.length > 0 ? (
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {details.map((item) => (
            <div key={item.label} className="rounded-admin-sm bg-admin-surface-muted p-3">
              <dt className="text-xs font-semibold text-admin-text-subtle">{item.label}</dt>
              <dd className="mt-1 text-sm font-semibold text-admin-text">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

export function UserHashPanel({
  lang,
  id,
  triggerLabel,
  title,
  description,
  children,
  variant = 'primary',
}: {
  lang: SupportedLanguage;
  id: string;
  triggerLabel: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  return (
    <>
      <a
        href={`#${id}`}
        className={`${variant === 'primary' ? dashboardPrimaryButtonClass : dashboardGhostButtonClass} cursor-pointer`}
      >
        {triggerLabel}
      </a>
      <div
        id={id}
        role="dialog"
        aria-modal="true"
        className="pointer-events-none fixed inset-0 z-50 opacity-0 transition target:pointer-events-auto target:opacity-100"
      >
        <a
          href="#"
          aria-label={dashboardInlineText(lang, 'close_panel_89b65434')}
          className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
        />
        <aside className="absolute right-0 top-0 flex h-dvh w-full max-w-xl flex-col overflow-hidden border-l border-admin-border bg-admin-surface text-admin-text shadow-admin-popover">
          <header className="flex items-start justify-between gap-3 border-b border-admin-border px-5 py-4">
            <div className="min-w-0">
              <h2 className="text-base font-semibold leading-6">{title}</h2>
              {description ? (
                <div className="mt-1 text-sm leading-6 text-admin-text-muted">{description}</div>
              ) : null}
            </div>
            <a href="#" className={dashboardGhostButtonClass}>
              {dashboardInlineText(lang, 'close_fbd8cee0')}
            </a>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </aside>
      </div>
    </>
  );
}

export function UserSectionNav({ items }: { items: Array<{ href: string; label: ReactNode }> }) {
  return (
    <nav className="flex flex-wrap gap-2 rounded-admin-md border border-admin-border bg-admin-surface p-2 shadow-admin-card">
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className="inline-flex min-h-9 items-center rounded-admin-md px-3 py-2 text-sm font-semibold text-admin-text-muted transition hover:bg-admin-surface-muted hover:text-admin-text"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
