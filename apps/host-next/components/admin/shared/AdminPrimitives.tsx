import Link from 'next/link';
import { Fragment, type ComponentType, type ReactNode } from 'react';
import { ChevronRight, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { Button, ButtonLink, Input, Select } from '@host/components/ui';
import { CopyButton } from '@host/components/ui/CopyButton';
import { cn } from '@host/components/ui/cn';
import { adminInlineText } from '@host/lib/admin-inline-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import { StatusBadge, type StatusTone } from './StatusBadge';

export type AdminTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'primary';

const toneBorderClass: Record<AdminTone, string> = {
  neutral: 'border-admin-border',
  info: 'border-admin-info/25',
  success: 'border-admin-success/25',
  warning: 'border-admin-warning/25',
  danger: 'border-admin-danger/25',
  primary: 'border-admin-primary/25',
};

const toneIconClass: Record<AdminTone, string> = {
  neutral: 'bg-admin-surface-muted text-admin-text-muted ring-admin-border',
  info: 'bg-admin-info/10 text-admin-info ring-admin-info/15',
  success: 'bg-admin-success/10 text-admin-success ring-admin-success/15',
  warning: 'bg-admin-warning/10 text-admin-warning ring-admin-warning/15',
  danger: 'bg-admin-danger/10 text-admin-danger ring-admin-danger/15',
  primary: 'bg-admin-primary-soft text-admin-primary ring-admin-primary/15',
};

const toneSurfaceClass: Record<AdminTone, string> = {
  neutral: 'border-admin-border bg-admin-bg/45',
  info: 'border-admin-info/25 bg-admin-info/10',
  success: 'border-admin-success/25 bg-admin-success/10',
  warning: 'border-admin-warning/25 bg-admin-warning/10',
  danger: 'border-admin-danger/25 bg-admin-danger/10',
  primary: 'border-admin-primary/25 bg-admin-primary-soft',
};

const chartToneClass: Record<AdminTone, string> = {
  neutral: 'text-admin-text-subtle',
  info: 'text-admin-info',
  success: 'text-admin-success',
  warning: 'text-admin-warning',
  danger: 'text-admin-danger',
  primary: 'text-admin-primary',
};

function adminMaybeInlineText(lang: SupportedLanguage, text: string): string {
  if (/^[A-Za-z]:[\\/]/.test(text) || /[\\/]/.test(text) || /^https?:\/\//i.test(text)) {
    return text;
  }
  return adminInlineText(lang, text);
}

export function AdminPanel({
  id,
  title,
  description,
  action,
  children,
  className,
  contentClassName,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section id={id} className={cn('min-w-0 overflow-hidden rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-card', className)}>
      <AdminPanelHeader title={title} description={description} action={action} />
      <div className={cn('p-4 sm:p-5', contentClassName)}>{children}</div>
    </section>
  );
}

export function AdminPanelHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-admin-border px-4 py-3.5 sm:px-5 sm:py-4', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold leading-6 text-admin-text">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-admin-text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export interface FactListItem {
  key?: string;
  label: ReactNode;
  value: ReactNode;
  helper?: ReactNode;
  copyValue?: string;
  mono?: boolean;
  tone?: AdminTone;
}

export function FactList({
  items,
  className,
  density = 'regular',
  lang = 'zh',
}: {
  items: readonly FactListItem[];
  className?: string;
  density?: 'regular' | 'compact';
  lang?: SupportedLanguage;
}) {
  const compact = density === 'compact';
  return (
    <div className={cn('grid gap-2', className)}>
      {items.map((item, index) => (
        <div
          key={item.key ?? String(index)}
          className={cn(
            'rounded-admin-md border bg-admin-bg/45',
            toneBorderClass[item.tone ?? 'neutral'],
            compact ? 'px-3 py-2' : 'px-3 py-2.5'
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="block text-[11px] font-semibold uppercase text-admin-text-subtle">
                {typeof item.label === 'string' ? adminInlineText(lang, item.label) : item.label}
              </span>
              <span
                className={cn(
                  'mt-1 block min-w-0 text-sm leading-5 text-admin-text',
                  item.mono ? 'break-all font-mono text-xs' : 'break-words'
                )}
              >
                {item.value}
              </span>
              {item.helper ? <span className="mt-1 block text-xs leading-5 text-admin-text-muted">{item.helper}</span> : null}
            </div>
            {item.copyValue ? (
              <div className="shrink-0">
                <CopyButton
                  value={item.copyValue}
                  label={adminInlineText(lang, 'Copy')}
                  copiedLabel={adminInlineText(lang, 'Copied')}
                />
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface TimelineItem {
  key: string;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  status?: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  tone?: AdminTone;
}

export function TimelineList({
  lang,
  items,
  empty,
  className,
}: {
  lang?: SupportedLanguage;
  items: readonly TimelineItem[];
  empty?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-admin-md border border-admin-border bg-admin-bg/40', className)}>
      {items.length > 0 ? (
        <ol className="divide-y divide-admin-border">
          {items.map((item) => (
            <li key={item.key} className="grid grid-cols-[auto,minmax(0,1fr)] gap-3 px-4 py-3">
              <span
                className={cn(
                  'mt-1 h-2.5 w-2.5 rounded-full ring-4',
                  chartToneClass[item.tone ?? 'primary'],
                  toneIconClass[item.tone ?? 'primary'].split(' ')[0],
                  'ring-admin-surface'
                )}
                aria-hidden
              />
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-admin-text">{item.title}</span>
                  {item.status ? <StatusBadge lang={lang} value={item.status} label={item.statusLabel} tone={item.statusTone} /> : null}
                  {item.meta ? <span className="text-xs text-admin-text-muted">{item.meta}</span> : null}
                </div>
                {item.description ? <p className="mt-1 text-sm leading-6 text-admin-text-muted">{item.description}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="px-4 py-6 text-sm text-admin-text-muted">{empty ?? 'No events recorded.'}</div>
      )}
    </div>
  );
}

export interface GroupedTimelineItem extends TimelineItem {
  group: string;
}

export function GroupedTimelineList({
  lang,
  items,
  empty,
  className,
}: {
  lang?: SupportedLanguage;
  items: readonly GroupedTimelineItem[];
  empty?: ReactNode;
  className?: string;
}) {
  const groups = items.reduce<Array<{ group: string; items: TimelineItem[] }>>((acc, item) => {
    const existing = acc.find((group) => group.group === item.group);
    const timelineItem: TimelineItem = {
      key: item.key,
      title: item.title,
      description: item.description,
      meta: item.meta,
      status: item.status,
      statusLabel: item.statusLabel,
      statusTone: item.statusTone,
      tone: item.tone,
    };
    if (existing) {
      existing.items.push(timelineItem);
    } else {
      acc.push({ group: item.group, items: [timelineItem] });
    }
    return acc;
  }, []);

  if (items.length === 0) {
    return (
      <div className={cn('rounded-admin-md border border-admin-border bg-admin-bg/40 px-4 py-6 text-sm text-admin-text-muted', className)}>
        {empty ?? 'No events recorded.'}
      </div>
    );
  }

  return (
    <div className={cn('grid gap-4', className)}>
      {groups.map((group) => (
        <section key={group.group} className="grid gap-2">
          <h3 className="px-1 text-[11px] font-semibold uppercase text-admin-text-subtle">
            {lang ? adminInlineText(lang, group.group) : group.group}
          </h3>
          <TimelineList lang={lang} items={group.items} />
        </section>
      ))}
    </div>
  );
}

export type ActorType = 'admin' | 'user' | 'system' | 'module' | 'worker' | 'unknown';

const actorTypeLabel: Record<ActorType, string> = {
  admin: 'admin',
  user: 'user',
  system: 'system',
  module: 'module',
  worker: 'worker',
  unknown: 'actor',
};

export function ActorPill({
  actorId,
  label,
  actorType = 'unknown',
  tone = 'neutral',
}: {
  actorId?: string | null;
  label?: ReactNode;
  actorType?: ActorType;
  tone?: AdminTone;
}) {
  const value = actorId || 'system';
  const initials = value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'SY';
  return (
    <span className="inline-flex min-w-0 items-center gap-2 align-middle">
      <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ring-1', toneIconClass[tone])}>
        {initials}
      </span>
      <span className="min-w-0 truncate">{label ?? value}</span>
      <span className="hidden rounded-full border border-admin-border bg-admin-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase text-admin-text-subtle sm:inline-flex">
        {actorTypeLabel[actorType]}
      </span>
    </span>
  );
}

export function ActionPanel({
  title,
  description,
  tone = 'neutral',
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  tone?: AdminTone;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-admin-md border p-4', toneSurfaceClass[tone], className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-5 text-admin-text">{title}</h3>
          {description ? <p className="mt-1 text-sm leading-6 text-admin-text-muted">{description}</p> : null}
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}

export interface PageSynopsisItem {
  key: string;
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  tone?: AdminTone;
}

export function PageSynopsis({
  lang,
  title,
  description,
  status,
  statusLabel,
  statusTone,
  action,
  items,
  className,
}: {
  lang?: SupportedLanguage;
  title: ReactNode;
  description?: ReactNode;
  status?: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  action?: ReactNode;
  items: readonly PageSynopsisItem[];
  className?: string;
}) {
  return (
    <section className={cn('rounded-admin-md border border-admin-border bg-admin-surface shadow-admin-card', className)}>
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold leading-6 text-admin-text">{title}</h2>
            {status ? <StatusBadge lang={lang} value={status} label={statusLabel} tone={statusTone} /> : null}
          </div>
          {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-admin-text-muted">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {items.length > 0 ? (
        <div className="grid border-t border-admin-border sm:grid-cols-2 xl:grid-cols-4">
          {items.map((item) => (
            <div key={item.key} className="border-t border-admin-border px-4 py-3 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0 sm:px-5">
              <span className="block text-[11px] font-semibold uppercase text-admin-text-subtle">{item.label}</span>
              <strong className={cn('mt-1 block text-lg font-bold leading-7 text-admin-text', chartToneClass[item.tone ?? 'neutral'])}>
                {item.value}
              </strong>
              {item.detail ? <span className="mt-0.5 block text-xs leading-5 text-admin-text-muted">{item.detail}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function SegmentedWorkspace({
  lang = 'zh',
  title,
  description,
  action,
  sections,
  className,
}: {
  lang?: SupportedLanguage;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  sections: readonly { key: string; label: ReactNode; count?: ReactNode; content: ReactNode }[];
  className?: string;
}) {
  return (
    <AdminPanel
      title={title}
      description={description}
      action={action}
      className={className}
      contentClassName="grid gap-4 p-4 sm:p-5"
    >
      <div className="flex flex-wrap gap-2">
        {sections.map((section) => (
          <a
            key={section.key}
            href={`#${section.key}`}
            className="inline-flex min-h-8 items-center gap-2 rounded-full border border-admin-border bg-admin-bg px-3 py-1 text-xs font-semibold text-admin-text-muted transition hover:border-admin-primary/25 hover:bg-admin-primary-soft hover:text-admin-primary"
          >
            <span>{typeof section.label === 'string' ? adminInlineText(lang, section.label) : section.label}</span>
            {section.count ? <span className="rounded-full bg-admin-surface px-1.5 py-0.5 text-[10px] text-admin-text-subtle">{section.count}</span> : null}
          </a>
        ))}
      </div>
      <div className="grid gap-3">
        {sections.map((section, index) => (
          <details
            key={section.key}
            id={section.key}
            className="scroll-mt-24 rounded-admin-md border border-admin-border bg-admin-bg/35"
            open={index === 0}
          >
            <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted/60 [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-2">
                {typeof section.label === 'string' ? adminInlineText(lang, section.label) : section.label}
                {section.count ? <span className="rounded-full border border-admin-border bg-admin-surface px-1.5 py-0.5 text-[10px] text-admin-text-subtle">{section.count}</span> : null}
              </span>
            </summary>
            <div className="border-t border-admin-border p-3">{section.content}</div>
          </details>
        ))}
      </div>
    </AdminPanel>
  );
}

export function EvidenceSection({
  title,
  description,
  children,
  defaultOpen = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="rounded-admin-md border border-admin-border bg-admin-bg/40" open={defaultOpen}>
      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted/60 [&::-webkit-details-marker]:hidden">
        <span className="flex flex-col gap-0.5">
          <span>{title}</span>
          {description ? <span className="text-xs font-normal leading-5 text-admin-text-muted">{description}</span> : null}
        </span>
      </summary>
      <div className="border-t border-admin-border p-3">{children}</div>
    </details>
  );
}

export function DangerZone({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-admin-md border border-admin-danger/25 bg-admin-danger/10 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-admin-danger">{title}</h3>
          {description ? <p className="mt-1 text-sm leading-6 text-admin-text-muted">{description}</p> : null}
          {children ? <div className="mt-3 text-sm leading-6 text-admin-text">{children}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}

export interface PermissionMatrixRole {
  id: string;
  label: string;
  builtIn: boolean;
  capabilities: readonly string[];
  modulePermissions: readonly string[];
}

export interface PermissionMatrixPermission {
  id: string;
  label: ReactNode;
  group: 'host' | 'module';
  category?: string;
  description?: ReactNode;
}

export function PermissionMatrix({
  lang = 'zh',
  roles,
  permissions,
  empty,
}: {
  lang?: SupportedLanguage;
  roles: readonly PermissionMatrixRole[];
  permissions: readonly PermissionMatrixPermission[];
  empty?: ReactNode;
}) {
  if (roles.length === 0 || permissions.length === 0) {
    return (
      <div className="rounded-admin-md border border-dashed border-admin-border px-4 py-8 text-sm text-admin-text-muted">
        {empty ?? adminInlineText(lang, 'No role coverage to display.')}
      </div>
    );
  }

  const groupedPermissions = permissions.reduce<Array<{ key: string; permissions: PermissionMatrixPermission[] }>>(
    (acc, permission) => {
      const key = permission.category ?? (permission.group === 'host' ? 'Host capabilities' : 'Module permissions');
      const existing = acc.find((group) => group.key === key);
      if (existing) {
        existing.permissions.push(permission);
      } else {
        acc.push({ key, permissions: [permission] });
      }
      return acc;
    },
    []
  );

  return (
    <div className="overflow-x-auto rounded-admin-md border border-admin-border bg-admin-bg/40">
      <table className="w-full min-w-[860px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-admin-border bg-admin-surface-muted/70">
            <th className="sticky left-0 z-10 w-64 bg-admin-surface-muted/95 px-4 py-3 text-xs font-semibold uppercase text-admin-text-subtle">
              {adminInlineText(lang, 'Permission')}
            </th>
            {roles.map((role) => (
              <th key={role.id} className="px-3 py-3 text-center text-xs font-semibold uppercase text-admin-text-subtle">
                <span className="block truncate normal-case text-sm text-admin-text">{role.label}</span>
                <span className="mt-1 block font-medium normal-case text-admin-text-muted">{adminInlineText(lang, role.builtIn ? 'system' : 'custom')}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-admin-border">
          {groupedPermissions.map((group) => (
            <Fragment key={group.key}>
              <tr className="bg-admin-surface-muted/45">
                <th
                  className="sticky left-0 z-10 bg-admin-surface-muted/95 px-4 py-2 text-[11px] font-semibold uppercase text-admin-text-subtle"
                  colSpan={roles.length + 1}
                >
                  {group.key}
                </th>
              </tr>
              {group.permissions.map((permission) => (
                <tr key={`${permission.group}:${permission.id}`} className="hover:bg-admin-surface-muted/50">
                  <th className="sticky left-0 z-10 bg-admin-bg/95 px-4 py-3 font-medium text-admin-text">
                    <span className="block truncate">{permission.label}</span>
                    <span className="mt-1 block truncate font-mono text-[11px] font-normal text-admin-text-muted">{permission.id}</span>
                    {permission.description ? (
                      <span className="mt-1 block truncate text-[11px] font-normal text-admin-text-subtle">{permission.description}</span>
                    ) : null}
                  </th>
                  {roles.map((role) => {
                    const granted =
                      permission.group === 'host'
                        ? role.capabilities.includes(permission.id)
                        : role.modulePermissions.includes(permission.id);
                    return (
                      <td key={`${role.id}:${permission.group}:${permission.id}`} className="px-3 py-3 text-center">
                        <span
                          className={cn(
                            'inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-[11px] font-semibold',
                            granted
                              ? 'border-admin-success/25 bg-admin-success/10 text-admin-success'
                              : 'border-admin-border bg-admin-surface-muted/55 text-admin-text-subtle'
                          )}
                        >
                          {granted ? adminInlineText(lang, 'yes') : '-'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MoreActionMenu({
  label = 'More',
  children,
}: {
  label?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="group inline-grid gap-2">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center justify-center gap-1 rounded-admin-md border border-admin-border bg-admin-surface px-2.5 py-1.5 text-xs font-semibold text-admin-text transition hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary [&::-webkit-details-marker]:hidden">
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        <span>{label}</span>
      </summary>
      <div className="grid min-w-56 gap-2 rounded-admin-md border border-admin-border bg-admin-surface p-2 shadow-admin-popover">{children}</div>
    </details>
  );
}

export interface ActionQueueItem {
  key: string;
  title: ReactNode;
  description: ReactNode;
  actionLabel?: ReactNode;
  href?: string;
  status?: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  meta?: ReactNode;
  tone?: AdminTone;
}

export function ActionQueue({
  lang = 'zh',
  title,
  description,
  status,
  statusLabel,
  statusTone,
  items,
  empty,
  className,
}: {
  lang?: SupportedLanguage;
  title: ReactNode;
  description?: ReactNode;
  status?: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  items: readonly ActionQueueItem[];
  empty?: ReactNode;
  className?: string;
}) {
  return (
    <AdminPanel
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {title}
          {status ? <StatusBadge lang={lang} value={status} label={statusLabel} tone={statusTone} /> : null}
        </span>
      }
      description={description}
      className={className}
      contentClassName="grid gap-3 p-4 sm:p-5"
    >
      {items.length > 0 ? (
        items.map((item, index) => <ActionQueueRow key={item.key} lang={lang} item={item} index={index} />)
      ) : (
        empty ?? (
          <div className="rounded-admin-md border border-dashed border-admin-border px-4 py-6 text-sm text-admin-text-muted">
            {adminInlineText(lang, 'No active items.')}
          </div>
        )
      )}
    </AdminPanel>
  );
}

function ActionQueueRow({
  lang,
  item,
  index,
}: {
  lang: SupportedLanguage;
  item: ActionQueueItem;
  index: number;
}) {
  const tone = item.tone ?? 'neutral';
  const content = (
    <>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase text-admin-text-subtle">
            {adminInlineText(lang, 'Priority')} {index + 1}
          </span>
          {item.status ? <StatusBadge lang={lang} value={item.status} label={item.statusLabel} tone={item.statusTone} /> : null}
          {item.meta ? <span className="text-xs text-admin-text-muted">{item.meta}</span> : null}
        </div>
        <h3 className="mt-2 text-sm font-semibold leading-5 text-admin-text">{item.title}</h3>
        <p className="mt-1 text-sm leading-6 text-admin-text-muted">{item.description}</p>
      </div>
      {item.actionLabel ? (
        <span className="inline-flex h-9 w-full shrink-0 items-center justify-center gap-2 rounded-admin-md border border-admin-primary/20 bg-admin-primary-soft px-3 text-xs font-semibold text-admin-primary transition group-hover:bg-admin-primary/10 sm:w-auto">
          {item.actionLabel}
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </span>
      ) : null}
    </>
  );

  const className = cn(
    'group rounded-admin-md border bg-admin-bg/50 p-4 transition hover:bg-admin-surface-muted/65',
    toneBorderClass[tone]
  );

  if (item.href) {
    return (
      <Link href={item.href} className={className}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">{content}</div>
      </Link>
    );
  }

  return (
    <article className={className}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">{content}</div>
    </article>
  );
}

export interface DigestItem {
  key: string;
  title: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
  status?: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  href?: string;
}

export function DigestPanel({
  lang,
  title,
  description,
  action,
  items,
  empty,
}: {
  lang?: SupportedLanguage;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  items: readonly DigestItem[];
  empty?: ReactNode;
}) {
  return (
    <AdminPanel title={title} description={description} action={action}>
      <DigestList lang={lang} items={items} empty={empty} />
    </AdminPanel>
  );
}

export function DigestList({
  lang,
  items,
  empty,
  className,
}: {
  lang?: SupportedLanguage;
  items: readonly DigestItem[];
  empty?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('divide-y divide-admin-border rounded-admin-md border border-admin-border bg-admin-bg/40', className)}>
      {items.length > 0 ? (
        items.map((item) => <DigestListItem key={item.key} lang={lang} item={item} />)
      ) : (
        <div className="px-3 py-4 text-sm text-admin-text-muted">{empty ?? 'No recent activity.'}</div>
      )}
    </div>
  );
}

export interface HealthRowItem {
  key: string;
  title: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
  status: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  tone?: AdminTone;
  href?: string;
}

export function HealthRowList({
  lang = 'zh',
  items,
  empty,
  className,
}: {
  lang?: SupportedLanguage;
  items: readonly HealthRowItem[];
  empty?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('divide-y divide-admin-border rounded-admin-md border border-admin-border bg-admin-bg/40', className)}>
      {items.length > 0 ? (
        items.map((item) => <HealthRow key={item.key} lang={lang} item={item} />)
      ) : (
        <div className="px-4 py-6 text-sm text-admin-text-muted">{empty ?? adminInlineText(lang, 'No health checks recorded.')}</div>
      )}
    </div>
  );
}

export function HealthRow({ lang, item }: { lang: SupportedLanguage; item: HealthRowItem }) {
  const content = (
    <>
      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', chartToneClass[item.tone ?? 'primary'], 'bg-current')} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold text-admin-text">
            {typeof item.title === 'string' ? adminInlineText(lang, item.title) : item.title}
          </span>
          <StatusBadge lang={lang} value={item.status} label={item.statusLabel} tone={item.statusTone} />
        </div>
        {item.detail ? (
          <p className="mt-1 truncate text-xs text-admin-text-muted">
            {typeof item.detail === 'string' ? adminMaybeInlineText(lang, item.detail) : item.detail}
          </p>
        ) : null}
      </div>
      {item.meta ? <span className="shrink-0 text-right text-xs text-admin-text-muted">{item.meta}</span> : null}
      {item.href ? <ChevronRight className="h-4 w-4 shrink-0 text-admin-text-muted transition group-hover:text-admin-primary" aria-hidden /> : null}
    </>
  );
  const className = 'group flex items-center gap-3 px-3 py-2.5 transition hover:bg-admin-surface-muted/70';

  if (item.href) {
    return (
      <Link href={item.href} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}

function buildChart(values: readonly number[], width: number, height: number) {
  const padding = 12;
  const min = values.length > 0 ? Math.min(...values) : 0;
  const max = values.length > 0 ? Math.max(...values) : 1;
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : padding + (index / (values.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / range) * (height - padding * 2);
    return { x, y };
  });
  const path = points.reduce((result, point, index) => {
    if (index === 0) {
      return `M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    }
    const previous = points[index - 1];
    const controlX = (previous.x + point.x) / 2;
    return `${result} Q ${controlX.toFixed(1)} ${previous.y.toFixed(1)} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }, '');
  const areaPath = points.length > 0 ? `${path} L ${points.at(-1)?.x.toFixed(1)} ${height - padding} L ${points[0].x.toFixed(1)} ${height - padding} Z` : '';
  return { padding, points, path, areaPath };
}

export function ChartPanel({
  title,
  description,
  values,
  labels,
  stats,
  action,
  legend,
  axisLabel,
  drilldownHref,
  drilldownLabel = 'View detail',
  tone = 'primary',
  empty,
}: {
  title: ReactNode;
  description?: ReactNode;
  values: readonly number[];
  labels?: readonly ReactNode[];
  stats?: readonly { key: string; label: ReactNode; value: ReactNode; detail?: ReactNode; tone?: AdminTone }[];
  action?: ReactNode;
  legend?: readonly { key: string; label: ReactNode; value?: ReactNode; tone?: AdminTone }[];
  axisLabel?: ReactNode;
  drilldownHref?: string;
  drilldownLabel?: ReactNode;
  tone?: AdminTone;
  empty?: ReactNode;
}) {
  const displayValues = values.length > 0 ? values : [0, 0, 0, 0, 0, 0, 0];
  const chart = buildChart(displayValues, 520, 180);
  const hasData = values.some((value) => value > 0);
  return (
    <AdminPanel
      title={title}
      description={description}
      action={
        action ??
        (drilldownHref ? (
          <ButtonLink href={drilldownHref} variant="ghost" size="small">
            {drilldownLabel}
          </ButtonLink>
        ) : undefined)
      }
    >
      <div className="grid gap-4">
        {legend && legend.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {legend.map((item) => (
              <span
                key={item.key}
                className="inline-flex items-center gap-2 rounded-full border border-admin-border bg-admin-bg px-2.5 py-1 text-xs font-medium text-admin-text-muted"
              >
                <span className={cn('h-2 w-2 rounded-full bg-current', chartToneClass[item.tone ?? tone])} aria-hidden />
                <span>{item.label}</span>
                {item.value ? <strong className="font-semibold text-admin-text">{item.value}</strong> : null}
              </span>
            ))}
          </div>
        ) : null}
        <div className="relative overflow-hidden rounded-admin-md border border-admin-border bg-admin-bg/45 px-2 py-3">
          {axisLabel ? <span className="absolute left-3 top-2 text-[11px] font-medium text-admin-text-subtle">{axisLabel}</span> : null}
          {hasData ? (
            <svg viewBox="0 0 520 180" className={cn('h-44 w-full', chartToneClass[tone])} aria-hidden preserveAspectRatio="none">
              <g className="text-admin-border">
                {[0.25, 0.5, 0.75].map((ratio) => (
                  <line key={ratio} x1="12" x2="508" y1={12 + ratio * 156} y2={12 + ratio * 156} stroke="currentColor" strokeWidth="1" />
                ))}
              </g>
              <path d={chart.areaPath} fill="currentColor" opacity="0.08" />
              <path d={chart.path} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {chart.points.map((point, index) => (
                <circle key={index} cx={point.x} cy={point.y} r="3.5" fill="currentColor" />
              ))}
            </svg>
          ) : (
            <div className="grid h-44 place-items-center text-sm text-admin-text-muted">{empty ?? 'No trend data yet.'}</div>
          )}
        </div>
        {labels && labels.length > 0 ? (
          <div className="grid grid-cols-4 gap-2 text-xs text-admin-text-muted sm:grid-cols-7">
            {labels.map((label, index) => (
              <span key={index} className="truncate text-center">
                {label}
              </span>
            ))}
          </div>
        ) : null}
        {stats && stats.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {stats.map((item) => (
              <div key={item.key} className="rounded-admin-md border border-admin-border bg-admin-bg/40 p-3">
                <span className="block text-xs text-admin-text-muted">{item.label}</span>
                <strong className="mt-1 block text-xl font-bold text-admin-text">{item.value}</strong>
                {item.detail ? <span className={cn('mt-1 block text-xs', chartToneClass[item.tone ?? 'neutral'])}>{item.detail}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </AdminPanel>
  );
}

export function FilterBar({
  searchName = 'q',
  searchValue = '',
  searchPlaceholder = 'Search',
  filterName = 'status',
  filterValue = '',
  filterLabel = 'Status',
  filterOptions = [],
  resetHref,
  result,
  embedded = true,
  lang = 'zh',
}: {
  searchName?: string;
  searchValue?: string;
  searchPlaceholder?: string;
  filterName?: string;
  filterValue?: string;
  filterLabel?: string;
  filterOptions?: readonly { value: string; label: string }[];
  resetHref?: string;
  result?: ReactNode;
  embedded?: boolean;
  lang?: SupportedLanguage;
}) {
  const hasActiveQuery = searchValue.length > 0 || filterValue.length > 0;
  const translatedSearchPlaceholder = adminInlineText(lang, searchPlaceholder);
  const translatedFilterLabel = adminInlineText(lang, filterLabel);
  return (
    <form
      method="get"
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-end',
        embedded
          ? 'border-b border-admin-border bg-admin-bg/35 px-4 py-3 sm:px-5'
          : 'rounded-admin-md border border-admin-border bg-admin-surface p-4 shadow-admin-card'
      )}
    >
      <label className="grid flex-1 gap-2 text-sm font-medium text-admin-text">
        <span className="text-xs font-semibold uppercase text-admin-text-subtle">
          {adminInlineText(lang, 'Search')}
        </span>
        <Input
          type="search"
          name={searchName}
          defaultValue={searchValue}
          placeholder={translatedSearchPlaceholder}
          aria-label={translatedSearchPlaceholder}
        />
      </label>
      {filterOptions.length > 0 ? (
        <label className="grid gap-2 text-sm font-medium text-admin-text sm:w-56">
          <span className="text-xs font-semibold uppercase text-admin-text-subtle">{translatedFilterLabel}</span>
          <Select name={filterName} defaultValue={filterValue} aria-label={translatedFilterLabel}>
            <option value="">{adminInlineText(lang, 'All')}</option>
            {filterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {adminInlineText(lang, option.label)}
              </option>
            ))}
          </Select>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {result ? <span className="mr-1 text-xs text-admin-text-muted">{result}</span> : null}
        <Button type="submit" size="small">
          {adminInlineText(lang, 'Filter')}
        </Button>
        {hasActiveQuery && resetHref ? (
          <ButtonLink href={resetHref} variant="ghost" size="small">
            {adminInlineText(lang, 'Clear')}
          </ButtonLink>
        ) : null}
      </div>
    </form>
  );
}

export function AdvancedFilterPanel({
  title = 'Advanced filters',
  description,
  children,
  defaultOpen = false,
  lang = 'zh',
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  lang?: SupportedLanguage;
}) {
  return (
    <details className="rounded-admin-md border border-admin-border bg-admin-bg/40" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-semibold text-admin-text transition hover:bg-admin-surface-muted/60 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-admin-text-muted" aria-hidden />
          {typeof title === 'string' ? adminInlineText(lang, title) : title}
        </span>
        <span className="text-xs font-medium text-admin-text-subtle">
          {adminInlineText(lang, 'expand')}
        </span>
      </summary>
      {description ? <p className="border-t border-admin-border px-3 pt-3 text-xs leading-5 text-admin-text-muted">{description}</p> : null}
      <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </details>
  );
}

export function CodeBlockPanel({
  title,
  description,
  value,
  copyValue,
  maxHeightClass = 'max-h-72 sm:max-h-80',
  lang = 'zh',
}: {
  title: ReactNode;
  description?: ReactNode;
  value: ReactNode;
  copyValue?: string;
  maxHeightClass?: string;
  lang?: SupportedLanguage;
}) {
  const stringValue = typeof value === 'string' ? value : copyValue;
  return (
    <AdminPanel
      title={title}
      description={description}
      action={
        stringValue ? (
          <CopyButton
            value={stringValue}
            label={adminInlineText(lang, 'Copy')}
            copiedLabel={adminInlineText(lang, 'Copied')}
          />
        ) : undefined
      }
    >
      <pre className={cn('code-block overflow-auto break-all text-[11px] leading-5 sm:text-xs', maxHeightClass)}>{value}</pre>
    </AdminPanel>
  );
}

function DigestListItem({ lang, item }: { lang?: SupportedLanguage; item: DigestItem }) {
  const content = (
    <>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-admin-text">{item.title}</span>
          {item.status ? <StatusBadge lang={lang} value={item.status} label={item.statusLabel} tone={item.statusTone} /> : null}
        </div>
        {item.detail ? <p className="mt-1 truncate text-xs text-admin-text-muted">{item.detail}</p> : null}
      </div>
      {item.meta ? <span className="shrink-0 text-xs text-admin-text-muted">{item.meta}</span> : null}
    </>
  );

  if (item.href) {
    return (
      <Link href={item.href} className="flex items-center justify-between gap-3 px-3 py-2.5 transition hover:bg-admin-surface-muted/70">
        {content}
      </Link>
    );
  }

  return <div className="flex items-center justify-between gap-3 px-3 py-2.5">{content}</div>;
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('grid min-w-0 w-full grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4', className)}>{children}</section>;
}

export function EntityListItem({
  lang,
  title,
  subtitle,
  href,
  avatar,
  icon: Icon,
  status,
  statusLabel,
  statusTone,
  meta,
  detail,
  actions,
  tone = 'primary',
  density = 'regular',
}: {
  lang?: SupportedLanguage;
  title: ReactNode;
  subtitle?: ReactNode;
  href?: string;
  avatar?: ReactNode;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  status?: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  meta?: ReactNode;
  detail?: ReactNode;
  actions?: ReactNode;
  tone?: AdminTone;
  density?: 'regular' | 'compact';
}) {
  const compact = density === 'compact';
  const visual = avatar ?? (
    <span
      className={cn(
        'grid shrink-0 place-items-center rounded-admin-md ring-1',
        compact ? 'h-8 w-8' : 'h-10 w-10',
        toneIconClass[tone]
      )}
    >
      {Icon ? <Icon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden /> : <span className="text-xs font-semibold">PK</span>}
    </span>
  );
  const titleBlock = (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-admin-text">{title}</span>
        {status ? <StatusBadge lang={lang} value={status} label={statusLabel} tone={statusTone} /> : null}
      </div>
      {subtitle ? <p className="mt-1 min-w-0 truncate text-xs text-admin-text-muted">{subtitle}</p> : null}
      {detail ? <p className={cn('text-xs leading-5 text-admin-text-muted', compact ? 'mt-1 truncate' : 'mt-2')}>{detail}</p> : null}
    </div>
  );
  const body = (
    <>
      {visual}
      {titleBlock}
      <div className="flex shrink-0 items-center gap-2">
        {meta ? <span className="hidden text-right text-xs text-admin-text-muted sm:block">{meta}</span> : null}
        {actions ?? (href ? <ChevronRight className="h-4 w-4 text-admin-text-muted transition group-hover:text-admin-primary" aria-hidden /> : null)}
      </div>
    </>
  );

  const className = cn(
    'group flex items-center gap-3 rounded-admin-md px-3 transition hover:bg-admin-surface-muted/70',
    compact ? 'py-2' : 'py-3'
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  }

  return <div className={className}>{body}</div>;
}

export interface HealthGridItem {
  key: string;
  title: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
  status: string;
  statusLabel?: string;
  statusTone?: StatusTone;
  icon?: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  href?: string;
  tone?: AdminTone;
}

export function HealthGrid({ items, lang }: { items: readonly HealthGridItem[]; lang?: SupportedLanguage }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-3">
      {items.map((item) => <HealthCard key={item.key} item={item} lang={lang} />)}
    </div>
  );
}

export function HealthCard({ item, lang }: { item: HealthGridItem; lang?: SupportedLanguage }) {
  const Icon = item.icon;
  const tone = item.tone ?? 'primary';
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-admin-md ring-1 sm:h-9 sm:w-9', toneIconClass[tone])}>
          {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
        </span>
        <StatusBadge lang={lang} value={item.status} label={item.statusLabel} tone={item.statusTone} />
      </div>
      <h3 className="mt-3 text-sm font-semibold leading-5 text-admin-text">{item.title}</h3>
      <div className="mt-1 flex flex-col gap-1 text-xs text-admin-text-muted sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        {item.detail ? <span className="truncate">{item.detail}</span> : <span />}
        {item.meta ? <span className="truncate sm:shrink-0">{item.meta}</span> : null}
      </div>
    </>
  );
  const className = 'rounded-admin-md border border-admin-border bg-admin-bg/50 px-3 py-3 transition hover:bg-admin-surface-muted/65 sm:px-4';

  if (item.href) {
    return (
      <Link href={item.href} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}
